# syncribullet (khiven fork)

Self-hosted Stremio addon syncing watch progress across MAL / AniList / Kitsu / Simkl / Trakt / **TV Time** / MDBList.
Fork of [aliyss/syncribullet](https://github.com/aliyss/syncribullet). Stack: Qwik City + Express (`server/entry.express`), Node 20.

## Branch model (non-standard — respect it)

- **`master`** — pure mirror of `upstream/master`. Never commit here.
- **`fix/*`** — one commit per fix, PR-ready against upstream (currently two: `fix/dockerfile-local-build`, `fix/dockerfile-local-origin`).
- **`feat/*`** — feature branches (for Phase 2).
- **`deploy`** — merges all fix/feat branches + infra (CI, compose, scripts). **This is what prod runs.** Force-pushed when `scripts/sync-upstream.sh` rebuilds it from master.

Syncing with upstream: run `scripts/sync-upstream.sh` from repo root. It fetches, fast-forwards master, rebases each `fix/*` onto it, then rebuilds `deploy` from scratch.

## Deploy pipeline

- `.github/workflows/build.yml` builds multi-arch on push to `deploy` (or `v*` tags).
- Fan-out matrix: `ubuntu-latest` (amd64) and `ubuntu-24.04-arm` (arm64), **native runners only** — QEMU crashes on Node 20 here, don't switch back.
- Publishes to `ghcr.io/khiven/syncribullet` with tags `:deploy`, `:latest`, `:sha-<short>`, and `:vX.Y.Z` on tag pushes.
- Production VPS pulls via Portainer stack (no SSH build on the VPS).

## Live deployment

- URL: `https://syncribullet.khiven.xyz` (khiven's VPS, aarch64, nginx on host → `127.0.0.1:3050`).
- nginx conf: `/etc/nginx/sites-available/syncribullet.khiven.xyz`, Cloudflare wildcard certs at `/etc/letsencrypt/live/khiven.xyz/`.
- Container config via Portainer stack env vars: `PRIVATE_ENCRYPTION_KEY` and `ORIGIN=https://syncribullet.khiven.xyz`.

## Critical don'ts

- **Never rotate `PRIVATE_ENCRYPTION_KEY`.** It encrypts the config embedded in every user's addon install URL. Rotating it invalidates every existing Stremio install — they'd all have to re-configure.
- **Never commit `.env`** (gitignored alongside `.env.local`).
- **Never add `Co-Authored-By: Claude` to commits** (standing user preference across all projects).
- **Don't push to `master`** — it's strictly a mirror.

## Known upstream quirks (patched in `deploy`, not master)

- `Dockerfile.local` has `npm ci --omit=dev` which strips `qwik` (devDep), breaking `npm run build`. Patched by `fix/dockerfile-local-build`.
- `Dockerfile.local` entrypoint runs `npm run start:local`, which hardcodes `ORIGIN=http://127.0.0.1:3000`. Patched by `fix/dockerfile-local-origin` (switches to `npm run serve`, lets env set `ORIGIN`).
- The upstream Docker Hub image (`aliyss/syncribullet:latest`) is **amd64-only** — that's why we publish our own multi-arch.

## TV Time module

Isolated at `src/utils/receivers/tvtime/` — clean integration, but has gaps that are the target of Phase 2 work:

- **Token refresh**: absent. JWT expires and user must re-login. Intervention points: `api/` + `receiver-server.ts`. Detect 401 → refresh with `jwt_refresh_token`.
- **Import sync (bulk backfill)**: disabled (`importSync: false` in `constants.ts`). Endpoints already mapped in the module — flip the flag and implement the iterator.
- **No tests.** The upstream TV Time API (`api2.tozelabs.com/v2`, `msapi.tvtime.com/v1`) is private and brittle.

Auth is username/password → JWT, sent **client-side directly to TV Time** from `src/components/forms/tvtime-login.tsx` (never through our server). Accounts created via Facebook login can't use password auth without a TV Time support ticket.

## Plan / memory locations

- Plan file: `C:\Users\tonia\.claude\plans\mossy-brewing-blum.md` (historical record).
- Auto-memory index: `C:\Users\tonia\.claude\projects\D--git\memory\MEMORY.md` — has project + reference entries for syncribullet.
