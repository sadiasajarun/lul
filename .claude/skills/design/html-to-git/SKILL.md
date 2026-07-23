---
name: html-to-git
description: Deploy generated HTML files to GitHub Pages for live prototype hosting
---

# HTML to Git

Create a new GitHub repository, push HTML files, and enable GitHub Pages for instant live preview.
**Never modifies existing repositories** - only creates new repos.

---

## Prerequisites

1. **GitHub CLI (gh)** - `brew install gh`
2. **GitHub Authentication** - `gh auth login`
3. **Organization Access** - potentialInc (or specified org)
4. **HTML Files** - Directory to specify with `--html-dir`

---

## Usage

```bash
/html-to-git <project-name> --html-dir <path>
/html-to-git crowd-building --html-dir ./.claude-project/generated-screens/crowd-building
/html-to-git my-app --html-dir ./screens --org potentialInc
/html-to-git my-app --html-dir ./screens --private
```

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `<project-name>` | GitHub repository name (created as `HTML-{project-name}`) | (required) |
| `--html-dir` | HTML files directory | (required) |
| `--org` | GitHub organization name | `potentialInc` |
| `--private` | Create private repository | false (public) |
| `--no-pages` | Disable GitHub Pages | false |
| `--description` | Repository description | `HTML-{project-name} - Generated prototype` |

---

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Prerequisites Check                                │
│  - Verify gh CLI installed & authenticated                   │
│  - Verify html-dir exists and has HTML files                 │
│  - Check org access                                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Create Repository                                  │
│  - gh repo create {org}/HTML-{project-name}                  │
│  - Set public/private                                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Prepare & Push HTML Files                          │
│  - Create temp directory (protect current project)          │
│  - Copy HTML files + create index.html                       │
│  - git init, add, commit, push                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: Enable GitHub Pages                                │
│  - gh api repos/{org}/HTML-{project-name}/pages              │
│  - source: branch=main, path=/                               │
│  - build_type: legacy (no workflow needed)                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 5: Verify & Report                                    │
│  - Wait for Pages build (~30s)                               │
│  - Check live URL                                            │
│  - Report results                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Execution Steps

### Step 1: Parse Arguments & Prerequisites

```
1. Read $ARGUMENTS:
   - project-name (required)
   - --html-dir (required)
   - --org (default: potentialInc)
   - --private, --no-pages, --description

2. Verify prerequisites:
   - gh CLI installed: which gh
   - gh auth status (check login)
   - html-dir exists and contains *.html files
   - org access (if using org)
```

### Step 2: Create Repository

```bash
# Create new repository
# IMPORTANT: Never push/clone/modify existing repos

gh repo create {org}/HTML-{project-name} \
  --public \  # Use --private if flag is set
  --description "HTML-{project-name} - Generated prototype"

# Result: https://github.com/{org}/HTML-{project-name}
```

### Step 3: Prepare & Push HTML Files

```bash
# Work in temp directory (protect current project)
TEMP_DIR="/tmp/HTML-{project-name}-deploy"
rm -rf $TEMP_DIR && mkdir -p $TEMP_DIR

# Copy HTML files
cp {html-dir}/*.html $TEMP_DIR/

# Create index.html (copy landing page)
cp $TEMP_DIR/*landing*.html $TEMP_DIR/index.html 2>/dev/null || \
cp $(ls $TEMP_DIR/*.html | head -1) $TEMP_DIR/index.html

# Initialize git and push
cd $TEMP_DIR
git init
git remote add origin https://github.com/{org}/HTML-{project-name}.git
git add .
git commit -m "Initial commit: HTML-{project-name} prototype"
git branch -M main
git push -u origin main
```

### Step 4: Enable GitHub Pages (if not --no-pages)

```bash
# Enable GitHub Pages (branch mode, no workflow needed)
gh api repos/{org}/HTML-{project-name}/pages \
  -X POST \
  --input - <<EOF
{
  "source": {
    "branch": "main",
    "path": "/"
  }
}
EOF

# Verify build_type in response
# build_type: "legacy" → OK (branch mode)
```

### Step 5: Verify & Report

```bash
# Wait for Pages build (~30 seconds)
sleep 30

# Check live site
curl -s -o /dev/null -w "%{http_code}" https://{org}.github.io/HTML-{project-name}/
```

