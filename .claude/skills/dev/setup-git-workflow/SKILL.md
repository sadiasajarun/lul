---
description: Sets up git workflow enforcement for a target GitHub repo — branch name validation (GitHub Action), PR size check (GitHub Action), branch protection rules, auto-delete head branches, and optional local git hooks (Husky). Designed for the one-branch-per-task workflow where ticket IDs in branch names enable automatic PR→ticket linking.
---

# Setup Git Workflow Skill

Sets up the enforcement layer for the one-branch-per-task git workflow. Creates GitHub Actions, configures repo settings, and optionally installs local git hooks.

**Purpose**: Ensure that the branch naming convention (`feature/PHC-042-description`) is enforced so that the existing `PrLinkerService` can reliably auto-link PRs to tickets.

**Prerequisite**: The target repo must be accessible via `gh` CLI (authenticated).

---

## When to Use

- Setting up a new project's GitHub repo for the team workflow
- Onboarding an existing repo to the ticket-linked branch convention
- After creating a project in the dashboard with `ticketPrefix` and `githubRepoUrl` configured

---

## Protocol

### Step 1: Detect Project Context

Gather the required parameters. Ask the user if any are missing.

```bash
# Required inputs
REPO=""          # GitHub repo in owner/repo format (e.g., potentialInc/project-health-check)
TICKET_PREFIX="" # Ticket prefix for this project (e.g., PHC)
PROTECTED_BRANCHES="dev main"  # Branches to protect
```

Verify repo access:
```bash
gh repo view "$REPO" --json name,defaultBranchRef > /dev/null 2>&1 || {
  echo "ERROR: Cannot access repo $REPO. Check gh auth status."
  exit 1
}
```

---

### Step 2: Create GitHub Actions

Create two workflow files in the target repo's `.github/workflows/` directory.

#### A. Branch Name Validation

Create `.github/workflows/branch-name-check.yml`:

```yaml
name: Branch Name Check

on:
  pull_request:
    branches: [dev, main]

jobs:
  validate-branch-name:
    runs-on: ubuntu-latest
    steps:
      - name: Check branch naming convention
        run: |
          BRANCH="${{ github.head_ref }}"

          # Skip for release/dependabot/renovate branches
          if [[ "$BRANCH" =~ ^(release/|dependabot/|renovate/) ]]; then
            echo "✓ Exempt branch pattern: $BRANCH"
            exit 0
          fi

          # Validate convention: type/description (ticket ID recommended but not required)
          PATTERN="^(feature|fix|chore|bugfix|hotfix)/.+"
          if [[ ! "$BRANCH" =~ $PATTERN ]]; then
            echo "::error::Branch '$BRANCH' does not follow naming convention."
            echo ""
            echo "Expected format: feature/<description> or fix/<description>"
            echo "Recommended:     feature/${TICKET_PREFIX}-042-short-description"
            echo ""
            echo "Valid prefixes: feature/, fix/, chore/, bugfix/, hotfix/"
            exit 1
          fi

          echo "✓ Branch name '$BRANCH' follows convention"

          # Warn (not block) if no ticket ID found
          TICKET_PATTERN="${TICKET_PREFIX}-[0-9]+"
          if [[ ! "$BRANCH" =~ $TICKET_PATTERN ]]; then
            echo "::warning::Branch name has no ticket ID (e.g., ${TICKET_PREFIX}-042). Auto-linking to tickets will not work."
          fi
```

Replace `${TICKET_PREFIX}` with the actual project ticket prefix before writing.

#### B. PR Size Check

Create `.github/workflows/pr-size-check.yml`:

