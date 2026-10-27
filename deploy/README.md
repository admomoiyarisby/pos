# Deploying Omoiyari POS to a VPS

App + Caddy + Postgres 17 via Docker Compose. Recipe images live on the VPS
disk. Backups go to Cloudflare R2 with `restic`.

Target spec: **2 vCPU / 2 GB RAM / 40 GB SSD**.

```
Internet ──► Caddy (:80/:443) ──► app (:3000) ──► db (postgres:17, volume)
                                      │
                                      └──► /srv/omoiyari-pos/media (bind mount)
```

The database port is published on `127.0.0.1:5432` only. Nothing outside the
VPS can reach it; backups, migrations, and the CI rehearsal use an SSH tunnel.

## How deploys work

1. You `git push` to `main`.
2. GitHub Actions runs `check`, `test`, and the migration-journal drift check.
3. It builds the image and pushes it to GHCR
   (`ghcr.io/admomoiyarisby/pos:latest` + `:<git-sha>`).
4. If `VPS_DB_PASSWORD` is set, it opens an SSH tunnel, runs
   `vp run db:migrate` against the VPS database, then closes the tunnel.
5. It SSHes into the VPS, syncs `compose.yaml`, `Caddyfile`, and the backup
   files, pulls the new image, and runs `docker compose up -d`.

The VPS **never builds** — it only pulls. Workflow: `.github/workflows/ci.yml`.

## Prerequisites

- A VPS with Docker Engine + the Compose plugin.
- A DNS record (A / AAAA) for your hostname pointing at the VPS. If you use
  Cloudflare, start with the record **DNS-only (grey cloud)** so Caddy can
  obtain its certificate, then enable the orange cloud.
- Ports 80 and 443 reachable.
- A Cloudflare R2 bucket + API token for off-site backups (below).

## One-time VPS setup

Run these **on the VPS**. The repo is not cloned there; CI ships the compose
file, Caddyfile, and backup scripts.

```bash
# on the VPS
sudo mkdir -p /srv/omoiyari-pos/{deploy,media,backups}
sudo chown -R "$USER" /srv/omoiyari-pos
sudo usermod -aG docker "$USER"   # then log out and back in

# The app runs as uid 1000 (`node`) inside the image and must write images.
sudo chown -R 1000:1000 /srv/omoiyari-pos/media
```

Create `/srv/omoiyari-pos/deploy/.env` **in place** (CI never overwrites it):

```bash
cat > /srv/omoiyari-pos/deploy/.env <<'EOF'
# Postgres. POSTGRES_PASSWORD must be URL-safe (letters, digits, - _) because
# compose interpolates it into the app's DATABASE_URL.
POSTGRES_DB="omoiyari"
POSTGRES_USER="omoiyari"
POSTGRES_PASSWORD="<openssl rand -hex 24>"

BETTER_AUTH_URL="https://your-real-domain"
BETTER_AUTH_SECRET="<openssl rand -hex 32>"
CRON_SECRET="<random>"
EOF
chmod 600 /srv/omoiyari-pos/deploy/.env
```

Do **not** put `DATABASE_URL` in this file. Compose builds it from the
`POSTGRES_*` values and points it at the `db` service, so the credentials live
in one place.

`BETTER_AUTH_URL` must be the public HTTPS origin. The **Caddyfile is the
opposite**: CI copies it from the repo on every deploy, so set your domain in
`deploy/Caddyfile` **in the repo and commit it** — do not hand-edit the VPS
copy, it will be overwritten.

Start the stack:

```bash
cd /srv/omoiyari-pos/deploy
docker compose up -d
docker compose ps
```

### Migrations and the first schema

The runtime image has no `drizzle-kit`. Run migrations from your workstation
through an SSH tunnel (CI does the same automatically once
`VPS_DB_PASSWORD` is set):

```bash
ssh -N -L 55432:127.0.0.1:5432 deploy@your-vps
# in another terminal, in the repo:
env -u TEST_DATABASE_URL \
  DATABASE_URL='postgresql://omoiyari:<pw>@127.0.0.1:55432/omoiyari' \
  vp run db:migrate
```

`env -u TEST_DATABASE_URL` matters: `drizzle.config.ts` prefers
`TEST_DATABASE_URL` and would migrate your local test database instead.

## GitHub repository secrets

Settings → Secrets and variables → Actions → New repository secret:

| Secret            | Value                                                                         |
| ----------------- | ----------------------------------------------------------------------------- |
| `VPS_HOST`        | VPS IP or hostname                                                            |
| `VPS_USER`        | SSH user (e.g. `deploy`)                                                      |
| `VPS_SSH_KEY`     | private key (ed25519) whose public key is in the VPS `~/.ssh/authorized_keys` |
| `VPS_APP_DIR`     | `/srv/omoiyari-pos`                                                           |
| `VPS_DB_PASSWORD` | the `POSTGRES_PASSWORD` from `deploy/.env`                                    |
| `SUPABASE_DB_URL` | _(rehearsal only)_ session-mode URL, port **5432**, password URL-encoded      |
| `GHCR_TOKEN`      | _(optional)_ a PAT with `read:packages`, only if the GHCR package is private  |

`VPS_DB_PASSWORD` enables the pre-deploy migration step. Leave it unset and
migrations are skipped (the Supabase-era behaviour). **Set it only after the
VPS `db` service exists and the production database has been restored** —
otherwise the first deploy after adding it tries to migrate an empty database
before the data move is done. `SUPABASE_DB_URL` is only read by the rehearsal
workflow.

Generate a key:

```bash
ssh-keygen -t ed25519 -C "gh-actions-deploy" -f deploy_key -N ""
# put deploy_key.pub into the VPS user's ~/.ssh/authorized_keys
# paste deploy_key (private) into the VPS_SSH_KEY secret
```

Make the GHCR package public (repo → Packages → `pos` → Package settings →
Change visibility → Public) to skip `GHCR_TOKEN` entirely.

## Backups

A backup on the same VPS is not a backup. `deploy/backup.sh` writes a nightly
`pg_dump` + globals dump, then copies those **and** the media directory
off-site with `restic`.

### 1. Create the R2 bucket and token

1. Create a free Cloudflare account → **R2** → **Create bucket**
   (`omoiyari-backups`). R2's free tier covers 10 GB; your data is well under
   1 GB.
2. **Manage R2 API Tokens** → **Create API token** → permission
   **Object Read & Write**, scoped to that bucket. Copy the access key id and
   secret (shown once).
3. Note your **Account ID** from the R2 overview page.

### 2. Install restic and configure it

```bash
sudo apt-get update && sudo apt-get install -y restic

sudo install -m 0600 deploy/backup.env.example /etc/omoiyari-backup.env
sudo editor /etc/omoiyari-backup.env
```

Fill in `RESTIC_REPOSITORY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
`RESTIC_PASSWORD`. The restic password encrypts the backup client-side — store
it in a password manager. **Without it the off-site backup cannot be restored.**

Initialise the repository once:

```bash
set -a; source /etc/omoiyari-backup.env; set +a
restic init
```

### 3. Install the nightly timer

```bash
sudo install -m 0755 deploy/backup.sh /usr/local/bin/omoiyari-backup
sudo install -m 0644 deploy/systemd/omoiyari-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/omoiyari-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now omoiyari-backup.timer
```

The timer runs at **18:30 UTC** (01:30 WIB), after closing. Run it by hand
once to prove the credentials:

```bash
sudo omoiyari-backup
sudo systemctl list-timers omoiyari-backup.timer
```

What it keeps:

- **Local**: 7 days of dumps in `/srv/omoiyari-pos/backups/db`.
- **Off-site**: 14 daily, 8 weekly, 12 monthly snapshots (restic `forget`).

### 4. Restore drill (monthly)

```bash
sudo /srv/omoiyari-pos/deploy/restore-drill.sh
```

It restores the newest local dump into `omoiyari_restore_test`, checks the
core tables and the Drizzle journal, then drops the database. It refuses any
target name that does not end in `_restore_test`.

To restore from R2 instead of local disk:

```bash
set -a; source /etc/omoiyari-backup.env; set +a
restic snapshots --tag omoiyari
restic restore latest --target /tmp/restic-restore
sudo /srv/omoiyari-pos/deploy/restore-drill.sh /tmp/restic-restore/srv/omoiyari-pos/backups/db/<file>.dump
```

### Images

The media directory is in the same restic snapshot as the database dump, so a
restore returns both. `restic restore` recreates `/srv/omoiyari-pos/media`
with the exact paths the database expects.

## Moving the data from Supabase (cutover runbook)

The full procedure is rehearsed by `.github/workflows/db-rehearsal.yml`. The
short version:

1. **Announce a maintenance window** (15 minutes at closing).
2. Stop the app: `docker compose stop app` (Caddy can keep serving a 502, or
   put up a maintenance page).
3. Run the rehearsal workflow one last time to confirm the procedure on the
   current data.
4. Take the final data dump and restore it into the production database:
   - reset the target (fresh `db:migrate`)
   - `psql -f scripts/sql/rehearsal-before-restore.sql`
   - `vp dlx supabase db dump --data-only -s public --db-url "$SUPABASE_DB_URL"`
   - `psql -f dump.sql`
   - `psql -f scripts/sql/rehearsal-after-restore.sql`
   - `node scripts/verify-restored-db.mjs`
5. Move the images: `node scripts/migrate-recipe-images.mjs` with
   `PUBLIC_BASE_URL=https://your-domain` and `MEDIA_ROOT=/srv/omoiyari-pos/media`.
   Then `sudo chown -R 1000:1000 /srv/omoiyari-pos/media` so the app (uid 1000)
   can replace images in the directories the root-run migration created.