**Output:**
```
✅ Repository Created & Deployed!

Repository: https://github.com/{org}/HTML-{project-name}
Live URL:   https://{org}.github.io/HTML-{project-name}/

Files pushed: 12 HTML files
- index.html (landing page)
- 01-landing-page.html
- 02-login-page.html
- ...

Next step: /set-html-routing ./.claude-project/generated-screens/{project-name} --live-url https://{org}.github.io/HTML-{project-name}/
```

---

## Error Handling

### gh CLI Not Installed

```
ERROR: GitHub CLI (gh) not installed.

Install with:
  brew install gh

Then authenticate:
  gh auth login --web
```

### Not Authenticated

```
ERROR: Not logged into GitHub.

Run:
  gh auth login --web

Follow the browser prompts to authenticate.
```

### html-dir Not Found

```
ERROR: Directory not found: {html-dir}

Please check the path and try again.
```

### No HTML Files

```
ERROR: No *.html files found in {html-dir}

Make sure the directory contains HTML files.
```

### Repository Already Exists

```
ERROR: Repository {org}/HTML-{project-name} already exists.

Options:
1. Use a different project name
2. Delete the existing repository first:
   gh repo delete {org}/HTML-{project-name} --yes
```

### No Org Access

```
ERROR: No access to organization '{org}'.

Options:
1. Check your GitHub permissions for the organization
2. Use --org flag to specify a different organization:
   /html-to-git {project-name} --html-dir {path} --org your-username
```

### GitHub Pages Activation Failed

```
WARNING: Could not enable GitHub Pages.

The repository was created and files pushed, but Pages activation failed.
You can manually enable Pages in repository settings:
  https://github.com/{org}/HTML-{project-name}/settings/pages
```

---

## Example Session

```
User: /html-to-git crowd-building --html-dir ./.claude-project/generated-screens/crowd-building

Claude:
1. Checking prerequisites...
   ✅ gh CLI installed
   ✅ Authenticated as PotentialJayden
   ✅ HTML directory found: 11 files
   ✅ Access to potentialInc organization

2. Creating repository...
   gh repo create potentialInc/HTML-crowd-building --public
   ✅ Repository created: https://github.com/potentialInc/HTML-crowd-building

3. Pushing HTML files...
   ✅ 12 files pushed (including index.html)

4. Enabling GitHub Pages...
   ✅ Pages enabled (branch: main, path: /)
   ✅ Build type: legacy (no workflow needed)

5. Waiting for deployment...
   ✅ Site is live!

✅ Done!

Repository: https://github.com/potentialInc/HTML-crowd-building
Live URL:   https://potentialinc.github.io/HTML-crowd-building/

Files pushed:
- index.html
- 01-landing-page.html
- 02-login-page.html
- 03-signup-page.html
- 04-dashboard.html
- ... (12 files total)

Next step:
/set-html-routing ./.claude-project/generated-screens/crowd-building --live-url https://potentialinc.github.io/HTML-crowd-building/
```

---

## Important Safety Rules

1. **NEVER modify existing repositories** - This command only creates NEW repos
2. **NEVER push to existing repos** - Always creates fresh repo
3. **NEVER clone into current project** - Uses temp directory only
4. **NEVER delete repos without explicit user confirmation**
5. **ALWAYS work in /tmp directory** - Protect user's project

---

## Related Commands

- `/prompts-to-html` - Generate HTML from design prompts (Step 1)
- `/set-html-routing` - Set up navigation routing in HTML files (Step 3)

---

## Pipeline Flow

```
/prompts-to-html              /html-to-git                    /set-html-routing
     │                             │                              │
     ▼                             ▼                              ▼
PRD prompts.md ──────► ./.claude-project/generated-screens/{project}/ ──────► Live URL
                              │                              │
                              └──────────────────────────────┘
                                    Push to GitHub Pages
```

---

## Tips

1. **Project naming** - Use lowercase, hyphen-separated (e.g., `crowd-building`)
2. **Public vs Private** - Prototypes are usually public (free GitHub Pages)
3. **Pages URL format** - `https://{org}.github.io/HTML-{project-name}/`
4. **Build time** - First deployment takes 30 seconds to 1 minute after Pages activation
5. **index.html** - Landing page is automatically copied as index.html
