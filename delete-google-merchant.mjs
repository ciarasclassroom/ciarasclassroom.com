/**
 * Prunes stale offers from Merchant Center.
 *
 * Runs *after* google-merchent.mjs, not before it. The old flow deleted every product
 * nightly and re-inserted the catalogue, which reset each offer's history in Merchant
 * Center; `productInputs.insert` is an upsert, so the wipe was never needed. This now
 * removes only offers the current feed no longer contains (a resource Ciara retired,
 * or a country variant that has gone away).
 *
 * Migrated from the Content API for Shopping, which was sunset on 2026-08-18.
 */
import { google } from "googleapis";
import { performance } from "perf_hooks";
import {
  MERCHANT_ID,
  initializeAuthClient,
  loadJSONFromFile,
  currencyCountryMap,
  merchantAccountName,
  mapWithConcurrency,
} from "./shared-library.mjs";

const PRODUCTS_JSON_PATH = process.env.PRODUCTS_JSON_PATH || "tpt_products_MOST_RECENT.json";
const PAGE_SIZE = 250;
const DELETE_CONCURRENCY = 10;

// If the live catalogue somehow fails to load we would compute "everything is stale"
// and empty the account. Never prune more than this fraction of it in one run.
const MAX_PRUNE_FRACTION = 0.2;

if (!MERCHANT_ID) {
  console.error("Error: MERCHANT_ID is not set in the environment variables.");
  process.exit(1);
}

/**
 * The set of offerIds the current feed should contain.
 * @returns {Promise<Set<string>>}
 */
async function loadExpectedOfferIds() {
  const products = await loadJSONFromFile(PRODUCTS_JSON_PATH);

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error(`No products in ${PRODUCTS_JSON_PATH} — refusing to prune, as everything would look stale.`);
  }

  const offerIds = new Set();
  for (const product of products) {
    const tptId = product.slug.split("-").pop();
    for (const { suffix } of Object.values(currencyCountryMap)) {
      offerIds.add(`${tptId}-${suffix}`);
    }
  }
  return offerIds;
}

/**
 * Lists every product currently in the account.
 * @param {import("googleapis").merchantapi_products_v1.Merchantapi} productsApi
 */
async function listAllProducts(productsApi) {
  const parent = merchantAccountName();
  const products = [];
  let pageToken;

  do {
    const { data } = await productsApi.accounts.products.list({ parent, pageSize: PAGE_SIZE, pageToken });
    products.push(...(data.products || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return products;
}

async function main() {
  const startTime = performance.now();

  try {
    const expected = await loadExpectedOfferIds();

    const authClient = await initializeAuthClient();
    await authClient.authorize();
    const productsApi = google.merchantapi({ version: "products_v1", auth: authClient });

    const live = await listAllProducts(productsApi);
    console.log(`Merchant Center holds ${live.length} products; the feed defines ${expected.size} offers.`);

    const stale = live.filter((product) => !expected.has(product.offerId));

    if (stale.length === 0) {
      console.log("Nothing to prune.");
      return;
    }

    if (live.length > 0 && stale.length > live.length * MAX_PRUNE_FRACTION) {
      throw new Error(
        `Refusing to prune ${stale.length} of ${live.length} products (over the ` +
          `${MAX_PRUNE_FRACTION * 100}% safety limit). This usually means the feed is incomplete.`,
      );
    }

    console.log(`Pruning ${stale.length} stale offers...`);

    const results = await mapWithConcurrency(
      stale,
      async (product) => {
        // Products are deleted through the input that created them.
        await productsApi.accounts.productInputs.delete({
          name: product.name.replace("/products/", "/productInputs/"),
        });
        console.log(`  deleted ${product.offerId}`);
      },
      DELETE_CONCURRENCY,
    );

    const failures = results.filter((result) => result.status === "rejected");
    for (const failure of failures.slice(0, 5)) {
      console.error("  ", failure.reason?.message || failure.reason);
    }

    console.log(`Pruned ${results.length - failures.length} offers, ${failures.length} failed.`);

    const endTime = performance.now();
    console.log(`Prune completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
