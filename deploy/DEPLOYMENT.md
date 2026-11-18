# Ubuntu VPS deployment

Target: Ubuntu 24.04 LTS, Node.js 24 LTS, PostgreSQL 16+, Nginx, systemd. Use a domain you control; examples use `school.example.com`. These commands are a runbook, not an executed deployment. Take a VPS snapshot and back up existing Nginx configuration before server changes. Never run test suites against production.

## 1. Prerequisites, network, and accounts

Point the domain's A record to the VPS IPv4 address. Publish an AAAA record only if IPv6 is configured. Allow TCP 80 and 443 in your hosting-provider firewall. Preserve your actual SSH port before enabling UFW.

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx postgresql postgresql-contrib ufw snapd git build-essential
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-setup.sh
# Inspect this vendor script before running it.
less /tmp/nodesource-setup.sh
sudo bash /tmp/nodesource-setup.sh
sudo apt install -y nodejs
node --version
npm --version
sudo timedatectl set-timezone Asia/Tehran
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo adduser --system --group --home /srv/lingua --shell /usr/sbin/nologin lingua
sudo install -d -o lingua -g lingua -m 0750 /srv/lingua/releases
sudo install -d -o root -g lingua -m 0750 /etc/lingua
```

Do not expose PostgreSQL or port 3100 publicly. Keep PostgreSQL on loopback. If other applications use PostgreSQL, do not change their authentication rules.

## 2. Database ownership and least privilege

Use separate randomly generated passwords and your password manager. `\password` avoids putting secrets in shell history.

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE lingua_owner LOGIN;
\password lingua_owner
CREATE ROLE lingua_app LOGIN;
\password lingua_app
CREATE DATABASE lingua OWNER lingua_owner;
ALTER ROLE lingua_owner IN DATABASE lingua SET timezone TO 'Asia/Tehran';
ALTER ROLE lingua_app IN DATABASE lingua SET timezone TO 'Asia/Tehran';
\connect lingua
REVOKE ALL ON DATABASE lingua FROM PUBLIC;
GRANT CONNECT ON DATABASE lingua TO lingua_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lingua_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingua_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lingua_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingua_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lingua_app;
\quit
```

Create `/etc/lingua/runtime.env` with `sudoedit`. URL-encode special characters in passwords. It contains only runtime credentials:

```dotenv
DATABASE_URL=postgresql://lingua_app:ENCODED_PASSWORD@127.0.0.1:5432/lingua
APP_ORIGIN=https://school.example.com
SCHOOL_NAME="Lingua School"
TZ=Asia/Tehran
```

Create `/etc/lingua/migration.env`, containing **only** `DIRECT_URL=postgresql://lingua_owner:ENCODED_PASSWORD@127.0.0.1:5432/lingua`. Set runtime file to `root:lingua 0640`, migration file to `root:root 0600`. Never copy migration credentials into the runtime file.

```bash
sudo chown root:lingua /etc/lingua/runtime.env
sudo chmod 0640 /etc/lingua/runtime.env
sudo chown root:root /etc/lingua/migration.env
sudo chmod 0600 /etc/lingua/migration.env
```

## 3. Install a versioned release

Transfer the complete source and lockfile to `/srv/lingua/releases/RELEASE_ID`, excluding `.env`, `node_modules`, `.next`, and test artifacts. Substitute a unique release ID below. Avoid placing secrets in source control.

```bash
sudo chown -R lingua:lingua /srv/lingua/releases/RELEASE_ID
cd /srv/lingua/releases/RELEASE_ID
sudo -u lingua npm ci
sudo -u lingua npm run build
# Read the migration diff before applying; run as owner, never as runtime role.
sudo /usr/bin/node --env-file=/etc/lingua/migration.env node_modules/prisma/build/index.js migrate deploy
```

Grant existing tables after the first migration, and restrict the audit table to append/read. The application never updates or deletes audit records.

