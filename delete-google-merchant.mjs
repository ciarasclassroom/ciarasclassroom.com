import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Constants
const MERCHANT_ID = process.env.MERCHANT_ID;
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH || "token.json";
const MAX_RESULTS = 250;

// Validate required environment variables
if (!MERCHANT_ID) {
  console.error("Error: MERCHANT_ID is not set in the environment variables.");
  process.exit(1);
}

async function initializeAuthClient() {
  try {
    const serviceAccountKey = JSON.parse(
      await fs.readFile(SERVICE_ACCOUNT_PATH, "utf-8")
    );
    return new google.auth.JWT({
      email: serviceAccountKey.client_email,
      key: serviceAccountKey.private_key,
      scopes: ["https://www.googleapis.com/auth/content"],
    });
  } catch (error) {
    console.error("Error initializing auth client:", error.message);
    throw error;
  }
}

async function deleteProducts(content, products) {
  const deletionPromises = products.map(async (product) => {
    try {
      // Count the number of hyphens in the product ID
      const hyphenCount = (product.id.match(/-/g) || []).length;
      
      // Check if price is 0.00
      const price = parseFloat(product.price?.value) || 0;
      const isPriceZero = price === 0;

      if (hyphenCount >= 2 || isPriceZero) {
        await content.products.delete({
          merchantId: MERCHANT_ID,
          productId: product.id,
        });
        console.log(`Deleted product with ID: ${product.id} (${hyphenCount >= 2 ? 'multiple hyphens' : 'zero price'})`);
      } else {
        console.log(`Skipped product with ID: ${product.id} (price: ${product.price?.value} ${product.price?.currency})`);
      }
    } catch (error) {
      console.error(
        `Failed to delete product with ID: ${product.id}:`,
        error.message
      );
    }
  });
  await Promise.all(deletionPromises);
}

async function deleteAllProducts() {
  const authClient = await initializeAuthClient();
  await authClient.authorize();
  const content = google.content({
    version: "v2.1",
    auth: authClient,
  });

  let pageToken = undefined;
  do {
    try {
      const params = {
        merchantId: MERCHANT_ID,
        maxResults: MAX_RESULTS,
      };

      if (pageToken) {
        params.pageToken = pageToken;
      }

      const res = await content.products.list(params);

      const products = res.data.resources || [];
      if (products.length === 0) {
        console.log("No more products found.");
        break;
      }

      console.log(`Processing ${products.length} products...`);
      await deleteProducts(content, products);
      pageToken = res.data.nextPageToken;
    } catch (error) {
      console.error("Error fetching or deleting products:", error.message);
      throw error;
    }
  } while (pageToken);

  console.log("All products have been processed.");
}

async function main() {
  try {
    await deleteAllProducts();
    console.log("Product deletion process completed successfully.");
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});