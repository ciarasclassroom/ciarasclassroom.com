import { performance } from "perf_hooks";
import dotenv from "dotenv";
import {
  USER_AGENT,
  TPT_BASE_URL,
  EXCHANGE_RATE_API_BASE_URL,
  SUPPORTED_CURRENCIES,
  getProxyAgent,
  fetchWithRetry,
  saveJSONToFile,
  loadJSONFromFile,
  convertCurrency,
  generateProductUrl,
  currencyCountryMap,
} from "./shared-library.mjs";

// Load environment variables
dotenv.config();

// Constants
const { EXCHANGE_RATE_API_KEY } = process.env;
const VALID_SORT_PARAMS = ["MOST_RECENT", "RELEVANCE"];
const MAX_RESULTS = 500;
const EVALUATION_BATCH_SIZE = 100;
// Smallest fraction of the previous catalogue a fresh scrape may return before we
// treat it as a failed fetch rather than a real change. Override with ALLOW_CATALOGUE_SHRINK=1.
const MIN_CATALOGUE_RETENTION = process.env.ALLOW_CATALOGUE_SHRINK === "1" ? 0 : 0.5;

// Validate API Key
if (!EXCHANGE_RATE_API_KEY) {
  console.error("Error: The EXCHANGE_RATE_API_KEY environment variable is not set.");
  process.exit(1);
}

async function fetchExchangeRates() {
  try {
    const apiUrl = `${EXCHANGE_RATE_API_BASE_URL}${EXCHANGE_RATE_API_KEY}/latest/USD`;
    const { data } = await fetchWithRetry({ url: apiUrl });
    const rates = {};
    SUPPORTED_CURRENCIES.forEach((currency) => {
      rates[currency] = data.conversion_rates[currency];
    });
    return rates;
  } catch (error) {
    console.error("Error fetching exchange rates:", error.message);
    throw error;
  }
}

function parseProducts(products, exchangeRates) {
  return products.map((product) => {
    const usdPrice = product.pricing.nonTransferableLicenses.price;
    const currencies = {};
    SUPPORTED_CURRENCIES.forEach((currency) => {
      currencies[currency] = convertCurrency(usdPrice, "USD", currency, exchangeRates);
    });

    return {
      id: product.id,
      title: product.title,
      link: generateProductUrl(product.canonicalSlug),
      description: product.description,
      descriptionSnippet: product.descriptionSnippet,
      images: product.assets.thumbnails.map((thumbnail) => thumbnail.originalUrl.replace("original", "750f")),
      slug: product.canonicalSlug,
      reviews: product.totalEvaluations,
      rating: product.overallQualityScore,
      // TpT removed the per-resource `resourceCategories` field from their GraphQL schema.
      categories: [],
      currencies: currencies,
    };
  });
}

async function fetchTpTProducts(sortParam, products, exchangeRates) {
  if (!VALID_SORT_PARAMS.includes(sortParam)) {
    throw new Error(`Invalid sort parameter. Choose 'MOST_RECENT' or 'RELEVANCE'.`);
  }

  try {
    const { data } = await fetchWithRetry({
      httpsAgent: getProxyAgent(),
      method: "post",
      url: `${TPT_BASE_URL}/gateway/graphql?opname=StoreResources`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      data: {
        operationName: "StoreResources",
        variables: {
          searchQuery: "",
          pageNumber: 0,
          client: "MARKETPLACE",
          withHighlights: true,
          storeSlug: "ciaras-classroom",
          resourcesPerPage: MAX_RESULTS,
          debug: false,
          sortType: sortParam,
        },
        query: `query StoreResources($storeId: ID, $storeSlug: String, $pageNumber: Int!, $resourcesPerPage: Int!, $searchQuery: String, $sortType: ResourceSearchSortType, $facets: [String], $withHighlights: Boolean, $debug: Boolean!) {
      searchResources(pageNum: $pageNumber, resourcesPerPage: $resourcesPerPage, query: $searchQuery, sortType: $sortType, client: MARKETPLACE, filters: {authorId: $storeId, storeSlug: $storeSlug, tptProducts: ["marketplace"]}, withFacets: ["grades_label", "formats", "subjectareas_label", "resourcetypes_label", "on_sale", "featured", "standards_label", "categories"], inputFacets: $facets, withStores: false, withHighlights: $withHighlights, debug: $debug) {
        totalCount
        conservativeCount
        resources {
          __typename
          id
          assets {
            __typename
          }
          ... on DigitalDownloadResource {
            assets {
              thumbnails {
                originalUrl
                largeUrl
                __typename
              }
              __typename
            }
            __typename
          }
          ... on BundleResource {
            assets {
              thumbnails {
                originalUrl
                __typename
              }
              __typename
            }
            __typename
          }
          ... on OnlineResource {
            assets {
              thumbnails {
                originalUrl
                __typename
              }
              __typename
            }
            __typename
          }
          description
          descriptionSnippet
          canonicalSlug
          pricing {
            nonTransferableLicenses {
              price
              __typename
            }
            __typename
          }
          title
          totalEvaluations
          overallQualityScore
        }
        __typename
      }
    }`,
      },
    });

    if (data.errors?.length) {
      throw new Error(`TpT GraphQL returned errors: ${JSON.stringify(data.errors)}`);
    }

    const resources = data.data?.searchResources?.resources;
    if (!Array.isArray(resources)) {
      throw new Error(`Unexpected TpT response shape: ${JSON.stringify(data).slice(0, 500)}`);
    }

    const parsedProducts = parseProducts(resources, exchangeRates);
    return products.concat(parsedProducts);
  } catch (error) {
    // Deliberately rethrow. Returning the (empty) accumulator here used to make a
    // transient network failure look like "this store has no products", which then
    // got written over the good fixture and emptied every product page on the site.
    console.error(`An error occurred while fetching TpT products:`, error.message);
    throw error;
  }
}

