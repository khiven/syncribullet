#!/usr/bin/env bash
# Pull upstream changes into this fork's main branch.
#
# Run from the repo root. Requires an `upstream` remote pointing at
# https://github.com/aliyss/syncribullet.git.
#
# This script intentionally stays tiny. The equivalent one-liner is:
#   git fetch upstream && git merge upstream/master && git push origin main
#
# If you prefer a linear history, replace `merge` with `rebase` — but
# remember that rebase rewrites main, so the next push needs
# --force-with-lease and whoever is tracking main remotely
# (including the GHCR build) will notice.
set -euo pipefail

BRANCH=main
UPSTREAM_BRANCH=upstream/master

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Missing 'upstream' remote. Add it with:"
  echo "  git remote add upstream https://github.com/aliyss/syncribullet.git"
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "Working tree is dirty. Commit or stash first."
  exit 1
fi

git fetch upstream
git checkout "$BRANCH"
git merge "$UPSTREAM_BRANCH"
git push origin "$BRANCH"

echo
echo "Sync complete. The build workflow will rebuild and publish the"
echo "image to ghcr.io/$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#'):main"
