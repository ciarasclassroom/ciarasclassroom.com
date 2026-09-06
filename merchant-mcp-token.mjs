/**
 * Mints a Google access token for the Merchant API MCP server.
 *
 * The MCP server takes a static `Authorization: Bearer …` header, but Google access
 * tokens expire after an hour, so this is re-run to refresh rather than being something
 * you configure once.
 *
 *   node merchant-mcp-token.mjs             # print a token
 *   node merchant-mcp-token.mjs --register  # print the `claude mcp add` command to re-register
 *
 * The service account key is read from MERCHANT_SA_PATH (default
 * ~/.config/ciarasclassroom/merchant-sa.json) — deliberately outside the repo so it
 * cannot be committed.
 */
import { readFile } from "fs/promises";
import path from "path";
import os from "os";
import { JWT } from "google-auth-library";

const KEY_PATH =
  process.env.MERCHANT_SA_PATH || path.join(os.homedir(), ".config", "ciarasclassroom", "merchant-sa.json");
const MCP_URL = "https://merchantapi.googleapis.com/mcp";

let key;
try {
  key = JSON.parse(await readFile(KEY_PATH, "utf-8"));
} catch (error) {
  console.error(`Could not read the service account key at ${KEY_PATH}: ${error.message}`);
  console.error("Create it (chmod 600) or point MERCHANT_SA_PATH at it.");
  process.exit(1);
}

// Defaults to the Merchant scope. `--scopes a,b` mints for other Google APIs off the
// same key — e.g. `--scopes https://www.googleapis.com/auth/webmasters.readonly` for
// Search Console, which needs the service account added as a user in that property.
const scopesArg = process.argv.find((a) => a.startsWith("--scopes="));
const scopes = scopesArg
  ? scopesArg.slice("--scopes=".length).split(",")
  : ["https://www.googleapis.com/auth/content"];

const client = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes,
});

const { access_token: accessToken } = await client.authorize();

if (!process.argv.includes("--register")) {
  console.log(accessToken);
  process.exit(0);
}

// Deliberately no `X-Goog-User-Project` header. That header bills quota to the named
// project, which requires the caller to hold roles/serviceusage.serviceUsageConsumer on
// it — the service account does not, so every call fails with "Caller does not have
// required permission to use project ciaras-classroom". Omitting it lets Google attribute
// quota to the service account's own project, which works as-is.
console.log(
  [
    "claude mcp remove merchant-api --scope user 2>/dev/null;",
    `claude mcp add --transport http merchant-api ${MCP_URL} --scope user \\`,
    `  --header "Authorization: Bearer ${accessToken}"`,
  ].join("\n"),
);