// TpT's satisfaction enum, mapped back to the lowercase tokens the fixture has always
// used (`signals.overall_qual_how_satisfied_stars`) so the Astro pages and the Google
// Merchant review feed keep reading evaluations in one shape, old records and new.
const SATISFACTION_BY_ENUM = {
  EXTREMELY: "extremely",
  VERY: "very",
  MODERATELY: "moderately",
  SLIGHTLY: "slightly",
  NOT_AT_ALL: "not_at_all",
};

const SATISFACTION_BY_RATING = ["not_at_all", "slightly", "moderately", "very", "extremely"];

/**
 * Normalises one evaluation from TpT's `EvaluationConnection` into the legacy
 * fixture record shape.
 */
function normaliseEvaluation(node) {
  const signal = node.signalsMap ?? {};
  const satisfaction =
    SATISFACTION_BY_ENUM[signal.overallSatisfaction] ??
    // LegacyEvaluationSignal has no enum, just a 1-5 `rating`.
    SATISFACTION_BY_RATING[Math.round(signal.rating) - 1] ??
    null;

  return {
    id: node.id,
    updatedAt: node.updatedAt,
    resourceId: node.resourceId,
    userId: node.userId,
    evaluationTypeId: node.evaluationTypeId,
    // TpT dropped `helpfulCount` from the schema; keep the key so existing records
    // and templates that read it stay valid.
    helpfulCount: 0,
    user: { id: node.user?.id, displayName: node.user?.displayName },
    signals: {
      overall_qual_how_satisfied_stars: satisfaction,
      buyer_experience: signal.comment ?? "",
      buyer_experience_title: signal.buyerExperienceTitle ?? null,
    },
  };
}

/**
 * Fetches one page of evaluations for a resource.
 *
 * TpT moved this field off `QualityQuery` and onto the root Query as a Relay
 * connection (`/gateway/graphql`); the old `/graph/graphql` `quality { ... }` form
 * now fails schema validation, which silently zeroed out every product's reviews.
 */