```yaml
name: PR Size Check

on:
  pull_request:
    branches: [dev, main]

jobs:
  check-pr-size:
    runs-on: ubuntu-latest
    steps:
      - name: Check PR size
        uses: actions/github-script@v7
        with:
          script: |
            const { additions, deletions, changed_files } = context.payload.pull_request;
            const total = additions + deletions;

            let label = '';
            let message = '';

            if (total <= 200) {
              label = '🟢 size/small';
              message = `PR size: ${total} lines changed (${additions}+ ${deletions}-) across ${changed_files} files — good size.`;
            } else if (total <= 400) {
              label = '🟡 size/medium';
              message = `PR size: ${total} lines changed (${additions}+ ${deletions}-) across ${changed_files} files — consider splitting if possible.`;
            } else {
              label = '🔴 size/large';
              message = `PR size: ${total} lines changed (${additions}+ ${deletions}-) across ${changed_files} files — strongly consider splitting into smaller PRs.`;
              core.warning(message);
            }

            console.log(message);

            // Add size label to PR
            try {
              // Remove existing size labels
              const existingLabels = context.payload.pull_request.labels.map(l => l.name);
              for (const existing of existingLabels) {
                if (existing.startsWith('size/') || existing.includes('size/')) {
                  await github.rest.issues.removeLabel({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    issue_number: context.issue.number,
                    name: existing,
                  }).catch(() => {});
                }
              }

              await github.rest.issues.addLabels({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                labels: [label],
              });
            } catch (e) {
              console.log('Could not add label (missing permissions?): ' + e.message);
            }
```

---

### Step 3: Configure GitHub Repo Settings

Use `gh` CLI to configure branch protection and repo settings.

#### A. Enable Auto-Delete Head Branches

```bash
gh api -X PATCH "repos/${REPO}" \
  -f delete_branch_on_merge=true \
  --silent
echo "✓ Auto-delete head branches enabled"
```

#### B. Set Branch Protection Rules

For each protected branch (`dev`, `main`):

```bash
for BRANCH in $PROTECTED_BRANCHES; do
  gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
    --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["validate-branch-name", "backend", "frontend"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
EOF
  echo "✓ Branch protection set for '$BRANCH': 1 review required, status checks required"
done
```

**Note**: `enforce_admins: false` allows admins to bypass in emergencies. Change to `true` for strict enforcement.

**Note**: The `contexts` array must match the job names in your CI workflows. Adjust if your CI job names differ.

---

### Step 4: Install Git Hooks (Optional)

Ask the user: "Do you want to install local git hooks (Husky) for pre-commit branch validation? These are optional safety nets — the GitHub Action is the enforced gate. (y/n)"

If yes:

#### A. Install Husky

```bash
cd <project-root>
npm install --save-dev husky
npx husky init
```

#### B. Pre-commit Hook: Branch Name Check

Write to `.husky/pre-commit`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)

# Skip if detached HEAD or special branches
if [ -z "$BRANCH" ] || [ "$BRANCH" = "dev" ] || [ "$BRANCH" = "main" ]; then
  exit 0
fi

PATTERN="^(feature|fix|chore|bugfix|hotfix)/.+"
if ! echo "$BRANCH" | grep -qE "$PATTERN"; then
  echo ""
  echo "ERROR: Branch '$BRANCH' doesn't follow naming convention."
  echo "Expected: feature/<description>, fix/<description>, chore/<description>"
  echo "Example:  feature/${TICKET_PREFIX}-042-add-login"
  echo ""
  echo "To rename: git branch -m \$BRANCH feature/${TICKET_PREFIX}-XXX-description"
  echo ""
  exit 1
fi
```

#### C. Commit-msg Hook: Ticket Reference Warning

Write to `.husky/commit-msg`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

MSG=$(cat "$1")

# Warning only — does not block commit
if ! echo "$MSG" | grep -qiE "[A-Z]+-[0-9]+"; then
  echo ""
  echo "WARNING: Commit message has no ticket reference (e.g., ${TICKET_PREFIX}-042)."
  echo "Consider adding one for traceability."
  echo ""
fi
```

#### D. Make Hooks Executable

```bash
chmod +x .husky/pre-commit .husky/commit-msg
```

---

### Step 5: Register GitHub Webhook for Branch Events

If the project's GitHub webhook is not yet registered (or only handles `pull_request` events), extend it to also receive `create` events for automatic branch→ticket linking.

```bash
# Check existing webhooks
gh api "repos/${REPO}/hooks" --jq '.[].config.url'

# If no webhook pointing to your backend exists, create one:
WEBHOOK_URL="https://api.potentialai.com/api/webhooks/github"  # or staging URL
WEBHOOK_SECRET="<from IntegrationConfig>"

gh api -X POST "repos/${REPO}/hooks" \
  --input - <<EOF
{
  "config": {
    "url": "${WEBHOOK_URL}",
    "content_type": "json",
    "secret": "${WEBHOOK_SECRET}",
    "insecure_ssl": "0"
  },
  "events": ["pull_request", "create"],
  "active": true
}
EOF
echo "✓ Webhook registered for pull_request + create events"
```

