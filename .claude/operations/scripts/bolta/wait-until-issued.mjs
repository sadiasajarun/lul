import axios from "axios";
import dotenv from "dotenv";
import { setTimeout as sleep } from "node:timers/promises";

dotenv.config();

const issuanceKey = process.argv[2];
const maxAttempts = Number(process.argv[3] ?? 20);
const intervalMs = Number(process.argv[4] ?? 5000);

if (!issuanceKey) {
  console.error("Usage: node wait-until-issued.mjs <issuanceKey> [maxAttempts=20] [intervalMs=5000]");
  process.exit(1);
}

const { BOLTA_API_KEY, BOLTA_CUSTOMER_KEY } = process.env;
const authorization = "Basic " + Buffer.from(`${BOLTA_API_KEY}:`).toString("base64");

console.log(`Polling ${issuanceKey} (every ${intervalMs / 1000}s, max ${maxAttempts} attempts)`);

for (let i = 1; i <= maxAttempts; i++) {
  try {
    const { data } = await axios.get(`https://xapi.bolta.io/v1/taxInvoices/${issuanceKey}`, {
      headers: {
        Authorization: authorization,
        "Customer-Key": BOLTA_CUSTOMER_KEY,
      },
      timeout: 10000,
    });
    console.log(`✓ attempt ${i}: 발행완료`);
    console.log(`  ntsTransactionId: ${data.ntsTransactionId ?? "(none)"}`);
    console.log(`  issuedAt: ${data.issuedAt ?? "(none)"}`);
    process.exit(0);
  } catch (err) {
    const status = err.response?.status ?? "ERR";
    const code = err.response?.data?.code ?? err.message;
    console.log(`  attempt ${i}: HTTP ${status} — ${code}`);
    if (i < maxAttempts) await sleep(intervalMs);
  }
}

console.error("✗ Timed out waiting for issuance completion");
process.exit(1);
