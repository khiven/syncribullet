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

Isolated at `src/utils/receivers/tvtime/` plus `src/utils/mappings/tvtime.ts`.

### What's implemented in this fork

- **Structured logging** (`api/log.ts`): every TV Time HTTP call emits a single line `[ts] [tvtime] [<op>] key=val ...` to stdout. Ops: `sync`, `meta-previews`, `episodes`, `mappings`, `refresh`. `LOG_FORMAT=json` switches to JSON. Inspect with `docker logs syncribullet | grep '\[tvtime\]'`.
- **Rolling counters** (`api/log.ts` `getTVTimeCounters`): in-memory 15-minute ring of `op:statusClass` counts + last_success per op. Exposed at `GET /tvtime/status`. `GET /health` returns a flat 200 for external monitoring.
- **Hardened refresh wrapper** (`api/refresh.ts`):
  - **Proactive**: decodes the JWT `exp` claim; if the access token is within 60s of expiry, refreshes BEFORE the call instead of paying a 401 round-trip.
  - **Reactive**: on 401, refreshes and retries once.
  - **Single-flight**: concurrent refreshes for the same user share one in-flight promise (no refresh stampede).
  - **Dead-RT memoize**: when the refresh endpoint rejects `rt`, fails fast for 5 min instead of spamming TV Time.
  - **Process-local token mutation**: `auth.access_token` is updated in place so paginated catalog loops don't 401-storm.
  - **Typed error**: `TVTimeReAuthRequired` distinguishes "user must reconfigure" from any other 401.
  - **Transient retry**: 429 honors `Retry-After`; 5xx waits 500-1000ms jitter and retries once.
  - **Body preview on refresh failure**: surfaces Cloudflare interstitials and unexpected JSON shapes.
- **Wrapper coverage**: `sync.ts`, `meta-previews.ts`, `episodes.ts`, `mappings/tvtime.ts`. The mapping was added to fix a silent-failure class — without it, an expired access token tripped at the `search.tvtime.com` call before reaching any wrapped call, so refresh never fired.
- **Sync POSTs never cache**: `cache: false` on every receiver's `sync.ts` POST (tvtime, simkl, mdblist). The global `methods: ['get','post']` list is intentionally permissive for anilist's GraphQL query caching, but mutations must always hit the wire.
- **Opt-in notification**: `NOTIFY_WEBHOOK_URL` env var receives a POST `{source, event, user, reason}` when `rt` dies. ntfy/Discord/n8n-compatible.
- **No persistence**. Config lives encrypted in the addon URL; we cannot re-encrypt. The refreshed access token dies with the request. Net effect: post-expiry, each addon request pays the 3-call refresh cost until the user re-logs in. Stateless by design — declined SQLite/Redis to keep that contract.

### Still pending (Phase 2 P2 and beyond)

- **Import sync (bulk backfill)**: disabled (`importSync: false` in `constants.ts`). Endpoints already mapped — flip the flag and implement the iterator.
- **Tests**: none. The upstream TV Time API (`api2.tozelabs.com/v2`, `msapi.tvtime.com/v1`, `search.tvtime.com/v1`) is private and brittle.

### Auth / access

Login: username/password → JWT, sent **client-side directly to TV Time** from `src/components/forms/tvtime-login.tsx` (never through our server). Stored `auth` shape: `{id, access_token, rt}` (see `types/user-settings.ts`). Accounts created via Facebook login can't use password auth without a TV Time support ticket.

**Captured contract** (verified 2026-04-19, refresh contract reproduced from PWA Network tab):
- Access JWT TTL: **60 days** from `iat`.
- Refresh endpoint: `GET https://api2.tozelabs.com/v2/user/{id}/jwt` via `https://app.tvtime.com/sidecar?o_b64=<base64url(target)>`.
- Headers: `Authorization: Bearer <access_token>` (expired is fine for THIS endpoint) + `jwt_refresh_token: <rt>` (HTTP headers are case-insensitive — TV Time sends `Jwt_refresh_token`).
- Response body: `{"id": "...", "jwt_token": "<new access token>"}` — **the `rt` does NOT rotate**, the same refresh token keeps working until the rt JWT itself expires.

### Observability cheatsheet

```bash
# Live tail of structured TV Time activity:
docker logs -f syncribullet | grep '\[tvtime\]'

# Look for evidence the refresh path fired and worked:
docker logs syncribullet | grep -E '\[tvtime\] \[refresh\]|after_refresh=true'

# A refresh that succeeded but the retry still failed (= bug, or wrapper missing):
docker logs syncribullet | grep 'after_refresh=true' | grep -E 'status=[45]'

# Rolling 15-min health snapshot:
curl https://syncribullet.khiven.xyz/tvtime/status
curl https://syncribullet.khiven.xyz/health
```

### Env vars

| Var | Default | Purpose |
|---|---|---|
| `PRIVATE_ENCRYPTION_KEY` | — | Encrypts user configs in the addon URL. Never rotate. |
| `ORIGIN` | — | Public base URL; required to generate Stremio install links. |
| `NOTIFY_WEBHOOK_URL` | unset | POST endpoint that gets a JSON body when rt dies. |
| `AXIOS_CACHE_DEBUG` | `0` | When `1`, axios-cache-interceptor logs every event. Off by default because the JSON dumps break log greppability. |
| `LOG_FORMAT` | `logfmt` | `json` switches `logTVTime` to JSON-per-line for log shippers. |

## Plan / memory locations

- Plan file: `C:\Users\tonia\.claude\plans\mossy-brewing-blum.md` (historical record).
- Auto-memory index: `C:\Users\tonia\.claude\projects\D--git\memory\MEMORY.md` — has project + reference entries for syncribullet.