```bash
sudo -u postgres psql -d lingua
```

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lingua_app;
REVOKE ALL ON TABLE "_prisma_migrations" FROM lingua_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditEvent" FROM lingua_app;
\quit
```

Create the first admin interactively. The same command resets an existing admin's password and invalidates its sessions; no email service is required.

```bash
sudo -u lingua /usr/bin/node --env-file=/etc/lingua/runtime.env --import tsx scripts/admin.ts
sudo ln -s /srv/lingua/releases/RELEASE_ID /srv/lingua/current
sudo install -m 0644 deploy/systemd/lingua.service /etc/systemd/system/lingua.service
sudo systemctl daemon-reload
sudo systemctl enable --now lingua
sudo systemctl status lingua --no-pager
curl --fail http://127.0.0.1:3100/api/health/ready
```

`npm ci` retains build/migration tools because this deployment builds on the VPS. Do not use `--omit=dev` before building. The Node process runs with runtime credentials only.

## 4. Nginx and HTTPS

Back up `/etc/nginx` before editing. Copy the template, replace the hostname, and enable only this new virtual host. Do not remove existing websites or replace the global Nginx configuration.

```bash
sudo cp -a /etc/nginx /etc/nginx.before-lingua
sudo install -m 0644 deploy/nginx/lingua.conf /etc/nginx/sites-available/lingua
sudoedit /etc/nginx/sites-available/lingua
sudo ln -s /etc/nginx/sites-available/lingua /etc/nginx/sites-enabled/lingua
sudo nginx -t
sudo systemctl reload nginx
curl --fail -I http://school.example.com
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx --redirect -d school.example.com
sudo nginx -t
sudo systemctl reload nginx
sudo /snap/bin/certbot renew --dry-run
systemctl list-timers --all | grep certbot
curl --fail -I https://school.example.com
```

Certbot bootstraps the certificate only after the HTTP host works. Confirm HTTP redirects to HTTPS. Student/admin authentication requires HTTPS in production because cookies are secure. Add `Strict-Transport-Security: max-age=31536000` to the HTTPS server after confirming TLS works; do not use `includeSubDomains` unless every subdomain supports HTTPS.

## 5. Add another website without conflicts

Create a separate Unix account (`portal`), release directory (`/srv/portal`), environment directory (`/etc/portal`), and database/roles. Its systemd unit must use its own account, directories, environment, and `--port 3101`. For another copy of this application, set `APP_ORIGIN=https://portal.example.com`; do not reuse the first school's database or credentials.

```bash
sudo install -m 0644 deploy/nginx/second-site.conf /etc/nginx/sites-available/portal
sudoedit /etc/nginx/sites-available/portal
sudo ln -s /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/portal
sudo nginx -t
sudo systemctl reload nginx
sudo /snap/bin/certbot --nginx --redirect -d portal.example.com
```

Nginx routes by hostname; both sites share 80/443 while their app listeners use distinct loopback ports. Confirm each hostname serves its own application. Track allocated ports in server documentation. These templates assume Nginx is the public edge; configure trusted-proxy handling separately if a CDN is introduced.

## 6. Backups, monitoring, releases, and rollback

```bash
sudo install -d -o postgres -g postgres -m 0700 /var/backups/lingua
sudo install -o root -g root -m 0755 deploy/backup.sh /usr/local/sbin/lingua-backup
sudo install -m 0644 deploy/systemd/lingua-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/lingua-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lingua-backup.timer
sudo systemctl start lingua-backup.service
sudo journalctl -u lingua-backup.service --no-pager
```

Backups contain personal data. Copy encrypted backups off the VPS using your backup provider; local backups alone do not protect against VPS loss. Configure failure alerts for the backup service and external HTTPS health monitoring. Monitor `/api/health/live`, `/api/health/ready`, disk space, certificate renewal, and `journalctl -u lingua`; the readiness endpoint reveals no database details.

Restore drill: choose an actual archive path, restore into a **new isolated database**, then verify record counts and booking relationships. Never restore over the live database as a test.

```bash
sudo -u postgres createdb lingua_restore_check
sudo -u postgres pg_restore --no-owner --no-acl --exit-on-error --dbname=lingua_restore_check /var/backups/lingua/ACTUAL_BACKUP.dump
sudo -u postgres psql -d lingua_restore_check -c 'SELECT count(*) FROM "User"; SELECT count(*) FROM "Booking"; SELECT count(*) FROM "AuditEvent";'
```

For updates: run automated checks on a disposable database, build a new release, run and verify a fresh backup, review/apply migrations using `migration.env`, then switch the `current` symlink and restart. Keep the previous release.

```bash
sudo ln -s /srv/lingua/releases/NEW_RELEASE /srv/lingua/current.next
sudo mv -Tf /srv/lingua/current.next /srv/lingua/current
sudo systemctl restart lingua
curl --fail https://school.example.com/api/health/ready
```

For application rollback, switch the symlink back and restart. Database rollback is separate: Prisma deploy does not automatically undo migrations. Use backward-compatible schema changes; a destructive migration requires a reviewed restore/recovery procedure and maintenance window. Periodically delete expired `AuthSession` and `LoginThrottle` rows as the database owner; never prune the audit log without an explicit retention policy.

## Release acceptance

- Student code login, assigned-course visibility, seat limits, booking history, and cancellation cutoff work on HTTPS.
- Revoked/replaced codes and deactivated users lose access immediately.
- Admin user/course CRUD, recurrence preview, occurrence edits, and audit timeline work.
- Jalali dates and Tehran timestamps match across devices with different local timezones.
- Nginx configuration passes; service survives a restart; renewal dry-run passes.
- A backup is restored successfully; external monitoring and off-server backups are configured.
- A second virtual host serves independently; neither app listener nor PostgreSQL is publicly exposed.

Do not claim production deployment or recovery readiness until these checks pass on the actual VPS.
