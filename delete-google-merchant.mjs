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
      await fs.readFile(SERVICE_ACCOUNT_PATH, "utf-8"),
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
      await content.products.delete({
        merchantId: MERCHANT_ID,
        productId: product.id,
      });
      console.log(`Deleted product with ID: ${product.id}`);
    } catch (error) {
      console.error(
        `Failed to delete product with ID: ${product.id}:`,
        error.message,
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

  let nextPageToken = null;
  do {
    try {
      const res = await content.products.list({
        merchantId: MERCHANT_ID,
        maxResults: MAX_RESULTS,
        pageToken: nextPageToken,
      });

      const products = res.data.resources || [];
      if (products.length === 0) {
        console.log("No products found.");
        return;
      }

      console.log(`Deleting ${products.length} products...`);
      await deleteProducts(content, products);

      nextPageToken = res.data.nextPageToken;
    } catch (error) {
      console.error("Error fetching or deleting products:", error.message);
      throw error;
    }
  } while (nextPageToken);

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
