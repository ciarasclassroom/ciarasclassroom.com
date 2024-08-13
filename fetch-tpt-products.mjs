import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";

// Fetch proxy agent if available
const getProxyAgent = () => {
  const proxy = process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? new HttpsProxyAgent(proxy) : null;
};

// Fetch Instagram posts
const fetchTpTProducts = async () => {
  try {
    const response = await axios.get(
      "https://www.teacherspayteachers.com/store/ciaras-classroom?order=Most-Recent",
      {
        httpsAgent: getProxyAgent(),
        headers: {
          "User-Agent": USER_AGENT,
        },
      },
    );

    const $ = cheerio.load(response.data);
    const products = [];

    $(".ProductRowLayout").each((index, element) => {
      const title = $(element).find("h2").text().trim();
      const image = $(element).find("picture img").attr("src");
      const description = $(element)
        .find("[class*='ProductRowCard-module__cardDescription']")
        .text()
        .trim();
      const price = $(element)
        .find(
          "[class*='ProductPrice-module__price'] [class*='Text-module__root']",
        )
        .text()
        .trim();
      const link =
        "https://www.teacherspayteachers.com" +
        $(element).find("a").attr("href");
      products.push({ title, image, description, price, link });
    });

    return products.slice(0, 4);
  } catch (error) {
    console.error("An error occurred while fetching TpT products:", error);
    return [];
  }
};

// Save posts data to JSON file
const saveProductsToFile = async (posts) => {
  try {
    const jsonString = JSON.stringify(posts, null, 2);
    const filePath = path.join("src", "lib", "fixtures", "tpt_products.json");

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonString, "utf-8");

    console.log("TpT products data saved successfully.");
  } catch (error) {
    console.error("An error occurred while saving the JSON file:", error);
  }
};

// Main execution function
const main = async () => {
  const products = await fetchTpTProducts();
  await saveProductsToFile(products);
};

main().catch((error) => console.error("An unexpected error occurred:", error));