6. `docker compose up -d app`.
7. Manual write check (the smoke test is read-only):
   - log in with a real account
   - create one POS order, confirm it appears in Data Penjualan
   - record one stock movement (waste or transfer), confirm Kartu Stok
   - open `/finance` and confirm the day's totals
8. Keep Supabase untouched for at least a week. Rollback is pointing
   `DATABASE_URL` back at Supabase and restarting the old image.

The source-only columns (`include_in_pnl`) are bridged by
`scripts/sql/rehearsal-before-restore.sql` because the live Supabase schema
still has them while the repo dropped them (ADR-0025).

## Rehearsal workflow

`.github/workflows/db-rehearsal.yml` is `workflow_dispatch` only. It:

1. opens an SSH tunnel to the VPS database,
2. drops and recreates `omoiyari_rehearsal` (the name is hard-coded),
3. runs `vp run db:migrate`, restores the Supabase dump, drops the bridge
   columns,
4. downloads the recipe images to a temp media directory and rewrites the
   rehearsal URLs,
5. compares all `public` table counts against the source and checks that no
   recipe still points at Supabase,
6. builds the app, starts it against `omoiyari_rehearsal`, creates a throwaway
   smoke account, and logs in through the browser,
7. uploads `smoke-artifacts/report.json`, the count report, and the app log.

It never references the production database name. If a run fails, re-run with
`keep_database` enabled to inspect the half-restored database.

## Rollback

Every deploy also tags the exact commit. On the VPS:

```bash
cd /srv/omoiyari-pos/deploy
POS_IMAGE=ghcr.io/admomoiyarisby/pos:<git-sha> docker compose up -d
```

`git log` / the Actions run gives you the sha.

Database rollback after cutover: stop the app, restore the pre-cutover dump
into a fresh database (or switch `DATABASE_URL` back to Supabase), start the
app.

## Keepalive cron

`/api/keepalive` existed to stop Supabase pausing. With a native database it is
no longer needed. Leave the route in place (harmless) or remove it.

## Gotchas

- **Passkeys break on a new hostname.** The passkey plugin is configured with
  `passkey()` and no options (`src/lib/auth.ts`), so its WebAuthn RP ID is
  derived from `BETTER_AUTH_URL`. Moving from `*.vercel.app` to your own domain
  changes the RP ID, and **existing passkeys stop working** — users must
  re-register them. (Password/PIN login is unaffected.)
- **Sessions reset.** The session cookie is scoped to the origin, so everyone
  re-logs in once after the cutover. Do the move outside service hours.
- **Compression is Caddy's job.** The app serves uncompressed responses; if you
  swap Caddy for something else, make sure gzip/zstd/brotli is configured.
- **Media permissions.** The container runs as uid 1000. If uploads fail with
  `EACCES`, `sudo chown -R 1000:1000 /srv/omoiyari-pos/media`.
- **Keep assets immutable.** Nitro already sends
  `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`.
  Recipe images get the same header from `/media/*`.
- **Deploys are gated on tests.** In `ci.yml` the `deploy` job `needs: build`,
  which `needs: [check, test, drift]`.
- **Disk.** The database is ~130 MB; dumps are ~20–40 MB compressed. 40 GB is
  ample, but watch `/var/lib/docker` if you never prune old images — CI does
  `docker image prune -f` after each deploy.

## Local build (no CI)

To build on your machine instead of pulling:

```bash
# in compose.yaml, comment `image:` and uncomment the `build:` block
cd deploy
docker compose up -d --build
```

## Alternative: systemd instead of Docker

If you prefer no Docker, run the same `.output` under systemd and install
Caddy from its apt repo — same Caddyfile, `reverse_proxy 127.0.0.1:3000`, plus
a host Postgres 17. The tradeoff is losing image-tag rollback and paying host
Node/Postgres version upkeep.
