#!/usr/bin/env bash
# Sync this fork with upstream (aliyss/syncribullet) and rebuild the
# deploy branch on top of the rebased fix branches.
#
# Run from the repo root. Requires an `upstream` remote pointing at
# https://github.com/aliyss/syncribullet.git
set -euo pipefail

UPSTREAM_REMOTE=upstream
ORIGIN_REMOTE=origin
MASTER_BRANCH=master
DEPLOY_BRANCH=deploy
FORK_BRANCHES=(fix/dockerfile-local-build fix/dockerfile-local-origin)
GITIGNORE_GREP="ignore local deploy/ folder"

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "Missing '$UPSTREAM_REMOTE' remote. Add it with:"
  echo "  git remote add $UPSTREAM_REMOTE https://github.com/aliyss/syncribullet.git"
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "Working tree is dirty. Commit or stash first."
  exit 1
fi

GITIGNORE_COMMIT=$(git log "$DEPLOY_BRANCH" --grep="$GITIGNORE_GREP" --format="%H" -n 1 || true)
if [ -z "$GITIGNORE_COMMIT" ]; then
  echo "Could not locate the gitignore commit on '$DEPLOY_BRANCH' (looking for: $GITIGNORE_GREP)"
  echo "Aborting — would rebuild deploy without it."
  exit 1
fi

echo "→ Fetching remotes"
git fetch "$UPSTREAM_REMOTE"
git fetch "$ORIGIN_REMOTE"

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
git cherry-pick "$GITIGNORE_COMMIT"
git push --force-with-lease "$ORIGIN_REMOTE" "$DEPLOY_BRANCH"

echo
echo "Sync complete. The build workflow will rebuild the container image"
echo "and push it to ghcr.io/$(git remote get-url "$ORIGIN_REMOTE" | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#'):deploy"
