import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Constants
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const { EXCHANGE_RATE_API_KEY } = process.env;
const BASE_API_URL = "https://v6.exchangerate-api.com/v6/";
const VALID_SORT_PARAMS = ["MOST_RECENT", "RELEVANCE"];
const FILE_DIR = path.join("src", "lib", "fixtures");
const TPT_BASE_URL = "https://www.teacherspayteachers.com";
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const SUPPORTED_CURRENCIES = ["USD", "CAD", "GBP", "EUR"]; // Add more currencies as needed

// Validate API Key
if (!EXCHANGE_RATE_API_KEY) {
  console.error(
    "Error: The EXCHANGE_RATE_API_KEY environment variable is not set.",
  );
  process.exit(1);
}

// Helper Functions
const getProxyAgent = () => {
  const proxy = process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? new HttpsProxyAgent(proxy) : null;
};

const fetchWithRetry = async (options, retries = MAX_RETRIES) => {
  try {
    return await axios(options);
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(options, retries - 1);
    }
    throw error;
  }
};

const fetchExchangeRates = async () => {
  try {
    const apiUrl = `${BASE_API_URL}${EXCHANGE_RATE_API_KEY}/latest/USD`;
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
};

const convertCurrency = (amount, fromCurrency, toCurrency, rates) => {
  if (fromCurrency === toCurrency) return amount;
  const inUSD = amount / rates[fromCurrency];
  return (inUSD * rates[toCurrency]).toFixed(2);
};

const parseProducts = async (products, exchangeRates) => {
  return products.map((product) => {
    const usdPrice = product.pricing.nonTransferableLicenses.price;
    const currencies = {};
    SUPPORTED_CURRENCIES.forEach(currency => {
      currencies[currency] = convertCurrency(usdPrice, "USD", currency, exchangeRates);
    });

    return {
      id: product.id,
      title: product.title,
      link: `https://teacherspayteachers.com/Product/${product.canonicalSlug}`,
      description: product.description,
      descriptionSnippet: product.descriptionSnippet,
      images: product.assets.thumbnails.map((thumbnail) => thumbnail.originalUrl),
      slug: product.canonicalSlug,
      reviews: product.totalEvaluations,
      rating: product.overallQualityScore,
      categories: product.resourceCategories.map((resourceCategory) => resourceCategory.name),
      currencies: currencies
    };
  });
};

const fetchTpTProducts = async (sortParam, products = [], exchangeRates) => {
  if (!VALID_SORT_PARAMS.includes(sortParam)) {
    throw new Error(
      `Invalid sort parameter. Choose 'MOST_RECENT' or 'RELEVANCE'.`,
    );
  }

  try {
    const { data } = await fetchWithRetry({
      httpsAgent: getProxyAgent(),
      method: "post",
      url: "https://www.teacherspayteachers.com/gateway/graphql?opname=StoreResources",
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
          resourcesPerPage: 500,
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

    const parsedProducts = await parseProducts(data.data.searchResources.resources, exchangeRates);
    products = products.concat(parsedProducts);

    console.log(`Fetched ${parsedProducts.length} products`);

    return products;
  } catch (error) {
    console.error(
      `An error occurred while fetching TpT products:`,
      error,
    );
    return products;
  }
};

const fetchProductEvaluations = async (resourceId, limit = 100, offset = 0) => {
  try {
    const { data } = await fetchWithRetry({
      httpsAgent: getProxyAgent(),
      method: "post",
      url: "https://www.teacherspayteachers.com/graph/graphql?opname=filterEvaluationsByResource",
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

    console.log(JSON.stringify(data));

    return data.data.quality.filterEvaluationsByResource;
  } catch (error) {
    console.error(`Error fetching evaluations for resource ${resourceId}:`, error.message);
    return null;
  }
};

const saveProductsToFile = async (products, sortParam) => {
  try {
    const jsonString = JSON.stringify(products, null, 2);
    const filePath = path.join(FILE_DIR, `tpt_products_${sortParam}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonString, "utf-8");
    console.log(`TpT products data saved successfully to ${filePath}.`);
  } catch (error) {
    console.error(
      "An error occurred while saving the JSON file:",
      error.message,
    );
    throw error;
  }
};

const loadPreviousProducts = async (sortParam) => {
  try {
    const filePath = path.join(FILE_DIR, `tpt_products_${sortParam}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.log("No previous data found or error reading file:", error.message);
    return null;
  }
};

// Main Execution
const main = async () => {
  try {
    const sortParam = process.argv[2] || "MOST_RECENT";
    if (!VALID_SORT_PARAMS.includes(sortParam)) {
      throw new Error(
        `Invalid sort parameter: ${sortParam}. Choose 'MOST_RECENT' or 'RELEVANCE'.`,
      );
    }

    console.log(`Fetching exchange rates...`);
    const exchangeRates = await fetchExchangeRates();
    console.log(`Exchange rates fetched for: ${Object.keys(exchangeRates).join(", ")}`);

    console.log(`Fetching TpT products with sort parameter: ${sortParam}`);
    const newProducts = await fetchTpTProducts(sortParam, [], exchangeRates);
    console.log(`Fetched ${newProducts.length} products in total.`);

    const previousProducts = await loadPreviousProducts(sortParam);

    if (previousProducts) {
      for (const newProduct of newProducts) {
        if(newProduct.reviews > 0) {
        const previousProduct = previousProducts.find(p => p.id === newProduct.id);
        if (!previousProduct || newProduct.reviews > previousProduct.reviews) {
          console.log(`Fetching evaluations for product ${newProduct.id}`);
          let allEvaluations = [];
          let hasNext = true;
          let offset = 0;

          while (hasNext) {
            const evaluationsData = await fetchProductEvaluations(newProduct.id, 100, offset);
            if (evaluationsData) {
              allEvaluations = allEvaluations.concat(evaluationsData.evaluations);
              hasNext = evaluationsData.hasNext;
              offset += 100;
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
        console.log(`Fetching evaluations for product ${product.id}`);
        let allEvaluations = [];
        let hasNext = true;
        let offset = 0;
        if(product.reviews > 0) {
        while (hasNext) {
          const evaluationsData = await fetchProductEvaluations(product.id, 100, offset);
          if (evaluationsData) {
            allEvaluations = allEvaluations.concat(evaluationsData.evaluations);
            hasNext = evaluationsData.hasNext;
            offset += 100;
          } else {
            hasNext = false;
          }
        }
      }

        product.evaluations = allEvaluations;
        console.log(`Fetched ${allEvaluations.length} evaluations for product ${product.id}`);
      }
    }

    await saveProductsToFile(newProducts, sortParam);
    console.log("Process completed successfully.");
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});