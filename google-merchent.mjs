import * as cheerio from "cheerio";
import { google } from "googleapis";
import {
  MERCHANT_ID,
  initializeAuthClient,
  loadJSONFromFile,
  currencyCountryMap,
  generateProductUrl,
  isSellableProduct,
  merchantOfferId,
  merchantAccountName,
  ensureGcpRegistered,
  resolveProductDataSource,
  mapWithConcurrency,
} from "./shared-library.mjs";
import { performance } from "perf_hooks";

const PRODUCTS_JSON_PATH = process.env.PRODUCTS_JSON_PATH || "tpt_products_MOST_RECENT.json";

// The Merchant API has no `custombatch`, so each offer is its own request. 20 in flight
// keeps ~2,900 uploads to a few minutes without tripping the API's rate limits.
const UPLOAD_CONCURRENCY = 20;

// Google truncates beyond 5000 characters and rejects longer values outright.
const MAX_DESCRIPTION_LENGTH = 5000;

// Every resource is an instant digital download, so there is nothing to ship. Stating
// that explicitly stops Merchant Center falling back to account-level shipping rules
// (and disapproving items when none match the target country).
const DIGITAL_SHIPPING_SERVICE = "Instant digital download";

// `productTypes` is the seller-defined taxonomy. TpT dropped `resourceCategories`
// from their API so `product.categories` is now always empty; without a fallback the
// field goes out blank and Google loses a useful classification signal.
const DEFAULT_PRODUCT_TYPE = "Teaching Resources > Printable Classroom Activities";

const CONTENT_LANGUAGE = "en";

// Default attributes shared by every offer. Merchant API v1 uses enum-style values
// where the Content API took free text ("in stock" -> "IN_STOCK").
const defaultAttributes = {
  availability: "IN_STOCK",
  condition: "NEW",
  brand: "Ciara's Classroom",
  adult: false,
  isBundle: false,
};

/**
 * Merchant API v1 takes prices as integer micros, not decimal strings.
 * @param {string|number} amount e.g. "6.00"
 * @returns {string} e.g. "6000000"
 */
function toAmountMicros(amount) {
  return String(Math.round(Number(amount) * 1e6));
}

/**
 * Turns TpT's HTML description into the plain text Google expects.
 * Falls back to the short snippet if the rich description is missing.
 */
function toPlainDescription(product) {
  const html = product.description || "";
  const text = html ? cheerio.load(html).text().replace(/\s+/g, " ").trim() : "";
  const description = text || product.descriptionSnippet || product.title;
  return description.length > MAX_DESCRIPTION_LENGTH
    ? `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
    : description;
}

/**
 * Creates a product object for Google Merchant Center
 * @param {Object} product - Product data from JSON file
 * @param {string} currencyCode - Currency code for the product
 * @returns {Object} Formatted product object for Google Merchant Center
 */
function createProduct(product, currencyCode) {
  const { country, suffix } = currencyCountryMap[currencyCode];
  const offerId = merchantOfferId(product, suffix);

  const price = product.currencies[currencyCode];
  if (price === undefined || price === null) {
    // Previously this fell back to "0", which quietly listed a paid resource as free.
    throw new Error(`Missing ${currencyCode} price for "${product.title}" (${product.slug}).`);
  }

  return {
    offerId,
    contentLanguage: CONTENT_LANGUAGE,
    // The Content API's `targetCountry` is now the feed label; the shipping entry below
    // is what actually scopes the offer to a country.
    feedLabel: country,
    productAttributes: {
      ...defaultAttributes,
      title: product.title,
      description: toPlainDescription(product),
      link: generateProductUrl(product.slug, suffix),
      imageLink: product.images[0],
      additionalImageLinks: product.images.slice(1),
      identifierExists: false,
      price: {
        amountMicros: toAmountMicros(price),
        currencyCode,
      },
      productTypes: product.categories?.length ? product.categories : [DEFAULT_PRODUCT_TYPE],
      shipping: [
        {
          country,
          service: DIGITAL_SHIPPING_SERVICE,
          price: { amountMicros: "0", currencyCode },
        },
      ],
    },
  };
}

/**
 * Loads and formats products from a JSON file
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<Array>} Array of formatted product objects
 */
async function loadProductsFromFile(filePath) {
  try {
    const data = await loadJSONFromFile(filePath);
    const sellable = data.filter(isSellableProduct);
    console.log(
      `Loaded ${data.length} products from file; ${sellable.length} sellable ` +
        `(${data.length - sellable.length} free resources skipped — Google rejects a price of 0).`,
    );
    return sellable.flatMap((product) =>
      Object.keys(currencyCountryMap).map((currencyCode) => createProduct(product, currencyCode)),
    );
  } catch (error) {
    console.error("Error loading products from file:", error);
    return [];
  }
}

/**
 * Upserts every offer into the Merchant Center data source.
 *
 * `productInputs.insert` is an upsert: re-sending an existing `offerId` updates it in
 * place. That is why nothing is deleted first any more -- the old flow wiped the whole
 * account nightly and re-inserted it, which reset each product's history in Merchant
 * Center. Stale offers are pruned separately by delete-google-merchant.mjs.
 *
 * @param {import("google-auth-library").JWT} authClient
 * @param {Array} products
 */
async function bulkUploadProducts(authClient, products) {
  await authClient.authorize();

  const accountsApi = google.merchantapi({ version: "accounts_v1", auth: authClient });
  const datasources = google.merchantapi({ version: "datasources_v1", auth: authClient });
  const productsApi = google.merchantapi({ version: "products_v1", auth: authClient });

  await ensureGcpRegistered(accountsApi);

  const parent = merchantAccountName();
  const dataSource = await resolveProductDataSource(datasources);

  console.log(`Uploading ${products.length} offers (concurrency ${UPLOAD_CONCURRENCY})...`);

  let uploaded = 0;
  const results = await mapWithConcurrency(
    products,
    async (product) => {
      const response = await productsApi.accounts.productInputs.insert({
        parent,
        dataSource,
        requestBody: product,
      });
      uploaded += 1;
      if (uploaded % 250 === 0) console.log(`  ${uploaded}/${products.length} uploaded`);
      return response.data;
    },
    UPLOAD_CONCURRENCY,
  );

  const failures = results.filter((result) => result.status === "rejected");
  console.log(`Upload finished: ${results.length - failures.length} succeeded, ${failures.length} failed.`);

  if (failures.length) {
    // Show a handful rather than thousands of near-identical stack traces.
    for (const failure of failures.slice(0, 5)) {
      console.error("  ", failure.reason?.message || failure.reason);
    }
    throw new Error(`${failures.length} of ${results.length} offers failed to upload.`);
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = performance.now();
  try {
    if (!MERCHANT_ID) {
      throw new Error("MERCHANT_ID not set in environment variables.");
    }

    const products = await loadProductsFromFile(PRODUCTS_JSON_PATH);
    if (products.length === 0) {
      throw new Error("No products loaded, exiting.");
    }

    console.log(`Prepared ${products.length} products for upload.`);

    const authClient = await initializeAuthClient();
    await bulkUploadProducts(authClient, products);

    const endTime = performance.now();
    console.log(`Product upload completed successfully in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error("Unexpected error:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
