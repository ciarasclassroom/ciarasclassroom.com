import xml2js from 'xml2js';
import { performance } from 'perf_hooks';
import {
  MERCHANT_ID,
  TPT_BASE_URL,
  SUPPORTED_CURRENCIES,
  initializeAuthClient,
  loadJSONFromFile,
  saveJSONToFile,
  currencyCountryMap,
  generateProductUrl
} from './shared-library.mjs';

const INPUT_FILE = 'src/lib/fixtures/tpt_products_MOST_RECENT.json';
const OUTPUT_FILE = './google_merchant_reviews.xml';

/**
 * Converts a date string to ISO format
 * @param {string} dateString - Date string to convert
 * @returns {string} ISO formatted date string
 */
const toISOString = (dateString) => new Date(dateString).toISOString();

/**
 * Formats a rating value with min and max attributes
 * @param {number} rating - Rating value
 * @returns {Object} Formatted rating object
 */
const formatRating = (rating) => ({
  _: rating,
  $: { min: "1", max: "5" }
});

/**
 * Creates product IDs for a given product and country code
 * @param {Object} product - Product object
 * @param {string} countryCode - Country code
 * @returns {Object} Product IDs object
 */
const createProductIds = (product, countryCode) => {
  const productIds = {};
  const idSuffix = `-${countryCode}`;
  
  productIds.gtins = { gtin: [product.gtin || `${product.id}${idSuffix}`] };
  productIds.mpns = { mpn: [product.mpn || `${product.id}${idSuffix}`] };
  productIds.brands = { brand: ["Ciara's Classroom"] };
  
  if (product.id) {
    productIds.skus = { sku: [`${product.id}${idSuffix}`] };
  }
  
  return productIds;
};

/**
 * Converts a review to the format required by Google Merchant Center
 * @param {Object} review - Review object
 * @param {Object} product - Product object
 * @param {string} currency - Currency code
 * @returns {Object} Converted review object
 */
const convertReview = (review, product, currency) => {
  const { country, suffix } = currencyCountryMap[currency] || { country: "US", suffix: "" };
  const productUrl = generateProductUrl(product.slug, suffix);
  const uniqueReviewId = `${review.id}-${currency}`;

  return {
    review_id: uniqueReviewId,
    reviewer: {
      name: [{ _: review.user.displayName, $: { is_anonymous: "false" } }],
      reviewer_id: review.user.id
    },
    review_timestamp: toISOString(review.updatedAt),
    title: review.title || "Review",
    content: review.signals.buyer_experience || '',
    review_url: [{ _: productUrl, $: { type: 'singleton' } }],
    ratings: {
      overall: formatRating(
        review.signals.overall_qual_how_satisfied_stars === 'extremely' ? 5 :
        review.signals.overall_qual_how_satisfied_stars === 'very' ? 4 :
        review.signals.overall_qual_how_satisfied_stars === 'moderately' ? 3 :
        review.signals.overall_qual_how_satisfied_stars === 'slightly' ? 2 : 1
      )
    },
    products: {
      product: {
        product_ids: createProductIds(product, country),
        product_name: product.title,
        product_url: productUrl
      }
    },
    is_spam: "false",
    collection_method: "post_fulfillment",
    transaction_id: `fulfillment_transaction_${uniqueReviewId}`
  };
};

/**
 * Converts product reviews to XML format
 * @param {Array} products - Array of product objects with reviews
 * @returns {string} XML string of reviews
 */
const convertReviewsToXml = (products) => {
  const xmlObj = {
    $: {
      'xmlns:vc': 'http://www.w3.org/2007/XMLSchema-versioning',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:noNamespaceSchemaLocation': 'http://www.google.com/shopping/reviews/schema/product/2.3/product_reviews.xsd'
    },
    version: '2.3',
    aggregator: { name: 'Teachers Pay Teachers' },
    publisher: {
      name: 'Teachers Pay Teachers',
      favicon: `${TPT_BASE_URL}/favicon.ico`
    },
    reviews: {
      review: products.flatMap(product => 
        SUPPORTED_CURRENCIES.flatMap(currency =>
          (product.evaluations || []).map(review => 
            convertReview(review, product, currency)
          )
        )
      )
    }
  };

  const builder = new xml2js.Builder({
    rootName: 'feed',
    xmldec: { version: '1.0', encoding: 'UTF-8' },
    renderOpts: { pretty: true, indent: '    ', newline: '\n' },
    headless: true
  });

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.buildObject(xmlObj);
};

/**
 * Main execution function
 */
const main = async () => {
  const startTime = performance.now();
  try {
    console.log(`Reading product data from ${INPUT_FILE}...`);
    const inputData = await loadJSONFromFile(INPUT_FILE, '');
    if (!inputData || inputData.length === 0) {
      throw new Error('No product data found in input file.');
    }
    console.log(`Loaded ${inputData.length} products.`);

    console.log('Converting reviews to XML format...');
    const xmlOutput = convertReviewsToXml(inputData);

    console.log(`Saving XML output to ${OUTPUT_FILE}...`);
    await saveJSONToFile(xmlOutput, OUTPUT_FILE);
    console.log('XML file has been created successfully.');

    // TODO: Implement review upload functionality
    // console.log('Uploading product reviews to Google Merchant Center...');
    // await uploadProductReviews(xmlOutput);
    // console.log('Product reviews have been uploaded to Google Merchant Center.');

    const endTime = performance.now();
    console.log(`Process completed successfully in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error('An unexpected error occurred:', error.message);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});