async function fetchProductEvaluations(resourceId, limit = EVALUATION_BATCH_SIZE, after = null) {
  const { data } = await fetchWithRetry({
    httpsAgent: getProxyAgent(),
    method: "post",
    url: `${TPT_BASE_URL}/gateway/graphql?opname=filterEvaluationsByResource`,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    data: {
      operationName: "filterEvaluationsByResource",
      variables: { resourceId, first: limit, after, sortBy: "mostRecent" },
      query: `query filterEvaluationsByResource($resourceId: ID!, $first: Int, $after: String, $sortBy: String) {
        filterEvaluationsByResource(resourceId: $resourceId, filters: {}, sortBy: $sortBy, pagination: {first: $first, after: $after}) {
          totalCount
          pageInfo {
            hasNextPage
            lastCursor
          }
          edges {
            cursor
            node {
              id
              createdAt
              updatedAt
              resourceId
              userId
              evaluationTypeId
              userTotalEvaluations
              user {
                id
                displayName
              }
              signalsMap {
                __typename
                ... on LegacyEvaluationSignal {
                  id
                  rating
                  signalVersion
                  comment
                }
                ... on V1EvaluationSignal {
                  id
                  signalVersion
                  comment
                  buyerExperienceTitle
                  overallSatisfaction
                  gradesUsed
                }
              }
            }
          }
        }
      }`,
    },
  });

  if (data.errors?.length) {
    throw new Error(`TpT GraphQL returned errors: ${JSON.stringify(data.errors)}`);
  }

  const connection = data.data?.filterEvaluationsByResource;
  if (!connection) {
    throw new Error(`Unexpected evaluations response for ${resourceId}: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const edges = connection.edges ?? [];
  return {
    evaluations: edges.map((edge) => normaliseEvaluation(edge.node)),
    hasNext: connection.pageInfo?.hasNextPage ?? false,
    cursor: connection.pageInfo?.lastCursor ?? edges.at(-1)?.cursor ?? null,
  };
}

/**
 * Fetches every evaluation for a resource, following the connection cursor.
 *
 * Returns `null` (rather than an empty list) if the fetch fails, so callers can tell
 * "this resource has no reviews" apart from "we could not read its reviews" and keep
 * whatever was previously scraped.
 */
async function fetchAllProductEvaluations(resourceId) {
  const all = [];
  let after = null;

  try {
    for (;;) {
      const page = await fetchProductEvaluations(resourceId, EVALUATION_BATCH_SIZE, after);
      all.push(...page.evaluations);
      if (!page.hasNext || !page.cursor) break;
      after = page.cursor;
    }
  } catch (error) {
    console.error(`Error fetching evaluations for resource ${resourceId}:`, error.message);
    return null;
  }

  return all;
}

async function main() {
  const startTime = performance.now();
  try {
    const sortParam = process.argv[2] || "MOST_RECENT";
    if (!VALID_SORT_PARAMS.includes(sortParam)) {
      throw new Error(`Invalid sort parameter: ${sortParam}. Choose 'MOST_RECENT' or 'RELEVANCE'.`);
    }

    console.log(`Fetching exchange rates...`);
    const exchangeRates = await fetchExchangeRates();
    console.log(`Exchange rates fetched for: ${SUPPORTED_CURRENCIES.join(", ")}`);

    console.log(`Fetching TpT products with sort parameter: ${sortParam}`);
    const newProducts = await fetchTpTProducts(sortParam, [], exchangeRates);
    console.log(`Fetched ${newProducts.length} products in total.`);

    const previousProducts = await loadJSONFromFile(`tpt_products_${sortParam}.json`);

    if (!previousProducts) {
      console.log("No previous data found. Fetching all evaluations...");
    }

    let evaluationFailures = 0;

    for (const newProduct of newProducts) {
      if (newProduct.reviews <= 0) continue;

      const previousProduct = previousProducts?.find((p) => p.id === newProduct.id);
      const previousEvaluations = previousProduct?.evaluations || [];

      // Only re-scrape when the review count actually moved; otherwise reuse what we
      // already have. Saves ~200 requests a night.
      //
      // The `previousEvaluations.length` test is the self-heal: a product that TpT says
      // has reviews but for which we hold none means the last scrape lost them (as
      // happened when TpT moved `filterEvaluationsByResource` off `QualityQuery`), so
      // re-fetch instead of copying the hole forward forever.
      const previousIsComplete = previousEvaluations.length > 0;
      if (previousProduct && previousIsComplete && newProduct.reviews <= previousProduct.reviews) {
        newProduct.evaluations = previousEvaluations;
        continue;
      }

      console.log(`Fetching evaluations for product ${newProduct.id}`);
      const evaluations = await fetchAllProductEvaluations(newProduct.id);

      if (evaluations === null) {
        // Fetch failed. Keep the reviews we already had rather than blanking them.
        evaluationFailures += 1;
        newProduct.evaluations = previousEvaluations;
        console.log(`  kept ${previousEvaluations.length} previously-scraped evaluations for ${newProduct.id}`);
        continue;
      }

      newProduct.evaluations = evaluations;
      console.log(`Fetched ${evaluations.length} evaluations for product ${newProduct.id}`);
    }

    if (evaluationFailures > 0) {
      console.warn(`Warning: evaluations could not be refreshed for ${evaluationFailures} product(s).`);
    }

    // Never publish an empty or drastically-shrunken catalogue. A scrape that comes
    // back thin is far more likely to be a network/API problem than Ciara actually
    // deleting her store, and overwriting the fixture with it takes every product
    // page (and the Google Merchant feed) down until someone notices.
    if (newProducts.length === 0) {
      throw new Error(`Refusing to save: fetched 0 products for ${sortParam}. Keeping the existing fixture.`);
    }

    const previousCount = previousProducts?.length ?? 0;
    if (previousCount > 0 && newProducts.length < previousCount * MIN_CATALOGUE_RETENTION) {
      throw new Error(
        `Refusing to save: fetched ${newProducts.length} products for ${sortParam}, ` +
          `down from ${previousCount} (below the ${MIN_CATALOGUE_RETENTION * 100}% retention floor). ` +
          `Keeping the existing fixture. Re-run with ALLOW_CATALOGUE_SHRINK=1 if this drop is real.`,
      );
    }

    await saveJSONToFile(newProducts, `tpt_products_${sortParam}.json`);
    const endTime = performance.now();
    console.log(`Process completed successfully in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
