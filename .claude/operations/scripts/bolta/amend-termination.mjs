import axios from "axios";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

dotenv.config();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string" },
    yes: { type: "boolean", short: "y", default: false },
  },
});

const issuanceKey = positionals[0];
if (!issuanceKey) {
  console.error("Usage: node amend-termination.mjs <issuanceKey> [--date YYYY-MM-DD] [--yes]");
  process.exit(1);
}

const { BOLTA_API_KEY, BOLTA_CUSTOMER_KEY } = process.env;
if (!BOLTA_API_KEY || !BOLTA_CUSTOMER_KEY) {
  console.error("Missing BOLTA_API_KEY or BOLTA_CUSTOMER_KEY");
  process.exit(1);
}

const mode = BOLTA_API_KEY.startsWith("live_") ? "LIVE" : "TEST";
const date = values.date ?? new Date().toISOString().slice(0, 10);

console.log(`\n[${mode}] Amending (계약의 해제) — issuanceKey: ${issuanceKey}`);
console.log(`  termination date: ${date}`);

if (mode === "LIVE" && !values.yes) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`\n⚠️  LIVE amendment on 국세청 record. Type "AMEND" to proceed: `);
  rl.close();
  if (answer.trim() !== "AMEND") {
    console.log("Aborted.");
    process.exit(0);
  }
}

const referenceId = randomUUID();
const authorization = "Basic " + Buffer.from(`${BOLTA_API_KEY}:`).toString("base64");

console.log(`  Reference-Id: ${referenceId}`);

try {
  const { data } = await axios.post(
    `https://xapi.bolta.io/v1/taxInvoices/${issuanceKey}/amend/termination`,
    { date },
    {
      headers: {
        Authorization: authorization,
        "Customer-Key": BOLTA_CUSTOMER_KEY,
        "Bolta-Client-Reference-Id": referenceId,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    },
  );

  console.log("\n✓ Amendment issued");
  console.log("  new issuanceKey:", data.issuanceKey);
  console.log("  original invoice is now offset (상계처리)\n");
} catch (err) {
  if (err.response) {
    console.error(`\n✗ HTTP ${err.response.status}`);
    console.error("  body:", JSON.stringify(err.response.data, null, 2));
  } else {
    console.error("\n✗ Network error:", err.message);
  }
  process.exit(1);
}
