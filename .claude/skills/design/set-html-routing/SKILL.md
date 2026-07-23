---
name: set-html-routing
description: Set up navigation routing between static HTML files with live testing via Playwright MCP
---

# Set HTML Routing

Connect links in generated static HTML files to actual file paths, **test on live site via Playwright MCP**, then push fixes.
**Assumes HTML files are already deployed to GitHub Pages via `/git-create`.**

---

## Prerequisites

1. **Playwright MCP Configuration** (`.mcp.json`)
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

2. **GitHub Pages Deployed** - Run `/git-create` first
3. **Live URL** - `https://{org}.github.io/{project}/`

---

## Usage

```bash
/set-html-routing <html-dir> --live-url <url>
/set-html-routing ./.claude-project/generated-screens/crowd-building --live-url https://potentialinc.github.io/crowd-building/
/set-html-routing ./.claude-project/generated-screens/my-project --live-url https://potentialinc.github.io/my-project/ --push
```

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `<html-dir>` | Local HTML files directory | (required) |
| `--live-url` | GitHub Pages URL for testing | (required) |
| `--push` | Auto-push fixes after testing | false |
| `--demo-account` | Login demo account | `demo@demo.com:1234` |
| `--backup` | Backup original files (.bak) | false |

---

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Live Test via Playwright MCP                       │
│  - Navigate to live URL                                      │
│  - Click each navigation link                                │
│  - Test login form with demo account                         │
│  - Record broken links and issues                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Analyze Issues                                     │
│  - Categorize: broken links, wrong targets, missing hrefs    │
│  - Build fix plan                                            │
│  - Report findings to user                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Fix Local Files                                    │
│  - Update href="#" to actual paths                           │
│  - Fix incorrect navigation links                            │
│  - Add/fix form handlers                                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: Report Changes                                     │
│  - Show diff summary to user                                 │
│  - List all modified files                                   │
│  - Get confirmation for push                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 5: Push to GitHub                                     │
│  - Copy modified files to temp deploy directory              │
│  - git add, commit, push                                     │
│  - Wait for Pages rebuild (~30s)                             │
│  - Verify fixes on live site                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Execution Steps

### Step 1: Parse Arguments

```
1. Read $ARGUMENTS:
   - html-dir (required) - local path to HTML files
   - --live-url (required) - GitHub Pages URL
   - --push (optional) - auto-push after fixes
   - --demo-account (default: demo@demo.com:1234)

2. Validate:
   - html-dir exists and contains *.html files
   - live-url is accessible
```

### Step 2: Live Navigation Test (Playwright MCP)

```
1. mcp__playwright__browser_navigate → {live-url}
2. mcp__playwright__browser_snapshot → Capture initial state
3. For each navigation link visible in sidebar:
   - mcp__playwright__browser_click → Click link
   - mcp__playwright__browser_snapshot → Check result
   - Record: link text, expected target, actual target, status
4. Test login:
   - Navigate to login page
   - Fill demo@demo.com/1234 credentials
   - Submit form
   - Verify redirect to dashboard
```

### Step 3: Build Issue Report

```
Categorize findings:

| Issue Type | Example | Fix |
|------------|---------|-----|
| Broken link | href="#" stays on same page | Update to correct path |
| Wrong target | "My Ideas" → dashboard.html | Fix to my-ideas.html |
| Missing handler | Login form does nothing | Add form submit handler |
| 404 error | Link to non-existent file | Create file or remove link |

Output format:
{
  "broken_links": [
    { "page": "04-dashboard.html", "link_text": "Settings", "current": "#", "fix": null }
  ],
  "wrong_targets": [
    { "page": "05-idea-feed.html", "link_text": "Dashboard", "current": "08-my-ideas.html", "fix": "04-dashboard.html" }
  ],
  "form_issues": [
    { "page": "02-login.html", "issue": "no submit handler", "fix": "add demo login script" }
  ]
}
```

### Step 4: Fix Local HTML Files

For each issue found:

#### 4.1 Fix Navigation Links

```html
<!-- Find incorrect link -->
<a href="./08-my-ideas.html">Dashboard</a>

<!-- Replace with correct target -->
<a href="./04-dashboard.html">Dashboard</a>
```

#### 4.2 Fix href="#" Links

