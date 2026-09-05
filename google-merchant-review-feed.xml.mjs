import xml2js from "xml2js";
import fs from "fs/promises";
import {
  MERCHANT_ID,
  initializeAuthClient,
  loadJSONFromFile,
  currencyCountryMap,
  generateProductUrl,
} from "./shared-library.mjs";

// Helper functions
const toISOString = (dateString) => new Date(dateString).toISOString();

const formatRating = (rating) => ({
  _: rating,
  $: {
    min: "1",
    max: "5",
  },
});

// These are digital resources with no GTIN or manufacturer part number, and the
// product feed says so (`identifierExists: false`). The feed used to synthesise
// `<gtin>`/`<mpn>` from the TpT id, which is a fabricated identifier -- Google either
// rejects it or matches it to the wrong item. Match on SKU + brand instead: the SKU
// here is exactly the `offerId` google-merchent.mjs uploads (`<tptId>-<country>`).
//
// Order matters in the 2.3 schema: gtins, mpns, brands, asins, skus.
const createProductIds = (product, countryCode) => ({
  brands: { brand: ["Ciara's Classroom"] },
  skus: { sku: [`${product.id}-${countryCode}`] },
});

const convertReview = (review, product, currency) => {
  const { country, suffix } = currencyCountryMap[currency] || { country: "US", suffix: "" };
  const productUrl = generateProductUrl(product.slug, suffix);

  // Create a unique review ID by combining the original ID and the currency
  const uniqueReviewId = `${review.id}-${currency}`;

  return {
    review_id: uniqueReviewId,
    reviewer: {
      name: [{ _: review.user.displayName, $: { is_anonymous: "false" } }],
      reviewer_id: review.user.id,
    },
    review_timestamp: toISOString(review.updatedAt),
    ...(review.signals.buyer_experience_title ? { title: review.signals.buyer_experience_title } : {}),
    content: review.signals.buyer_experience || "",
    review_url: [{ _: productUrl + "#review-" + uniqueReviewId, $: { type: "singleton" } }],
    ratings: {
      overall: formatRating(
        review.signals.overall_qual_how_satisfied_stars === "extremely"
          ? 5
          : review.signals.overall_qual_how_satisfied_stars === "very"
            ? 4
            : review.signals.overall_qual_how_satisfied_stars === "moderately"
              ? 3
              : review.signals.overall_qual_how_satisfied_stars === "slightly"
                ? 2
                : 1,
      ),
    },
    products: {
      product: {
        product_ids: createProductIds(product, country),
        product_name: product.title,
        product_url: productUrl,
      },
    },
    is_spam: "false",
    collection_method: "post_fulfillment",
    transaction_id: `fulfillment_transaction_${uniqueReviewId}`,
  };
};

const convertReviewsToXml = (inputData) => {
  const products = inputData;
  const xmlObj = {
    $: {
      "xmlns:vc": "http://www.w3.org/2007/XMLSchema-versioning",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "xsi:noNamespaceSchemaLocation": "http://www.google.com/shopping/reviews/schema/product/2.3/product_reviews.xsd",
    },
    version: "2.3",
    aggregator: {
      name: "Teachers Pay Teachers",
    },
    publisher: {
      name: "Ciara's Classroom",
      favicon: "https://ciarasclassroom.com/favicon.ico",
    },
    reviews: {
      review: products.flatMap((product) =>
        Object.keys(currencyCountryMap).flatMap((currency) =>
          (product.evaluations || []).map((review) => convertReview(review, product, currency)),
        ),
      ),
    },
  };

  const builder = new xml2js.Builder({
    rootName: "feed",
    xmldec: { version: "1.0", encoding: "UTF-8" },
    renderOpts: { pretty: true, indent: "    ", newline: "\n" },
    headless: true,
  });

  let xmlString = builder.buildObject(xmlObj);
  xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlString;

  return xmlString;
};

const saveXMLToFile = async (xmlContent, filename) => {
  try {
    await fs.writeFile(filename, xmlContent, "utf8");
    console.log(`XML content has been saved to ${filename}`);
  } catch (error) {
    console.error(`Error writing XML to file: ${error.message}`);
    throw error;
  }
};

// Written into public/ so the built site serves it at
// https://ciarasclassroom.com/product-reviews.xml. Register that URL in Merchant
// Center as a scheduled "Product reviews" feed; Google then re-fetches it itself,
// which is why nothing here needs the Content API.
const OUTPUT_PATH = "public/product-reviews.xml";

const main = async () => {
  try {
    const products = await loadJSONFromFile("tpt_products_MOST_RECENT.json");

    if (!Array.isArray(products) || products.length === 0) {
      throw new Error("No products found in tpt_products_MOST_RECENT.json — refusing to write an empty review feed.");
    }

    const reviewCount = products.reduce((total, product) => total + (product.evaluations?.length || 0), 0);
    if (reviewCount === 0) {
      throw new Error("No evaluations found on any product — refusing to write an empty review feed.");
    }

    const xmlOutput = convertReviewsToXml(products);
    await saveXMLToFile(xmlOutput, OUTPUT_PATH);

    console.log(
      `Review feed written: ${reviewCount} reviews across ${products.length} products ` +
        `(x${Object.keys(currencyCountryMap).length} country variants).`,
    );
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
