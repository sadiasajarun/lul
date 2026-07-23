import axios from "axios";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { defaultSupplier } from "./supplier.mjs";

dotenv.config();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fixture: { type: "string", short: "f" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", short: "y", default: false },
  },
});

const fixturePath = values.fixture ?? positionals[0];
if (!fixturePath) {
  console.error("Usage: node issue-tax-invoice.mjs <fixture.json> [--dry-run] [--yes]");
  process.exit(1);
}

const { BOLTA_API_KEY, BOLTA_CUSTOMER_KEY } = process.env;
if (!BOLTA_API_KEY || !BOLTA_CUSTOMER_KEY) {
  console.error("Missing BOLTA_API_KEY or BOLTA_CUSTOMER_KEY — fill in .env");
  process.exit(1);
}

const mode = BOLTA_API_KEY.startsWith("live_") ? "LIVE" : "TEST";
const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
const today = new Date().toISOString().slice(0, 10);

const body = {
  date: fixture.date ?? today,
  purpose: fixture.purpose,
  description: fixture.description,
  supplier: fixture.supplier ?? defaultSupplier,
  supplied: fixture.supplied,
  items: fixture.items.map((item) => ({ date: item.date ?? today, ...item })),
};

const supplyCostSum = body.items.reduce((acc, i) => acc + (i.supplyCost ?? 0), 0);
const taxSum = body.items.reduce((acc, i) => acc + (i.tax ?? 0), 0);

console.log(`\n[${mode}] ${values["dry-run"] ? "DRY RUN — " : ""}Issuing tax invoice`);
console.log(`  Fixture: ${fixturePath}`);
console.log(`  공급자: ${body.supplier.organizationName} (${body.supplier.identificationNumber})`);
console.log(`  공급받는자: ${body.supplied.organizationName} (${body.supplied.identificationNumber})`);
console.log(`  공급가액: ₩${supplyCostSum.toLocaleString()} + VAT ₩${taxSum.toLocaleString()} = ₩${(supplyCostSum + taxSum).toLocaleString()}`);
console.log(`  purpose: ${body.purpose}, date: ${body.date}`);

if (values["dry-run"]) {
  console.log("\n--- Request body ---");
  console.log(JSON.stringify(body, null, 2));
  console.log("\n(dry run — no request sent)");
  process.exit(0);
}

if (mode === "LIVE" && !values.yes) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    `\n⚠️  LIVE mode — this submits a REAL invoice to 국세청 and deducts points.\n   Type "ISSUE" to proceed: `,
  );
  rl.close();
  if (answer.trim() !== "ISSUE") {
    console.log("Aborted.");
    process.exit(0);
  }
}

const referenceId = randomUUID();
const authorization = "Basic " + Buffer.from(`${BOLTA_API_KEY}:`).toString("base64");

console.log(`\n  Reference-Id: ${referenceId}`);

try {
  const { data } = await axios.post(
    "https://xapi.bolta.io/v1/taxInvoices/issue",
    body,
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

  console.log("\n✓ Success");
  console.log("  issuanceKey:", data.issuanceKey);
  console.log("  Dashboard: https://bolta.io/invoice/sales/issued\n");
} catch (err) {
  if (err.response) {
    console.error(`\n✗ HTTP ${err.response.status}`);
    console.error("  body:", JSON.stringify(err.response.data, null, 2));
  } else {
    console.error("\n✗ Network error:", err.message);
  }
  process.exit(1);
}