```html
<!-- Find -->
<a href="#">My Contracts</a>

<!-- Replace with -->
<a href="./09-my-contracts.html">My Contracts</a>
```

#### 4.3 Add Login Form Handler (if missing)

```html
<script>
(function() {
  const form = document.querySelector('form');
  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.querySelector('input[type="email"], input[id*="email"]');
    const password = document.querySelector('input[type="password"]');

    if (email && password) {
      if (email.value === 'demo@demo.com' && password.value === '1234') {
        location.href = './04-dashboard.html';
      } else {
        alert('Demo account: demo@demo.com / 1234');
      }
    }
  });
})();
</script>
```

### Step 5: Report Changes to User

```
Routing Fixes Applied:

Files Modified: 6

05-idea-feed.html:
  - Dashboard: ./08-my-ideas.html → ./04-dashboard.html
  - My Ideas: ./09-my-contracts.html → ./08-my-ideas.html
  - My Contracts: ./11-profile.html → ./09-my-contracts.html
  - Profile: # → ./11-profile.html

06-idea-detail.html:
  - Explore Ideas: ./09-my-contracts.html → ./05-idea-feed.html
  - My Contracts: ./04-dashboard.html → ./09-my-contracts.html
  - Profile: ./04-dashboard.html → ./11-profile.html

... (more files)

Ready to push? (--push flag or confirm)
```

### Step 6: Push to GitHub

```bash
# Navigate to temp deploy directory (created by /git-create)
TEMP_DIR="/tmp/{project-name}-deploy"

# Copy updated files
cp {html-dir}/*.html $TEMP_DIR/

# Commit and push
cd $TEMP_DIR
git add .
git commit -m "fix: Update navigation routing

- Fixed sidebar navigation links
- Corrected href targets
- Added/fixed form handlers"
git push

# Wait for Pages rebuild
sleep 30
```

### Step 7: Verify Fixes on Live Site

```
1. mcp__playwright__browser_navigate → {live-url}
2. Re-run navigation tests from Step 2
3. Verify all previously broken links now work
4. Report final status:

Verification Complete!

Live URL: https://potentialinc.github.io/crowd-building/

Navigation Tests:
├── Landing → Dashboard ✅
├── Dashboard → My Ideas ✅
├── Dashboard → My Contracts ✅
├── Dashboard → Profile ✅
├── Login (demo@demo.com/1234) → Dashboard ✅
└── Signup → Dashboard ✅

All 47 navigation paths verified!
```

---

## Playwright MCP Test Patterns

### Navigation Test Sequence

```
For each page with sidebar navigation:

1. Navigate to page
   mcp__playwright__browser_navigate → {live-url}/{page}.html

2. Capture snapshot
   mcp__playwright__browser_snapshot

3. Find navigation links
   Look for: <a> elements in sidebar/nav with text like:
   - Dashboard, My Ideas, My Contracts, Profile, Settings, Log Out

4. Click each link
   mcp__playwright__browser_click → element: "Dashboard link", ref: "[ref]"

5. Verify destination
   mcp__playwright__browser_snapshot
   Check: URL changed to expected target? Page content matches?

6. Navigate back and test next link
   mcp__playwright__browser_navigate_back
```

### Login Form Test

```
1. Navigate to login page
   mcp__playwright__browser_navigate → {live-url}/02-login-page.html

2. Fill form
   mcp__playwright__browser_type → element: "email input", text: "demo"
   mcp__playwright__browser_type → element: "password input", text: "1234"

3. Submit
   mcp__playwright__browser_click → element: "Sign In button"

4. Verify redirect
   mcp__playwright__browser_snapshot
   Check: URL is now dashboard? Welcome message visible?
```

---

## Auto-Mapping Rules

```yaml
# Link text → Target file pattern
navigation:
  "Dashboard": "*dashboard*"
  "Home": "*landing*"
  "My Ideas": "*my-ideas*"
  "Explore Ideas": "*idea-feed*"
  "My Contracts": "*my-contracts*"
  "Profile": "*profile*"
  "Settings": "*settings*"
  "Log Out": "*landing*"

# Auth pages
auth:
  "Sign In": "*login*"
  "Login": "*login*"
  "Sign Up": "*signup*"
  "Register": "*signup*"

# CTA buttons
cta:
  "Get Started": "*login*"
  "Start Free": "*signup*"

# Logo → Landing
logo:
  "CROWD.": "*landing*"
  "[Any Logo]": "*landing*"
```

