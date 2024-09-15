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

// Currency and country mappings
export const currencyCountryMap = {
  USD: { country: "US", suffix: "US" },
  CAD: { country: "CA", suffix: "CA" },
  GBP: { country: "GB", suffix: "UK" },
  EUR: { country: "IE", suffix: "IE" },
};

export const SUPPORTED_CURRENCIES = Object.keys(currencyCountryMap);

// Helper Functions
export const getProxyAgent = () => {
  const proxy = process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? new HttpsProxyAgent(proxy) : null;
};

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

export const generateProductUrl = (slug, suffix) => {
  return `${TPT_BASE_URL}/product/${slug}${suffix ? `-${suffix}` : ''}`;
};

export const generateInstagramPostUrl = (shortcode) => {
  return `${INSTAGRAM_BASE_URL}/p/${shortcode}/`;
};

export const convertCurrency = (amount, fromCurrency, toCurrency, rates) => {
  if (fromCurrency === toCurrency) return amount;
  const inUSD = amount / rates[fromCurrency];
  return (inUSD * rates[toCurrency]).toFixed(2);
};

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