**Note**: The `create` event fires when branches are created. The backend webhook handler needs to be extended to process this event (see Backend Changes section below).

---

### Step 6: Verify Setup

```bash
echo "=== Verification ==="

# Check GitHub Actions exist
echo "GitHub Actions:"
ls -la .github/workflows/branch-name-check.yml && echo "  ✓ branch-name-check.yml"
ls -la .github/workflows/pr-size-check.yml && echo "  ✓ pr-size-check.yml"

# Check branch protection
echo ""
echo "Branch Protection:"
for BRANCH in $PROTECTED_BRANCHES; do
  PROTECTION=$(gh api "repos/${REPO}/branches/${BRANCH}/protection" 2>/dev/null)
  if [ $? -eq 0 ]; then
    REVIEWS=$(echo "$PROTECTION" | jq '.required_pull_request_reviews.required_approving_review_count')
    echo "  ✓ $BRANCH: ${REVIEWS} review(s) required"
  else
    echo "  ✗ $BRANCH: no protection set"
  fi
done

# Check auto-delete
echo ""
echo "Repo Settings:"
AUTO_DELETE=$(gh api "repos/${REPO}" --jq '.delete_branch_on_merge')
echo "  Auto-delete head branches: $AUTO_DELETE"

# Check Husky (if installed)
echo ""
echo "Git Hooks:"
if [ -f .husky/pre-commit ]; then
  echo "  ✓ pre-commit hook installed"
else
  echo "  - pre-commit hook not installed (optional)"
fi
if [ -f .husky/commit-msg ]; then
  echo "  ✓ commit-msg hook installed"
else
  echo "  - commit-msg hook not installed (optional)"
fi

echo ""
echo "=== Setup Complete ==="
```

---

## Backend Changes Required

The skill creates the enforcement layer, but two backend changes are needed to complete the ticket lifecycle:

### 1. Handle `create` Events in Webhook Controller

File: `backend/src/modules/github/github-webhook.controller.ts`

Extend `handleWebhook()` to accept `create` events. When a branch is created with a ticket ID in the name, auto-transition the matching ticket to `IN_PROGRESS`.

### 2. Allow IN_PROGRESS → IN_REVIEW Transition

File: `backend/src/modules/tickets/pr-sync.service.ts`

Currently `prOpenedTransition` only fires when ticket status is `OPEN`. Extend to also fire from `IN_PROGRESS` so the full lifecycle works:
- Branch created → `IN_PROGRESS`
- PR opened → `IN_REVIEW`
- PR merged → `RESOLVED`

---

## Error Handling

| Error | Action |
|-------|--------|
| `gh` CLI not authenticated | Run `gh auth login` first |
| Repo not found | Verify `REPO` format is `owner/repo` |
| Branch protection API fails (403) | Need admin access to the repo |
| Husky init fails | Check Node.js version >= 18 |
| Webhook already exists | Skip creation, log existing webhook URL |
| Status check contexts don't match | Adjust `contexts` array to match actual CI job names |

---

## Integration with Other Skills

**This skill enables:**
- `PrLinkerService` — reliable auto-linking (branch names now guaranteed to have ticket IDs)
- `PrSyncService` — automatic ticket transitions (branch create → PR open → PR merge)
- Health scoring — accurate momentum/quality signals from clean PR data

**Pairs with:**
- `ensure-servers` — run after setup to verify backend webhook endpoint is reachable
- `init-workspace` — call this skill during project onboarding

---

## Quick Reference: What Gets Created

| Item | File/Setting | Enforced At |
|------|-------------|-------------|
| Branch name validation | `.github/workflows/branch-name-check.yml` | PR time (blocks merge) |
| PR size labeling | `.github/workflows/pr-size-check.yml` | PR time (label + warning) |
| Required reviews | GitHub branch protection rule | PR time (blocks merge) |
| Auto-delete branches | GitHub repo setting | Post-merge (automatic) |
| Local branch check | `.husky/pre-commit` | Pre-commit (local, optional) |
| Ticket ID in commit | `.husky/commit-msg` | Pre-commit (local, warning only) |
| Webhook for branch events | GitHub webhook config | Branch creation (real-time) |
