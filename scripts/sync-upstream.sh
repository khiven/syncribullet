#!/usr/bin/env bash
# Sync this fork with upstream (aliyss/syncribullet) and rebuild the
# deploy branch on top of the rebased fix branches.
#
# Run from the repo root. Requires an `upstream` remote pointing at
# https://github.com/aliyss/syncribullet.git
#
# Strategy:
#   1. Fast-forward master to upstream/master (master stays a mirror).
#   2. Rebase each fix/* branch onto the new master.
#   3. Rebuild deploy from scratch: reset to master, re-merge each fix
#      branch, then cherry-pick every deploy-only commit (anything that
#      was on origin/deploy but not reachable from master or fix/*).
#      This way, infra commits added directly to deploy (CI workflow,
#      compose, docs, etc.) are preserved automatically — no per-commit
#      allow-list to maintain.
set -euo pipefail

UPSTREAM_REMOTE=upstream
ORIGIN_REMOTE=origin
MASTER_BRANCH=master
DEPLOY_BRANCH=deploy
FORK_BRANCHES=(fix/dockerfile-local-build fix/dockerfile-local-origin)

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "Missing '$UPSTREAM_REMOTE' remote. Add it with:"
  echo "  git remote add $UPSTREAM_REMOTE https://github.com/aliyss/syncribullet.git"
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "Working tree is dirty. Commit or stash first."
  exit 1
fi

echo "→ Fetching remotes"
git fetch "$UPSTREAM_REMOTE"
git fetch "$ORIGIN_REMOTE"

# Capture deploy-only commits BEFORE rewriting branches. List non-merge
# commits reachable from origin/deploy but not from master or any fix/*,
# in chronological order (oldest first) for cherry-picking.
NOT_REFS=("^$ORIGIN_REMOTE/$MASTER_BRANCH")
for branch in "${FORK_BRANCHES[@]}"; do
  NOT_REFS+=("^$ORIGIN_REMOTE/$branch")
done

DEPLOY_ONLY_COMMITS=$(git log "$ORIGIN_REMOTE/$DEPLOY_BRANCH" "${NOT_REFS[@]}" \
  --no-merges --reverse --format='%H')

if [ -z "$DEPLOY_ONLY_COMMITS" ]; then
  echo "Warning: no deploy-only commits found. Proceeding anyway."
fi

echo "→ Updating $MASTER_BRANCH to $UPSTREAM_REMOTE/$MASTER_BRANCH"
git checkout "$MASTER_BRANCH"
git merge --ff-only "$UPSTREAM_REMOTE/$MASTER_BRANCH"
git push "$ORIGIN_REMOTE" "$MASTER_BRANCH"

for branch in "${FORK_BRANCHES[@]}"; do
  echo "→ Rebasing $branch onto $MASTER_BRANCH"
  git checkout "$branch"
  git rebase "$MASTER_BRANCH"
  git push --force-with-lease "$ORIGIN_REMOTE" "$branch"
done

echo "→ Rebuilding $DEPLOY_BRANCH from scratch"
git checkout "$DEPLOY_BRANCH"
git reset --hard "$MASTER_BRANCH"
for branch in "${FORK_BRANCHES[@]}"; do
  git merge --no-ff "$branch" -m "Merge branch '$branch' into $DEPLOY_BRANCH"
done

if [ -n "$DEPLOY_ONLY_COMMITS" ]; then
  echo "→ Cherry-picking $(echo "$DEPLOY_ONLY_COMMITS" | wc -l) deploy-only commits"
  # shellcheck disable=SC2086
  git cherry-pick $DEPLOY_ONLY_COMMITS
fi

git push --force-with-lease "$ORIGIN_REMOTE" "$DEPLOY_BRANCH"

echo
echo "Sync complete. The build workflow will rebuild the container image"
echo "and push it to ghcr.io/$(git remote get-url "$ORIGIN_REMOTE" | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#'):deploy"
