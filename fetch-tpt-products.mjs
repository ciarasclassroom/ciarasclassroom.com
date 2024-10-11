import { performance } from 'perf_hooks';
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
  currencyCountryMap
} from './shared-library.mjs';

// Load environment variables
dotenv.config();

// Constants
const { EXCHANGE_RATE_API_KEY } = process.env;
const VALID_SORT_PARAMS = ["MOST_RECENT", "RELEVANCE"];
const MAX_RESULTS = 500;
const EVALUATION_BATCH_SIZE = 100;

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
    SUPPORTED_CURRENCIES.forEach(currency => {
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
    SUPPORTED_CURRENCIES.forEach(currency => {
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
      categories: product.resourceCategories.map((resourceCategory) => resourceCategory.name),
      currencies: currencies
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
          resourceCategories {
            id
            name
            __typename
          }
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

    const parsedProducts = parseProducts(data.data.searchResources.resources, exchangeRates);
    return products.concat(parsedProducts);
  } catch (error) {
    console.error(`An error occurred while fetching TpT products:`, error);
    return products;
  }
}

async function fetchProductEvaluations(resourceId, limit = EVALUATION_BATCH_SIZE, offset = 0) {
  try {
    const { data } = await fetchWithRetry({
      httpsAgent: getProxyAgent(),
      method: "post",
      url: `${TPT_BASE_URL}/graph/graphql?opname=filterEvaluationsByResource`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      data: {
        operationName: "filterEvaluationsByResource",
        variables: {
          resourceId,
          grades: "",
          ratings: "",
          spedOptions: "",
          standards: "",
          limit,
          offset,
          sortBy: "mostRecent"
        },
        query: `query filterEvaluationsByResource($resourceId: ID!, $grades: String, $ratings: String, $spedOptions: String, $standards: String, $limit: Int, $offset: Int, $sortBy: String) {
          quality {
            filterEvaluationsByResource(resourceId: $resourceId, grades: $grades, ratings: $ratings, spedOptions: $spedOptions, standards: $standards, limit: $limit, offset: $offset, sortBy: $sortBy) {
              total
              hasNext
              evaluations {
                id
                updatedAt
                signals
                resourceId
                userId
                helpfulCount
                hasUserMarkedHelpful
                evaluationTypeId
                sellerId
                user {
                  id
                  displayName
                }
              }
            }
          }
        }`
      },
    });

    return data.data.quality.filterEvaluationsByResource;
  } catch (error) {
    console.error(`Error fetching evaluations for resource ${resourceId}:`, error.message);
    return null;
  }
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

    if (previousProducts) {
      for (const newProduct of newProducts) {
        if (newProduct.reviews > 0) {
          const previousProduct = previousProducts.find(p => p.id === newProduct.id);
          if (!previousProduct || newProduct.reviews > previousProduct.reviews) {
            console.log(`Fetching evaluations for product ${newProduct.id}`);
            let allEvaluations = [];
            let hasNext = true;
            let offset = 0;

            while (hasNext) {
              const evaluationsData = await fetchProductEvaluations(newProduct.id, EVALUATION_BATCH_SIZE, offset);
              if (evaluationsData) {
                allEvaluations = allEvaluations.concat(evaluationsData.evaluations);
                hasNext = evaluationsData.hasNext;
                offset += EVALUATION_BATCH_SIZE;
              } else {
                hasNext = false;
              }
            }

            newProduct.evaluations = allEvaluations;
            console.log(`Fetched ${allEvaluations.length} evaluations for product ${newProduct.id}`);
          } else {
            newProduct.evaluations = previousProduct.evaluations || [];
          }
        }
      }
    } else {
      console.log("No previous data found. Fetching all evaluations...");
      for (const product of newProducts) {
        if (product.reviews > 0) {
          console.log(`Fetching evaluations for product ${product.id}`);
          let allEvaluations = [];
          let hasNext = true;
          let offset = 0;

          while (hasNext) {
            const evaluationsData = await fetchProductEvaluations(product.id, EVALUATION_BATCH_SIZE, offset);
            if (evaluationsData) {
              allEvaluations = allEvaluations.concat(evaluationsData.evaluations);
              hasNext = evaluationsData.hasNext;
              offset += EVALUATION_BATCH_SIZE;
            } else {
              hasNext = false;
            }
          }

          product.evaluations = allEvaluations;
          console.log(`Fetched ${allEvaluations.length} evaluations for product ${product.id}`);
        }
      }
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