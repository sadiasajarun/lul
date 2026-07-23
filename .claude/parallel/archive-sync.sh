#!/bin/bash
# archive-sync.sh — push/pull large run artifacts to/from cloud storage
#
# Tier 1 (memory, VERSIONS.md, RETROSPECTIVE, manifest.csv) lives in git.
# Tier 2 (raw episode JSONL, baseline.tar, full run dirs) lives here.
#
# Uses rclone so any backend works (Cloudflare R2, AWS S3, GCS, Backblaze).
# One-time setup:
#   brew install rclone
#   rclone config            # create remote named "archive" (R2/S3/etc)
#
# Usage:
#   archive-sync.sh push                # upload local archive → cloud
#   archive-sync.sh pull                # download cloud → local archive
#   archive-sync.sh push --dry-run      # preview what would change
#
# What's synced (relative to workspace root):
#   .claude-project/archive/episodes/        large JSONL traces
#   .claude-project/archive/artifacts/       forensic dumps
#   experiments/parallel-runs/baseline.tar   pre-built baseline (~GB)
#   experiments/parallel-runs/runs/          per-run forensic data
#
# What's NOT synced (use git):
#   .claude-project/memory/                  lessons (small)
#   .claude-project/archive/VERSIONS.md      hypothesis ledger
#   .claude-project/archive/manifest.csv     run index (text)
#   experiments/parallel-runs/runs/*/HYPOTHESIS.md  per-run hypothesis
#   experiments/parallel-runs/runs/*/SUMMARY.md     per-run summary

set -euo pipefail

REMOTE="${ARCHIVE_REMOTE:-archive}"
BUCKET="${ARCHIVE_BUCKET:-claude-fullstack-archive}"
WORKSPACE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="${PROJECT:-fsp}"

# Per-PRD layout: cloud paths mirror local layout —
#   s3://<bucket>/<project>/.claude-project/<project>/...
#   s3://<bucket>/<project>/experiments/parallel-runs/<project>/...
# So multiple projects share one bucket without colliding.
DEST="${REMOTE}:${BUCKET}/${PROJECT}"
DIRS=(
  ".claude-project/${PROJECT}/archive/episodes"
  ".claude-project/${PROJECT}/archive/artifacts"
  "experiments/parallel-runs/${PROJECT}/runs"
)
FILES=(
  "experiments/parallel-runs/${PROJECT}/baseline.tar"
)

# Exclude generated source code, deps, build output — these are regeneratable
# by re-running the pipeline from the baseline + .claude SHA. The point of
# the cloud archive is forensic state (status reports, agent logs, episode
# traces, hypothesis/summary), not the working trees themselves.
EXCLUDES=(
  --exclude='**/node_modules/**'
  --exclude='**/.git/**'
  --exclude='**/dist/**'
  --exclude='**/build/**'
  --exclude='**/.next/**'
  --exclude='**/.cache/**'
  --exclude='**/coverage/**'
  --exclude='**/package-lock.json'
  --exclude='**/yarn.lock'
  --exclude='**/pnpm-lock.yaml'
  # Inside runs/: keep .claude-project/ (status, agent-logs, episodes,
  # rl-runs) and HYPOTHESIS.md / SUMMARY.md / HARVEST_*.md.
  # Drop the working source trees (backend/, frontend/, frontend-*/) —
  # those are regeneratable from baseline.tar + .claude SHA.
  --exclude='runs/*/run-*/backend/**'
  --exclude='runs/*/run-*/frontend/**'
  --exclude='runs/*/run-*/frontend-*/**'
)

action="${1:-}"
shift || true

if ! command -v rclone >/dev/null 2>&1; then
  echo "ERROR: rclone not installed. brew install rclone, then 'rclone config' to add remote '$REMOTE'" >&2
  exit 1
fi

if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:"; then
  echo "ERROR: rclone remote '$REMOTE' not configured. Run 'rclone config' to create it (Cloudflare R2 / AWS S3 / etc)." >&2
  exit 1
fi

case "$action" in
  push)
    echo "[archive-sync] push → $DEST"
    cd "$WORKSPACE_ROOT"
    for d in "${DIRS[@]}"; do
      [ -d "$d" ] || continue
      echo "  + $d/"
      rclone sync "$d" "$DEST/$d" --transfers=8 --checkers=16 "${EXCLUDES[@]}" "$@"
    done
    for f in "${FILES[@]}"; do
      [ -f "$f" ] || continue
      echo "  + $f"
      rclone copy "$f" "$DEST/$(dirname "$f")/" "$@"
    done
    ;;
  pull)
    echo "[archive-sync] pull ← $DEST"
    cd "$WORKSPACE_ROOT"
    for d in "${DIRS[@]}"; do
      mkdir -p "$d"
      echo "  + $d/"
      rclone sync "$DEST/$d" "$d" --transfers=8 --checkers=16 "${EXCLUDES[@]}" "$@"
    done
    for f in "${FILES[@]}"; do
      mkdir -p "$(dirname "$f")"
      echo "  + $f"
      rclone copy "$DEST/$(dirname "$f")/$(basename "$f")" "$(dirname "$f")/" "$@"
    done
    ;;
  *)
    echo "Usage: archive-sync.sh {push|pull} [rclone-flags]" >&2
    echo ""
    echo "Examples:"
    echo "  archive-sync.sh push"
    echo "  archive-sync.sh push --dry-run"
    echo "  archive-sync.sh pull"
    echo ""
    echo "Env vars:"
    echo "  ARCHIVE_REMOTE  rclone remote name (default: archive)"
    echo "  ARCHIVE_BUCKET  bucket/prefix     (default: claude-fullstack-archive)"
    exit 1
    ;;
esac

echo "[archive-sync] done"