---

## Error Handling

### Live Site Not Accessible

```
ERROR: Cannot reach https://potentialinc.github.io/crowd-building/

Possible causes:
1. GitHub Pages not yet deployed (wait 1-2 minutes after /git-create)
2. Repository is private (Pages requires public repo or Pro account)
3. Pages not enabled in repository settings

Check: gh api repos/{org}/{project}/pages
```

### Playwright MCP Not Available

```
ERROR: Playwright MCP not configured

Add to .mcp.json:
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

### Push Failed

```
ERROR: Failed to push changes

Possible causes:
1. No write access to repository
2. Temp directory doesn't exist (run /git-create first)
3. Merge conflict

Manual fix:
cd /tmp/{project}-deploy
git status
git pull --rebase
git push
```

---

## Example Session

```
User: /set-html-routing ./.claude-project/generated-screens/crowd-building --live-url https://potentialinc.github.io/crowd-building/

Claude:
1. Testing live site via Playwright...
   ✅ Site accessible at https://potentialinc.github.io/crowd-building/

2. Running navigation tests...
   Testing 01-landing-page.html...
   - Get Started button → 02-login ✅
   - Explore Ideas button → 05-idea-feed ✅

   Testing 04-dashboard.html...
   - Dashboard → 04-dashboard ✅
   - My Ideas → 08-my-ideas ✅
   - My Contracts → 09-my-contracts ✅
   - Profile → 11-profile ✅
   - Log Out → 01-landing ✅

   Testing 05-idea-feed.html...
   - Dashboard → 08-my-ideas ❌ (wrong target)
   - Explore Ideas → 09-my-contracts ❌ (wrong target)
   - My Contracts → 11-profile ❌ (wrong target)
   - Profile → # ❌ (broken link)

   ... (testing all pages)

3. Issues found: 12 broken/incorrect links across 6 files

4. Fixing local files...
   ✅ 05-idea-feed.html (4 links fixed)
   ✅ 06-idea-detail.html (4 links fixed)
   ✅ 07-idea-create.html (3 links fixed)
   ✅ 09-my-contracts.html (4 links fixed)
   ✅ 10-contract-detail.html (4 links fixed)
   ✅ 11-profile.html (4 links fixed)

5. Changes summary:
   ┌──────────────────────────────────────────────────┐
   │ File                    │ Fixes                  │
   ├──────────────────────────────────────────────────┤
   │ 05-idea-feed.html       │ Dashboard, My Ideas,   │
   │                         │ My Contracts, Profile  │
   │ 06-idea-detail.html     │ Explore Ideas, Contracts│
   │                         │ Profile, Settings      │
   │ ...                     │ ...                    │
   └──────────────────────────────────────────────────┘

   Push these changes? [Y/n]

User: Y

6. Pushing to GitHub...
   ✅ Changes committed: "fix: Update navigation routing"
   ✅ Pushed to origin/main
   ⏳ Waiting for Pages rebuild (30s)...

7. Verifying fixes on live site...
   ✅ All 47 navigation paths now working!

Done!
Live URL: https://potentialinc.github.io/crowd-building/
Demo login: demo@demo.com / 1234
```

---

## Related Commands

- `/prompts-to-html` - Generate HTML pages with AI (Step 1)
- `/html-to-git` - Create GitHub repo and deploy to Pages (Step 2)
- This command - Set up routing and verify (Step 3)

---

## Pipeline Flow

```
/prompts-to-html              /html-to-git                   /set-html-routing
     │                             │                              │
     ▼                             ▼                              ▼
Design Prompts ──► HTML Files ──► GitHub Pages ──► Live Test ──► Fix ──► Push
                                      │                                    │
                                      └────────────────────────────────────┘
                                                  Verify
```

---

## Tips

1. **Always run after /git-create** - Needs live URL for testing
2. **Use --push flag** - Auto-push for faster iteration
3. **Check Playwright output** - Detailed click-by-click results
4. **Demo account** - Always test login with demo@demo.com/1234
5. **Multiple iterations** - Run again after push to verify all fixes
