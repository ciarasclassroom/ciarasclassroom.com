import { google } from "googleapis";
import { readFile } from "fs/promises";
import dotenv from "dotenv";

// Load environment variables from the .env file
dotenv.config();

const MERCHANT_ID = process.env.MERCHANT_ID;
const PRODUCTS_JSON_PATH = process.env.PRODUCTS_JSON_PATH || "src/lib/fixtures/tpt_products_MOST_RECENT.json";
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH || "token.json";

// Default product fields
const defaultProduct = {
  contentLanguage: "en",
  channel: "online",
  availability: "in stock",
  condition: "new",
  brand: "Ciara's Classroom",
};

// Helper function to create a product object
function createProduct(product, country, currencyCode) {
  const offerId = `${product.slug.split("-").pop()}-${country}`;
  return {
    ...defaultProduct,
    id: offerId,
    targetCountry: country,
    offerId,
    title: product.title,
    description: product.descriptionSnippet,
    link: `https://ciarasclassroom.com/product/${product.slug}-${country}`,
    imageLink: product.images[0],
    additionalImageLinks: product.images.slice(1),
    identifier_exists: false,
    price: {
      value: product.currencies?.[currencyCode] || "0",
      currency: currencyCode,
    },
    productTypes: product.categories,
  };
}

// Function to load products from a JSON file
async function loadProductsFromFile(filePath) {
  try {
    const data = JSON.parse(await readFile(filePath, "utf-8"));
    return [
      ...data.map((product) => createProduct(product, "US", "USD")),
      ...data.map((product) => createProduct(product, "IE", "EUR")),
    ];
  } catch (error) {
    console.error("Error loading products from file:", error);
    return [];
  }
}

// Function to initialize Google auth client
async function initializeAuthClient(serviceAccountKeyPath) {
  try {
    const serviceAccountKey = JSON.parse(
      await readFile(serviceAccountKeyPath, "utf-8")
    );
    return new google.auth.JWT({
      email: serviceAccountKey.client_email,
      key: serviceAccountKey.private_key,
      scopes: ["https://www.googleapis.com/auth/content"],
    });
  } catch (error) {
    console.error("Error initializing auth client:", error);
    throw error;
  }
}

// Function to upload products in bulk
async function bulkUploadProducts(authClient, products) {
  try {
    await authClient.authorize();
    const content = google.content({ version: "v2.1", auth: authClient });

    const batchSize = 1000; // Google's maximum batch size
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
      console.log(
        `Batch ${Math.floor(i / batchSize) + 1} upload response:`,
        res.data
      );

      res.data.entries.forEach((entry, index) => {
        if (entry.errors) {
          console.error(`Product ${i + index + 1} upload error:`, entry.errors);
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

// Main execution function
async function main() {
  try {
    if (!MERCHANT_ID) {
      throw new Error("MERCHANT_ID not set in environment variables.");
    }

    const products = await loadProductsFromFile(PRODUCTS_JSON_PATH);
    if (products.length === 0) {
      throw new Error("No products loaded, exiting.");
    }

    const authClient = await initializeAuthClient(SERVICE_ACCOUNT_PATH);
    await bulkUploadProducts(authClient, products);
  } catch (error) {
    console.error("Unexpected error:", error);
    process.exit(1);
  }
}

// Execute the main function
main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});