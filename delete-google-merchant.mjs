import { google } from 'googleapis';
import { performance } from 'perf_hooks';
import {
  MERCHANT_ID,
  SERVICE_ACCOUNT_PATH,
  initializeAuthClient,
  currencyCountryMap,
  generateProductUrl,
  TPT_BASE_URL
} from './shared-library.mjs';

// Constants
const MAX_RESULTS = 250;
const CONCURRENT_DELETIONS = 10; // Number of concurrent delete operations

// Validate required environment variables
if (!MERCHANT_ID) {
  console.error('Error: MERCHANT_ID is not set in the environment variables.');
  process.exit(1);
}

/**
 * Determines if a product should be deleted based on criteria
 * @param {Object} product - Product object from Google Merchant Center
 * @returns {boolean} True if the product should be deleted
 */
function shouldDeleteProduct(product) {
  const hyphenCount = (product.id.match(/-/g) || []).length;
  const price = parseFloat(product.price?.value) || 0;
  const isPriceZero = price === 0;
  const isTPTLink = product.link && product.link.includes(TPT_BASE_URL);

  return hyphenCount >= 2 || isPriceZero || isTPTLink;
}

/**
 * Deletes a single product
 * @param {google.content} content - Google Content API client
 * @param {Object} product - Product to delete
 * @returns {Promise<void>}
 */
async function deleteProduct(content, product) {
  try {
    await content.products.delete({
      merchantId: MERCHANT_ID,
      productId: product.id,
    });
    console.log(`Deleted product with ID: ${product.id}`);
  } catch (error) {
    console.error(`Failed to delete product with ID: ${product.id}:`, error.message);
  }
}

/**
 * Deletes products concurrently
 * @param {google.content} content - Google Content API client
 * @param {Array} products - Array of products to delete
 */
async function deleteProducts(content, products) {
  const productsToDelete = products.filter(shouldDeleteProduct);
  
  for (let i = 0; i < productsToDelete.length; i += CONCURRENT_DELETIONS) {
    const batch = productsToDelete.slice(i, i + CONCURRENT_DELETIONS);
    await Promise.all(batch.map(product => deleteProduct(content, product)));
  }
}

/**
 * Fetches and deletes all products meeting the deletion criteria
 */
async function deleteAllProducts() {
  const authClient = await initializeAuthClient();
  await authClient.authorize();
  const content = google.content({ version: 'v2.1', auth: authClient });

  let pageToken;
  let totalProcessed = 0;
  let totalDeleted = 0;

  do {
    try {
      const res = await content.products.list({
        merchantId: MERCHANT_ID,
        maxResults: MAX_RESULTS,
        pageToken,
      });

      const products = res.data.resources || [];
      if (products.length === 0) break;

      totalProcessed += products.length;
      const productsToDelete = products.filter(shouldDeleteProduct);
      totalDeleted += productsToDelete.length;

      console.log(`Processing ${products.length} products (${productsToDelete.length} to be deleted)...`);
      await deleteProducts(content, productsToDelete);

      pageToken = res.data.nextPageToken;
    } catch (error) {
      console.error('Error fetching or deleting products:', error.message);
      throw error;
    }
  } while (pageToken);

  console.log(`Total products processed: ${totalProcessed}`);
  console.log(`Total products deleted: ${totalDeleted}`);
}

/**
 * Main execution function
 */
async function main() {
  const startTime = performance.now();
  try {
    await deleteAllProducts();
    const endTime = performance.now();
    console.log(`Product deletion process completed successfully in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error('An unexpected error occurred:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error in main function:', error);
  process.exit(1);
});