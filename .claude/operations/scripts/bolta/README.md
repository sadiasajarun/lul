# Bolta Tax Invoice Scripts

Node scripts to issue and amend Korean electronic tax invoices (세금계산서) via the [Bolta API](https://docs.bolta.io). Companion to the [`tax-invoice`](../../skills/client/billing/tax-invoice/SKILL.md) skill.

**Credentials live in 1Password — no secrets ever touch disk.**

---

## Team Onboarding — first time

### Prerequisites

- Access to the **Potential 1Password team** (account: `team-potentialai.1password.com`). Ask an admin if you're not added.
- Node.js 18+ (`node --version`)
- Homebrew (macOS) or equivalent

### 1. Install dependencies

```bash
# 1Password CLI (once per machine)
brew install 1password-cli

# Project deps
cd .claude/operation/scripts/bolta
npm install
```

### 2. Enable 1Password CLI integration

Open **1Password desktop app** → Settings (`⌘,`):

- **Security** tab → enable **Touch ID** (or system auth)
- **Developer** tab → check ✅ **Integrate with 1Password CLI**

Then sign in via CLI:

```bash
op signin
op whoami   # should print dev@potentialai.com / team-potentialai.1password.com
```

### 3. Verify access to the Bolta vault item

```bash
npm run check
```

Expected:
```
✓ Credential source: 1Password (op run)
✓ BOLTA_API_KEY present — mode: TEST
✓ BOLTA_CUSTOMER_KEY present
```

If you see `account is not signed in` or `permission denied reading op://Shared/Bolta API/...`, ask an admin to grant your 1Password account access to the **Shared** vault.

### 4. First dry run

```bash
npm run issue -- fixtures/ktalk-test.json --dry-run
```

Prints the request body without sending. If the body looks right, run without `--dry-run`.

---

## 1Password item reference

| | |
|---|---|
| Account | `team-potentialai.1password.com` |
| Vault | `Shared` |
| Item | `Bolta API` |
| Fields | `test_api_key`, `test_customer_key`, `live_api_key`, `live_customer_key`, `certificate_expires`, notes |

Env-file mappings: [.env.1password.test](.env.1password.test) and [.env.1password.live](.env.1password.live) — these are **committed** (they contain only `op://` references, never real values).

---

## npm scripts

| Command | What it does |
|---------|-------------|
| `npm run check` | Validate test credentials are accessible |
| `npm run check:live` | Validate live credentials are accessible |
| `npm run issue -- <fixture>` | Issue an invoice in **test** mode |
| `npm run issue:live -- <fixture>` | Issue an invoice in **LIVE** mode (prompts to confirm) |
| `npm run wait -- <issuanceKey>` | Poll test issuance until 발행완료 |
| `npm run wait:live -- <issuanceKey>` | Poll live issuance until 발행완료 |
| `npm run amend -- <issuanceKey>` | Cancel (계약의 해제) a test issuance |
| `npm run amend:live -- <issuanceKey>` | Cancel a live issuance (prompts) |

Pass script flags after `--`:
```bash
npm run issue -- fixtures/ktalk-test.json --dry-run
npm run issue:live -- fixtures/ktalk-test.json --yes
```

---

## Usage patterns

### Issue + cancel (smoke test)

```bash
npm run issue -- fixtures/ktalk-test.json           # capture issuanceKey from output
npm run wait -- <issuanceKey>                        # wait for 발행완료 (30-120s)
npm run amend -- <issuanceKey> --yes                 # cancel
```

### Live run

```bash
npm run check:live                                   # verify live access
npm run issue:live -- fixtures/ktalk-test.json       # type "ISSUE" when prompted
```

---

## Fixtures

Each fixture is a partial request body. `supplier` is auto-filled from [`supplier.mjs`](supplier.mjs) (주식회사 포텐셜 defaults). Drop new JSON files into [`fixtures/`](fixtures/) for different invoices.

Minimum fixture:

```json
{
  "purpose": "CLAIM",
  "supplied": {
    "identificationNumber": "9876543210",
    "organizationName": "상호명",
    "representativeName": "대표자",
    "managers": [{ "email": "contact@example.com" }]
  },
  "items": [
    { "name": "품목명", "supplyCost": 10000, "tax": 1000 }
  ]
}
```

---

## Fallback — plain `.env` file (not recommended)

If you can't use 1Password CLI, copy `.env.example` to `.env` and paste values manually. Get values from the Bolta API item in 1Password → reveal each field.

```bash
cp .env.example .env
# fill in, then run scripts directly without op:
node issue-tax-invoice.mjs fixtures/ktalk-test.json --dry-run
```

`.env` is gitignored but **never commit** it and **never paste live creds into Slack/chat**.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `[ERROR] account is not signed in` | Run `op signin` in your terminal |
| `permission denied reading op://Shared/Bolta API/...` | Ask an admin to grant your account access to the Shared vault |
| `HTTP 401` | `Authorization` header malformed — base64 of `API_KEY:` must include the trailing colon |
| `HTTP 400 invalid_customer_key` | `BOLTA_CUSTOMER_KEY` doesn't match the API key's environment (test vs live) — check you picked the right env-file |
| `HTTP 400 certificate_not_registered` | Register 공동인증서 in Bolta dashboard (Settings → 인증서 관리) |
| `HTTP 400 ISSUANCE_MUST_BE_SUCCESS` when amending | Original is still pending 국세청 confirmation — run `npm run wait -- <key>` first |
| `HTTP 400 insufficient_points` | Live mode only — top up points in Bolta dashboard |

---

## Security

- `.env.1password.*` files contain **only references**, never real secrets. Safe to commit.
- `.env` (plaintext) is gitignored. If you've been using it during setup, delete it once 1Password is working.
- Live mode scripts prompt for typed confirmation unless `--yes` is passed.
- Rotate Bolta API keys immediately if they appear in chat, commits, or logs.
- For CI: use 1Password service accounts with `OP_SERVICE_ACCOUNT_TOKEN`, not desktop app integration.

---

## Related

- Skill docs: [`tax-invoice` SKILL.md](../../skills/client/billing/tax-invoice/SKILL.md)
- Full API field spec: [api-spec.md](../../skills/client/billing/tax-invoice/references/api-spec.md)
- Bolta API reference: https://docs.bolta.io
- 1Password CLI docs: https://developer.1password.com/docs/cli/
