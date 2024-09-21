import xml2js from 'xml2js';
import fs from 'fs/promises';
import {
  MERCHANT_ID,
  initializeAuthClient,
  loadJSONFromFile,
  currencyCountryMap,
  generateProductUrl
} from './shared-library.mjs';

// Helper functions
const toISOString = (dateString) => new Date(dateString).toISOString();

const formatRating = (rating) => ({
  _: rating,
  $: {
    min: "1",
    max: "5"
  }
});

const createProductIds = (product, countryCode) => {
  const productIds = {};
  
  // Order matters: gtins, mpns, brands, asins, skus
  productIds.gtins = { gtin: [product.gtin || `${product.id}-${countryCode}`] };
  productIds.mpns = { mpn: [product.mpn || `${product.id}-${countryCode}`] };
  productIds.brands = { brand: ["Ciara's Classroom"] };
  // productIds.asins = { asin: [product.asin || `${product.id}-${countryCode}`] };
  
  // Include SKU if available
  if (product.id) {
    productIds.skus = { sku: [`${product.id}-${countryCode}`] };
  }
  
  return productIds;
};

const convertReview = (review, product, currency) => {
  const { country, suffix } = currencyCountryMap[currency] || { country: "US", suffix: "" };
  const productUrl = generateProductUrl(product.slug, suffix);

  // Create a unique review ID by combining the original ID and the currency
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

const convertReviewsToXml = (inputData) => {
  const products = inputData;
  const xmlObj = {
    $: {
      'xmlns:vc': 'http://www.w3.org/2007/XMLSchema-versioning',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:noNamespaceSchemaLocation': 'http://www.google.com/shopping/reviews/schema/product/2.3/product_reviews.xsd'
    },
    version: '2.3',
    aggregator: {
      name: 'Teachers Pay Teachers'
    },
    publisher: {
      name: 'Teachers Pay Teachers',
      favicon: 'https://www.teacherspayteachers.com/favicon.ico'
    },
    reviews: {
      review: products.flatMap(product => 
        Object.keys(currencyCountryMap).flatMap(currency =>
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

  let xmlString = builder.buildObject(xmlObj);
  xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlString;

  return xmlString;
};

const saveXMLToFile = async (xmlContent, filename) => {
  try {
    await fs.writeFile(filename, xmlContent, 'utf8');
    console.log(`XML content has been saved to ${filename}`);
  } catch (error) {
    console.error(`Error writing XML to file: ${error.message}`);
    throw error;
  }
};

const main = async () => {
  try {
    // Read input JSON file
    const inputData = await loadJSONFromFile('input.json', '');

    // Convert reviews to XML
    const xmlOutput = convertReviewsToXml(inputData);

    // Write output XML file directly
    await saveXMLToFile(xmlOutput, 'output.xml');
    console.log('XML file has been created successfully.');

    // Upload product reviews
    // await uploadProductReviews(xmlOutput);
    console.log('Product reviews have been uploaded to Google Merchant Center.');
  } catch (error) {
    console.error('An unexpected error occurred:', error.message);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});