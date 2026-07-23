---
name: playwright-cli
description: Token-efficient browser automation via @playwright/cli. Uses stateless bash commands with named sessions for parallel isolation. 4x cheaper than Playwright MCP (~27k vs ~114k tokens/task).
---

# Playwright CLI Skill

Token-efficient browser automation for AI coding agents via `@playwright/cli`.

**When to use this vs Playwright MCP:**
- Use **playwright-cli** (this skill) for: automated QA runs, parallel testing, scripted workflows
- Use **Playwright MCP** for: interactive exploration, debugging, one-off inspection

---

## Installation

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

Verify: `playwright-cli --help`

---

## Core Concepts

### Named Sessions (`-s=<name>`)

Every command uses `-s=<name>` for browser isolation. Each session has its own cookies, storage, and browser process.

```bash
playwright-cli -s=login-test-a1b2 open https://example.com --persistent
```

**Naming convention:** `<story-kebab>-<4char-uuid>` (e.g., `user-login-f3a1`)

### Element References

After `snapshot`, the CLI returns a YAML-like accessibility tree with element references (e.g., `e15`, `e21`). Use these refs for `click`, `fill`, etc.

```
- button "Sign In" [e15]
- textbox "Email" [e21]
- textbox "Password" [e22]
```

---

## Command Reference

### Session Lifecycle

```bash
# Open browser with persistent session
playwright-cli -s=<name> open <url> --persistent

# Close specific session
playwright-cli -s=<name> close

# List all active sessions
playwright-cli list

# Close all sessions
playwright-cli close-all

# Delete session data (cookies, storage)
playwright-cli -s=<name> delete-data
```

### Navigation

```bash
playwright-cli -s=<name> goto <url>
playwright-cli -s=<name> goback
playwright-cli -s=<name> goforward
```

### Page Inspection

```bash
# Accessibility tree snapshot (returns element refs)
playwright-cli -s=<name> snapshot

# Screenshot to file
playwright-cli -s=<name> screenshot

# Screenshot with vision mode (returns image for AI reasoning)
PLAYWRIGHT_MCP_CAPS=vision playwright-cli -s=<name> screenshot
```

### Interaction

```bash
playwright-cli -s=<name> click <ref>
playwright-cli -s=<name> fill <ref> "<text>"
playwright-cli -s=<name> selectoption <ref> "<value>"
playwright-cli -s=<name> hover <ref>
playwright-cli -s=<name> press <key>
```

### Waiting

```bash
playwright-cli -s=<name> waitfortext "<text>"
playwright-cli -s=<name> waitfornavigation
```

---

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `PLAYWRIGHT_MCP_VIEWPORT_SIZE` | Browser viewport | `1440x900` |
| `PLAYWRIGHT_MCP_CAPS` | Enable capabilities | `vision` |
| `PLAYWRIGHT_CLI_SESSION` | Default session name | `my-app-test` |

---

## Parallel Execution Pattern

Multiple agents can run isolated browsers simultaneously using different session names:

```bash
# Agent 1
playwright-cli -s=login-test-a1b2 open https://app.com/login --persistent

# Agent 2 (fully isolated, runs simultaneously)
playwright-cli -s=dashboard-test-c3d4 open https://app.com/dashboard --persistent
```

---

## Typical QA Workflow

```bash
# 1. Open
PLAYWRIGHT_MCP_VIEWPORT_SIZE=1440x900 playwright-cli -s=my-test open http://localhost:5173/login --persistent

# 2. Snapshot to get element refs
playwright-cli -s=my-test snapshot

# 3. Interact
playwright-cli -s=my-test fill e21 "user@example.com"
playwright-cli -s=my-test fill e22 "password123"
playwright-cli -s=my-test click e15

# 4. Verify
playwright-cli -s=my-test waitfortext "Welcome"
playwright-cli -s=my-test screenshot

# 5. Cleanup
playwright-cli -s=my-test close
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `Session not found` | Session closed or never opened | Re-open with `open --persistent` |
| `Element not found` | Ref stale after page change | Run `snapshot` again for fresh refs |
| `Navigation timeout` | Page didn't load | Check URL and server status |
| `command not found` | Not installed | `npm install -g @playwright/cli@latest` |

---

## Console Log Capture

When `.playwright/cli.config.json` contains `"console": {"level": "error"}`,
the CLI automatically captures browser console messages to log files.

**Log location**: `.claude-project/.playwright-cli/console-{timestamp}.log`

**Log format**:
```
[{ms}ms] [ERROR] {message} @ {source_url}:{line}
```

Logs are created per session. The smoke-test skill reads them to count
console errors per route. See `.claude/skills/qa/test-smoke/SKILL.md` for the
console error capture protocol.

**Quick infinite loop check**: If a console log file exceeds 1MB, it almost
certainly contains an infinite error loop (e.g., auth refresh cycle producing
3000+ errors in seconds).
