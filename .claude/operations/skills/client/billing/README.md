# Billing Skills

Client-facing billing documents — Korean 견적서 and 거래명세서.

## Skills

| Skill | Command | Output |
|-------|---------|--------|
| [invoice/](invoice/) | `/generate-invoice` | `[Invoice] {ClientName}.{html,pdf}` (Korean 견적서) |
| [transaction-statement/](transaction-statement/) | `/generate-statement` | `[Statement] {ClientName}.{html,pdf}` (Korean 거래명세서) |
| [tax-invoice/](tax-invoice/) | `/tax-invoice` | Issues Korean electronic tax invoices (세금계산서) via Bolta API — forward, reverse, and amendment issuance |

## Naming Convention

- **Operations repo**: `skills/client/billing/{name}/`
- **Global skills** (`~/.claude/skills/`): `{name}/` (e.g., `invoice/`, `transaction-statement/`, `tax-invoice/`)
- **Slash commands**: `/generate-invoice`, `/generate-statement`, `/tax-invoice`
