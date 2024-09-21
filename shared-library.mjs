import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

// Constants
export const MERCHANT_ID = process.env.MERCHANT_ID;
export const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH || "token.json";
export const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";
export const TPT_BASE_URL = "https://www.teacherspayteachers.com";
export const EXCHANGE_RATE_API_BASE_URL = "https://v6.exchangerate-api.com/v6/";
export const INSTAGRAM_BASE_URL = "https://www.instagram.com";
export const MAIN_SITE_URL = "https://ciarasclassroom.com";

// Currency and country mappings
export const currencyCountryMap = {
  USD: { country: "US", suffix: "US" },
  CAD: { country: "CA", suffix: "CA" },
  GBP: { country: "GB", suffix: "UK" },
  EUR: { country: "IE", suffix: "IE" },
  AUD: { country: "AU", suffix: "AU" },
  NZD: { country: "NZ", suffix: "NZ" },
  SGD: { country: "SG", suffix: "SG" },
  HKD: { country: "HK", suffix: "HK" },
  ZAR: { country: "ZA", suffix: "ZA" },
  INR: { country: "IN", suffix: "IN" },
  MYR: { country: "MY", suffix: "MY" },
  PHP: { country: "PH", suffix: "PH" },
  AED: { country: "AE", suffix: "AE" }
};

export const SUPPORTED_CURRENCIES = Object.keys(currencyCountryMap);

/**
 * Returns an HTTPS proxy agent if a proxy is set in environment variables
 * @returns {HttpsProxyAgent|null} Proxy agent or null if no proxy is set
 */
export const getProxyAgent = () => {
  const proxy = process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? new HttpsProxyAgent(proxy) : null;
};

/**
 * Performs an HTTP request with retry capability
 * @param {Object} options - Axios request options
 * @param {number} retries - Number of retries (default: 3)
 * @param {number} delay - Delay between retries in milliseconds (default: 1000)
 * @returns {Promise<Object>} Axios response object
 */
export const fetchWithRetry = async (options, retries = 3, delay = 1000) => {
  try {
    return await axios(options);
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying... (${4 - retries}/3)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(options, retries - 1, delay);
    }
    throw error;
  }
};

/**
 * Initializes and returns an authenticated Google JWT client
 * @returns {Promise<google.auth.JWT>} Authenticated JWT client
 */
export const initializeAuthClient = async () => {
  try {
    const serviceAccountKey = JSON.parse(
      await fs.readFile(SERVICE_ACCOUNT_PATH, "utf-8")
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
};

/**
 * Saves JSON data to a file
 * @param {Object|Array} data - Data to be saved
 * @param {string} fileName - Name of the file
 * @param {string} directory - Directory to save the file (default: "src/lib/fixtures")
 * @returns {Promise<void>}
 */
export const saveJSONToFile = async (data, fileName, directory = "src/lib/fixtures") => {
  try {
    const jsonString = JSON.stringify(data, null, 2);
    const filePath = path.join(directory, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonString, "utf-8");
    console.log(`Data saved successfully to ${filePath}.`);
  } catch (error) {
    console.error("An error occurred while saving the JSON file:", error.message);
    throw error;
  }
};

/**
 * Loads JSON data from a file
 * @param {string} fileName - Name of the file to load
 * @param {string} directory - Directory of the file (default: "src/lib/fixtures")
 * @returns {Promise<Object|Array|null>} Parsed JSON data or null if file not found
 */
export const loadJSONFromFile = async (fileName, directory = "src/lib/fixtures") => {
  try {
    const filePath = path.join(directory, fileName);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.log("No data found or error reading file:", error.message);
    return null;
  }
};

/**
 * Generates a product URL for the main site
 * @param {string} slug - Product slug
 * @param {string} suffix - Country-specific suffix
 * @returns {string} Full product URL
 */
export const generateProductUrl = (slug, suffix) => {
  return `${MAIN_SITE_URL}/product/${slug}${suffix ? `-${suffix}` : ''}`;
};

/**
 * Generates an Instagram post URL
 * @param {string} shortcode - Instagram post shortcode
 * @returns {string} Full Instagram post URL
 */
export const generateInstagramPostUrl = (shortcode) => {
  return `${INSTAGRAM_BASE_URL}/p/${shortcode}/`;
};

/**
 * Converts an amount from one currency to another
 * @param {number} amount - Amount to convert
 * @param {string} fromCurrency - Source currency code
 * @param {string} toCurrency - Target currency code
 * @param {Object} rates - Exchange rates object
 * @returns {string} Converted amount (fixed to 2 decimal places)
 */
export const convertCurrency = (amount, fromCurrency, toCurrency, rates) => {
  if (fromCurrency === toCurrency) return amount.toFixed(2);
  const inUSD = amount / rates[fromCurrency];
  return (inUSD * rates[toCurrency]).toFixed(2);
};

/**
 * Fetches current exchange rates
 * @param {string} apiKey - Exchange rate API key
 * @returns {Promise<Object>} Exchange rates object
 */
export const fetchExchangeRates = async (apiKey) => {
  try {
    const apiUrl = `${EXCHANGE_RATE_API_BASE_URL}${apiKey}/latest/USD`;
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

/**
 * Validates that required environment variables are set
 * @param {string[]} requiredVars - Array of required environment variable names
 * @throws {Error} If any required variable is not set
 */
export const validateEnvironmentVariables = (requiredVars) => {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
};

/**
 * Sleeps for a specified number of milliseconds
 * @param {number} ms - Number of milliseconds to sleep
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Chunks an array into smaller arrays of a specified size
 * @param {Array} array - The array to be chunked
 * @param {number} size - The size of each chunk
 * @returns {Array} An array of chunked arrays
 */
export const chunkArray = (array, size) => {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
    array.slice(index * size, (index + 1) * size)
  );
};