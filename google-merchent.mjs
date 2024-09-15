import { google } from "googleapis";
import {
  MERCHANT_ID,
  SERVICE_ACCOUNT_PATH,
  initializeAuthClient,
  loadJSONFromFile,
  currencyCountryMap,
  generateProductUrl
} from './shared-library.mjs';

const PRODUCTS_JSON_PATH = process.env.PRODUCTS_JSON_PATH || "tpt_products_MOST_RECENT.json";

// Default product fields
const defaultProduct = {
  contentLanguage: "en",
  channel: "online",
  availability: "in stock",
  condition: "new",
  brand: "Ciara's Classroom",
};

// Helper function to create a product object
function createProduct(product, currencyCode) {
  const { country, suffix } = currencyCountryMap[currencyCode];
  const offerId = `${product.slug.split('-').pop()}-${suffix}`;
  return {
    ...defaultProduct,
    id: `${product.slug.split('-').pop()}-${suffix}`,
    targetCountry: country,
    offerId,
    title: product.title,
    description: product.descriptionSnippet,
    link: generateProductUrl(product.slug, suffix),
    imageLink: product.images[0],
    additionalImageLinks: product.images.slice(1),
    identifier_exists: false,
    price: {
      value: product.currencies[currencyCode] || "0",
      currency: currencyCode,
    },
    productTypes: product.categories,
  };
}

async function loadProductsFromFile(filePath) {
  try {
    const data = await loadJSONFromFile(filePath);
    return data.flatMap((product) =>
      Object.keys(currencyCountryMap).map((currencyCode) =>
        createProduct(product, currencyCode)
      )
    );
  } catch (error) {
    console.error("Error loading products from file:", error);
    return [];
  }
}

async function bulkUploadProducts(authClient, products) {
  try {
    await authClient.authorize();
    const content = google.content({ version: "v2.1", auth: authClient });

    const batchSize = 1000;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const batchRequest = batch.map((product, index) => ({
        batchId: index + 1,
        merchantId: MERCHANT_ID,
        method: "insert",
        product,
      }));

      const res = await content.products.custombatch({
        requestBody: { entries: batchRequest },
      });
      console.log(`Batch ${Math.floor(i / batchSize) + 1} upload response:`, res.data);

      res.data.entries.forEach((entry, index) => {
        if (entry.errors) {
          console.error(`Product ${i + index + 1} upload error:`, JSON.stringify(entry));
        } else {
          console.log(`Product ${i + index + 1} uploaded successfully.`);
        }
      });
    }
  } catch (error) {
    console.error("Error uploading products in bulk:", error);
    throw error;
  }
}

async function main() {
  try {
    if (!MERCHANT_ID) {
      throw new Error("MERCHANT_ID not set in environment variables.");
    }

    const products = await loadProductsFromFile(PRODUCTS_JSON_PATH);
    if (products.length === 0) {
      throw new Error("No products loaded, exiting.");
    }

    const authClient = await initializeAuthClient();
    await bulkUploadProducts(authClient, products);
    console.log("Product upload completed successfully.");
  } catch (error) {
    console.error("Unexpected error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});