# MongoDB connectivity

The API and seed read the ignored **root `.env`**, never `.env.example`. `pnpm setup:env` preserves an existing private file. Keep real database credentials out of the example/template.

Run `pnpm db:check` after saving `MONGODB_URI`. It checks SRV discovery for Atlas, TCP reachability, then an authenticated MongoDB ping. It prints safe outcomes without credentials or raw driver error messages. It does not seed or change data.

## Match the fix to the failure

- `dns_missing`: hostname/SRV has no DNS record (`ENOTFOUND`/`ENODATA`). Confirm the Atlas cluster is active and copy its current Connect → Drivers URI. Changing the password, extending timeouts, changing TLS settings or opening database ports cannot repair a nonexistent hostname.
- `dns_unreachable`: local DNS resolver fails. If permitted on your network, set `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` in root `.env`. This changes Node process DNS queries only, not the operating system/network policy. Public DNS may also be blocked and cannot create missing records or unblock database ports.
- `network`: discovery succeeded but the driver cannot reach the nodes. Check Atlas Network Access for your current public IP and the college network's database-port rules. Add only the intended address/range; do not expose the database to the whole internet to diagnose it. Use a permitted network or ask campus IT for access.
- `tls`: verify the system clock and trusted CA/network inspection settings. Certificate and hostname verification remain enabled.
- `authentication`: check the Atlas **database user**, URL-encoded password and authSource. Your Atlas website account and database user are separate.

Connections use IPv4 to avoid unsupported IPv6 routes, a pool of 10, and bounded connect/selection timeouts (`MONGODB_TIMEOUT_MS`, default 10000). The same helper is used by API startup and the seed. No driver option disables TLS and no automatic fallback changes database targets.

## Offline development alternative

Run `pnpm dev:local`. It starts real MongoDB 7.0.24 on loopback port 27017 with WiredTiger files in ignored `local/mongodb/`, seeds synthetic staff idempotently, and starts the API/dashboard. It needs no Docker or Redis; the MongoDB launcher package downloads the pinned binary only if it is not already cached. Its name includes “memory-server”, but this development mode explicitly uses a persistent database path; restart persistence was checked. Keep that folder to retain your data.

The launcher overrides `MONGODB_URI` only for its child API/seed processes and preserves your private Atlas configuration. `pnpm db:local` starts only the same database for custom workflows; stop one launcher before using the other. `pnpm db:check` still checks the URI in root `.env`; to check a running local database explicitly, use `MONGODB_URI=mongodb://127.0.0.1:27017/pitchprism pnpm db:check`.

This is a separate database and does not synchronize Atlas data. MongoDB binds to loopback, while the authenticated API can be reached from the phone on the Mac's LAN address. Redis is removed. Alternatively, run `docker compose up -d --wait mongo` and explicitly point your own API process at the local URI. The Docker volume and `local/mongodb/` are independent data stores; do not confuse them.

## Observed diagnosis · 17 October 2026

The supplied Atlas hostname returned `ENOTFOUND` from Node and NXDOMAIN from both Google and Cloudflare DNS over HTTPS. The saved root `.env` was rechecked after the update. That diagnosis occurs before any authentication or database TCP-port check, so a campus firewall is not established as the cause. A current resolvable Atlas hostname is still needed before the connection can be verified. The actual URI/credentials are deliberately omitted here.

References: [MongoDB driver connection troubleshooting](https://www.mongodb.com/docs/drivers/node/current/connect/connection-troubleshooting/), [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/), and [Node DNS](https://nodejs.org/api/dns.html).
