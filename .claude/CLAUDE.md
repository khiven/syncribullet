# syncribullet (khiven fork)

Self-hosted Stremio addon syncing watch progress across MAL / AniList / Kitsu / Simkl / Trakt / **TV Time** / MDBList.
Fork of [aliyss/syncribullet](https://github.com/aliyss/syncribullet). Stack: Qwik City + Express (`server/entry.express`), Node 20.

## Branch model

**Single-branch workflow.** One branch to reason about:

- **`main`** (default) — your working branch. Commits directly here: fixes, features, infra, docs. Linear history preserved so individual commits remain cherry-pick-able for upstream PRs.

No local `master` mirror. Upstream is referenced via the remote-tracking ref `upstream/master`.

### Syncing with upstream

```bash
git fetch upstream
git merge upstream/master   # on main. Use rebase if you prefer linear history.
git push origin main
```

Or: `scripts/sync-upstream.sh` (same thing, with a dirty-tree check).

### Opening a PR upstream (on-demand)

When you want to propose a specific commit (or a few) back to upstream:

```bash
git checkout -b fix/<topic> upstream/master
git cherry-pick <commit-from-main>
git push origin fix/<topic>
# open PR via GitHub UI; delete the branch once merged
```

## Deploy pipeline

- `.github/workflows/build.yml` builds multi-arch on push to `main` (or `v*` tags). Pushes touching only `.claude/**` or `**.md` skip the build (paths-ignore).
- Fan-out matrix: `ubuntu-latest` (amd64) and `ubuntu-24.04-arm` (arm64), **native runners only** — QEMU crashes on Node 20 here, don't switch back.
- Publishes to `ghcr.io/khiven/syncribullet` with tags `:main`, `:latest`, `:sha-<short>`, and `:vX.Y.Z` on tag pushes.
- Production VPS pulls via Portainer stack (no SSH build on the VPS).

## Live deployment

- URL: `https://syncribullet.khiven.xyz` (khiven's VPS, aarch64, nginx on host → `127.0.0.1:3050`).
- nginx conf: `/etc/nginx/sites-available/syncribullet.khiven.xyz`, Cloudflare wildcard certs at `/etc/letsencrypt/live/khiven.xyz/`.
- Container config via Portainer stack env vars: `PRIVATE_ENCRYPTION_KEY` and `ORIGIN=https://syncribullet.khiven.xyz`.
- Portainer stack image: `ghcr.io/khiven/syncribullet:main`.

## Critical don'ts

- **Never rotate `PRIVATE_ENCRYPTION_KEY`.** It encrypts the config embedded in every user's addon install URL. Rotating it invalidates every existing Stremio install — they'd all have to re-configure.
- **Never commit `.env`** (gitignored alongside `.env.local`).
- **Never add `Co-Authored-By: Claude` to commits** (standing user preference across all projects).

## Known upstream quirks (patched in this fork)

Both patches live as atomic commits on `main`, cherry-pick-able if you ever want to PR them upstream (their SHAs change on every upstream sync due to rebase-on-merge; find by commit message):

- `fix(Dockerfile.local): install all deps for build, prune devDeps after` — upstream's `npm ci --omit=dev` strips `qwik` (devDep), breaking `npm run build`.
- `fix(Dockerfile.local): use \`npm run serve\` so ORIGIN can be set via env` — upstream entrypoint runs `npm run start:local`, which hardcodes `ORIGIN=http://127.0.0.1:3000` and breaks install URLs behind a reverse proxy.
- The upstream Docker Hub image (`aliyss/syncribullet:latest`) is **amd64-only** — that's why we publish our own multi-arch.

## TV Time module

Isolated at `src/utils/receivers/tvtime/`.

### What's implemented in this fork (Phase 2 P1)

- **Structured logging** (`api/log.ts`): every TV Time HTTP call emits a single stdout line `[ts] [tvtime] [<op>] key=val ...`. Ops: `sync`, `meta-previews`, `episodes`, `refresh`. Inspect with `docker logs syncribullet | grep tvtime`.
- **JWT refresh on 401** (`api/refresh.ts`): `withTVTimeRefresh` wraps every call. On 401 it GETs `api2.tozelabs.com/v2/user/{id}/jwt` via the sidecar proxy, sending `Authorization: Bearer <access_token>` + `jwt_refresh_token: <rt>`; the response `{id, jwt_token}` provides a fresh access token. The wrapper retries the original call once with that token. The `rt` does **not** rotate — the same refresh token keeps working until it itself expires.
- **No persistence of the refreshed token.** Config lives encrypted in the addon URL; we cannot re-encrypt. The refreshed access token dies with the request. Net effect: once the user's stored `access_token` expires, every subsequent addon call pays `3 HTTP calls` (401 + refresh + retry) instead of 1 until the user re-logs in and mints a new URL. Acceptable for personal use; revisit if traffic grows.

### Still pending (Phase 2 P2 and beyond)

- **Import sync (bulk backfill)**: disabled (`importSync: false` in `constants.ts`). Endpoints already mapped in the module — flip the flag and implement the iterator.
- **Tests**: none. The upstream TV Time API (`api2.tozelabs.com/v2`, `msapi.tvtime.com/v1`) is private and brittle.
- **Persistent token cache** (SQLite / Redis): would collapse the post-expiry overhead back to 1 call per sync. Declined for now to keep the stateless architecture.

### Auth / access

Login: username/password → JWT, sent **client-side directly to TV Time** from `src/components/forms/tvtime-login.tsx` (never through our server). Stored `auth` shape: `{id, access_token, rt}` (see `types/user-settings.ts`). Accounts created via Facebook login can't use password auth without a TV Time support ticket.

Known values at time of capture (2026-04-19): access JWT TTL ≈ **60 days**; refresh endpoint at `https://api2.tozelabs.com/v2/user/{id}/jwt` (GET, via sidecar proxy).

## Plan / memory locations

- Plan file: `C:\Users\tonia\.claude\plans\mossy-brewing-blum.md` (historical record).
- Auto-memory index: `C:\Users\tonia\.claude\projects\D--git\memory\MEMORY.md` — has project + reference entries for syncribullet.
