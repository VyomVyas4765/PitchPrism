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

If campus policy blocks Atlas, start Docker and `docker compose up -d --wait mongo redis`, then explicitly set `MONGODB_URI=mongodb://127.0.0.1:27017/pitchprism` in root `.env`. Run `pnpm db:check`, `pnpm seed`, and `pnpm dev`. This is a separate local database; it does not synchronize Atlas data. Named Docker volumes preserve local data. Restore your private Atlas URI when returning to that database.

## Observed diagnosis · 17 October 2026

The supplied Atlas hostname returned `ENOTFOUND` from Node and NXDOMAIN from both Google and Cloudflare DNS over HTTPS. The saved root `.env` was rechecked after the update. That diagnosis occurs before any authentication or database TCP-port check, so a campus firewall is not established as the cause. A current resolvable Atlas hostname is still needed before the connection can be verified. The actual URI/credentials are deliberately omitted here.

References: [MongoDB driver connection troubleshooting](https://www.mongodb.com/docs/drivers/node/current/connect/connection-troubleshooting/), [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/), and [Node DNS](https://nodejs.org/api/dns.html).
