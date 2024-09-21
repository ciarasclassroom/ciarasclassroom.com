import { google } from "googleapis";
import {
  MERCHANT_ID,
  SERVICE_ACCOUNT_PATH,
  initializeAuthClient,
  loadJSONFromFile,
  currencyCountryMap,
  generateProductUrl
} from './shared-library.mjs';
import { performance } from 'perf_hooks';

const PRODUCTS_JSON_PATH = process.env.PRODUCTS_JSON_PATH || "tpt_products_MOST_RECENT.json";
const BATCH_SIZE = 1000;
const CONCURRENT_BATCHES = 5;

// Default product fields
const defaultProduct = {
  contentLanguage: "en",
  channel: "online",
  availability: "in stock",
  condition: "new",
  brand: "Ciara's Classroom",
};

/**
 * Creates a product object for Google Merchant Center
 * @param {Object} product - Product data from JSON file
 * @param {string} currencyCode - Currency code for the product
 * @returns {Object} Formatted product object for Google Merchant Center
 */
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
    identifierExists: false,
    price: {
      value: product.currencies[currencyCode] || "0",
      currency: currencyCode,
    },
    productTypes: product.categories,
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
    console.log(`Loaded ${data.length} products from file.`);
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

/**
 * Uploads a batch of products to Google Merchant Center
 * @param {google.content} content - Google Content API client
 * @param {Array} batch - Batch of products to upload
 * @param {number} batchNumber - Current batch number
 * @returns {Promise<void>}
 */
async function uploadProductBatch(content, batch, batchNumber) {
  try {
    const batchRequest = batch.map((product, index) => ({
      batchId: index + 1,
      merchantId: MERCHANT_ID,
      method: "insert",
      product,
    }));

    const res = await content.products.custombatch({
      requestBody: { entries: batchRequest },
    });

    console.log(`Batch ${batchNumber} upload completed.`);
    
    let successCount = 0;
    let errorCount = 0;

    res.data.entries.forEach((entry) => {
      if (entry.errors) {
        errorCount++;
        console.error(`Product upload error (Batch ${batchNumber}, ID: ${entry.batchId}):`, JSON.stringify(entry.errors));
      } else {
        successCount++;
      }
    });

    console.log(`Batch ${batchNumber} results: ${successCount} successes, ${errorCount} errors`);
  } catch (error) {
    console.error(`Error uploading batch ${batchNumber}:`, error.message);
  }
}

/**
 * Uploads products to Google Merchant Center in batches
 * @param {google.auth.JWT} authClient - Authenticated Google JWT client
 * @param {Array} products - Array of products to upload
 */
async function bulkUploadProducts(authClient, products) {
  await authClient.authorize();
  const content = google.content({ version: "v2.1", auth: authClient });

  const totalBatches = Math.ceil(products.length / BATCH_SIZE);
  console.log(`Uploading ${products.length} products in ${totalBatches} batches.`);

  for (let i = 0; i < products.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
    const batchPromises = [];
    for (let j = 0; j < CONCURRENT_BATCHES && i + j * BATCH_SIZE < products.length; j++) {
      const start = i + j * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, products.length);
      const batch = products.slice(start, end);
      const batchNumber = Math.floor(start / BATCH_SIZE) + 1;
      batchPromises.push(uploadProductBatch(content, batch, batchNumber));
    }
    await Promise.all(batchPromises);
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