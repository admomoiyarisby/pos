# Deploying Omoiyari POS to a VPS

App + Caddy via Docker Compose. The database and image storage stay on
Supabase — this stack only runs the Node SSR server and a TLS proxy.

Target spec: **2 vCPU / 2 GB RAM / 40 GB SSD, in the same region as Supabase
(`ap-southeast-1`, Singapore)**.

## How deploys work

1. You `git push` to `main`.
2. GitHub Actions builds the Docker image and pushes it to GHCR
   (`ghcr.io/admomoiyarisby/pos:latest` + `:<git-sha>`).
3. The same workflow SSHes into the VPS, syncs `compose.yaml` + `Caddyfile`,
   pulls the new image, and runs `docker compose up -d`.

The VPS **never builds** — it only pulls. Workflow: `.github/workflows/deploy.yml`.

## Prerequisites

- A VPS with Docker Engine + the Compose plugin.
- A DNS record (A / AAAA) for your hostname pointing at the VPS. If you use
  Cloudflare, start with the record **DNS-only (grey cloud)** so Caddy can
  obtain its certificate, then enable the orange cloud.
- Ports 80 and 443 reachable.

## One-time VPS setup

Run these **on the VPS** — the repo is not cloned there, and CI only ships
`compose.yaml` + `Caddyfile`:

```bash
# on the VPS
sudo mkdir -p /srv/omoiyari-pos/deploy
sudo chown -R "$USER" /srv/omoiyari-pos
sudo usermod -aG docker "$USER"   # then log out and back in

# create the env file IN PLACE (fill in real values)
cat > /srv/omoiyari-pos/deploy/.env <<'EOF'
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
BETTER_AUTH_URL="https://your-real-domain"
BETTER_AUTH_SECRET="<openssl rand -hex 32>"
SUPABASE_URL="https://<ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
CRON_SECRET="<random>"
EOF
chmod 600 /srv/omoiyari-pos/deploy/.env
```

`deploy/.env` lives **only on the VPS** and is never overwritten by CI.
`BETTER_AUTH_URL` must be the public HTTPS origin.

The **Caddyfile is the opposite**: CI copies it from the repo on every deploy,
so set your domain in `deploy/Caddyfile` **in the repo and commit it** — do not
hand-edit the VPS copy, it will be overwritten. It must match `BETTER_AUTH_URL`.

## GitHub repository secrets

Settings → Secrets and variables → Actions → New repository secret:

| Secret        | Value                                                                         |
| ------------- | ----------------------------------------------------------------------------- |
| `VPS_HOST`    | VPS IP or hostname                                                            |
| `VPS_USER`    | SSH user (e.g. `deploy`)                                                      |
| `VPS_SSH_KEY` | private key (ed25519) whose public key is in the VPS `~/.ssh/authorized_keys` |
| `VPS_APP_DIR` | `/srv/omoiyari-pos`                                                           |
| `GHCR_TOKEN`  | _(optional)_ a PAT with `read:packages`, only if the GHCR package is private  |

`GITHUB_TOKEN` is provided automatically; it needs no setup.

Generate a key:

```bash
ssh-keygen -t ed25519 -C "gh-actions-deploy" -f deploy_key -N ""
# put deploy_key.pub into the VPS user's ~/.ssh/authorized_keys
# paste deploy_key (private) into the VPS_SSH_KEY secret
```

Make the GHCR package public (repo → Packages → `pos` → Package settings →
Change visibility → Public) to skip `GHCR_TOKEN` entirely.

## Deploy

```bash
git push origin main
```

Watch it under the repo's **Actions** tab. Caddy gets a Let's Encrypt cert on
first request and serves the app at `https://<your-host>`.

## Rollback

Every deploy also tags the exact commit. On the VPS:

```bash
cd /srv/omoiyari-pos/deploy
POS_IMAGE=ghcr.io/admomoiyarisby/pos:<git-sha> docker compose up -d
```

`git log` / the Actions run gives you the sha.

## Migrations — read this

`scripts/deploy-migrate.mjs` is gated on `VERCEL_ENV === "production"`, so on
a VPS it will **silently skip** and your code can ship ahead of its schema
(this is the exact failure the script was written to prevent). Run migrations
from your workstation before pushing a schema-changing deploy — the runtime
image does not include `drizzle-kit`:

```bash
DATABASE_URL="postgresql://…pooler.supabase.com:6543/postgres" \
VERCEL_ENV=production \
node scripts/deploy-migrate.mjs
```

## Keepalive cron

Vercel's cron (`/api/keepalive`) does not exist on the VPS. Add a host cron so
Supabase does not pause during quiet hours:

```bash
# crontab -e
17 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://pos.example.com/api/keepalive >/dev/null
```

## Gotchas

- **Passkeys break on a new hostname.** The passkey plugin is configured with
  `passkey()` and no options (`src/lib/auth.ts`), so its WebAuthn RP ID is
  derived from `BETTER_AUTH_URL`. Moving from `*.vercel.app` to your own domain
  changes the RP ID, and **existing passkeys stop working** — users must
  re-register them. Plan for that switch. (Password/PIN login is unaffected.)
- **Sessions reset.** The session cookie is scoped to the old origin, so
  everyone re-logs in once after the cutover. Do the move outside service hours.
- **Compression is Caddy's job.** The app serves uncompressed responses; if you
  swap Caddy for something else, make sure gzip/zstd/brotli is configured, or
  every first page load is ~3.5× bigger.
- **Keep assets immutable.** Nitro already sends
  `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`. Put
  Cloudflare in front and those requests stop reaching the VPS entirely.
- **Deploys are not gated on tests.** `deploy.yml` builds the image (so a broken
  _build_ blocks the deploy) but does not run `vp check`/`vp test`. To gate on
  those, trigger deploy via `workflow_run` after CI succeeds, or add a
  `needs:` job that runs them.

## Local build (no CI)

To build on your machine instead of pulling:

```bash
# in compose.yaml, comment `image:` and uncomment the `build:` block
cd deploy
docker compose up -d --build
```

## Alternative: systemd instead of Docker

If you prefer no Docker, run the same `.output` under systemd and install Caddy
from its apt repo — same Caddyfile, `reverse_proxy 127.0.0.1:3000`. The tradeoff
is losing image-tag rollback and paying host Node-version upkeep.
