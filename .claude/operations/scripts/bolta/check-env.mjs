import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

dotenv.config();

const { BOLTA_API_KEY, BOLTA_CUSTOMER_KEY } = process.env;
const hasPlaintextEnv = existsSync(resolve(".env"));

const problems = [];
const warnings = [];
const ok = [];

if (!BOLTA_API_KEY || BOLTA_API_KEY.includes("replace_me")) {
  problems.push("BOLTA_API_KEY missing or still set to placeholder");
} else if (!BOLTA_API_KEY.startsWith("test_") && !BOLTA_API_KEY.startsWith("live_")) {
  problems.push(`BOLTA_API_KEY has unexpected prefix: ${BOLTA_API_KEY.slice(0, 10)}...`);
} else {
  ok.push(`BOLTA_API_KEY present — mode: ${BOLTA_API_KEY.startsWith("live_") ? "LIVE ⚠️" : "TEST"}`);
}

if (!BOLTA_CUSTOMER_KEY || BOLTA_CUSTOMER_KEY.includes("replace_me")) {
  problems.push("BOLTA_CUSTOMER_KEY missing or still set to placeholder");
} else if (!BOLTA_CUSTOMER_KEY.startsWith("CustomerKey_")) {
  problems.push(`BOLTA_CUSTOMER_KEY has unexpected prefix: ${BOLTA_CUSTOMER_KEY.slice(0, 15)}...`);
} else {
  ok.push("BOLTA_CUSTOMER_KEY present");
}

if (hasPlaintextEnv) {
  warnings.push("Plaintext .env file detected. 1Password is now the source of truth — delete .env with `rm .env` to avoid stale/leaked credentials.");
}

console.log("\nBolta env check\n");
for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of warnings) console.log(`  ⚠ ${line}`);
for (const line of problems) console.log(`  ✗ ${line}`);

if (problems.length) {
  console.log("\nSee README.md → Team Onboarding for how to obtain credentials.\n");
  process.exit(1);
}

console.log("\nReady. Next: npm run issue -- fixtures/ktalk-test.json --dry-run\n");
