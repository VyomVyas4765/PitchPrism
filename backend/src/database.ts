import mongoose from 'mongoose';
import { setServers } from 'node:dns/promises';
import type { Config } from './config.js';

export type DatabaseFailureKind = 'dns_missing' | 'dns_unreachable' | 'authentication' | 'tls' | 'network' | 'configuration' | 'unknown';
export interface DatabaseFailure { kind: DatabaseFailureKind; message: string }

// Never expose raw driver errors: they can contain the URI or authentication details.
export function databaseFailure(error: unknown): DatabaseFailure {
  const codes = new Set<string>();
  const names: string[] = [];
  const messages: string[] = [];
  const seen = new Set<unknown>();
  function inspect(value: unknown, depth = 0) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) return;
    seen.add(value);
    const item = value as Record<string, unknown>;
    if (typeof item.code === 'string' || typeof item.code === 'number') codes.add(String(item.code));
    if (typeof item.name === 'string') names.push(item.name);
    if (typeof item.message === 'string') messages.push(item.message);
    for (const key of ['cause', 'reason', 'error']) inspect(item[key], depth + 1);
    if (item.servers instanceof Map) for (const server of item.servers.values()) inspect(server, depth + 1);
  }
  inspect(error);
  if (codes.has('ENOTFOUND') || codes.has('ENODATA')) return { kind: 'dns_missing', message: 'MongoDB hostname/SRV record was not found. Check that the Atlas cluster is active and copy its current Connect → Drivers URI into the saved root .env. This is a DNS failure, before authentication or a database-port test.' };
  if (codes.has('ECONNREFUSED') && messages.some(message => /querySrv|queryTxt/.test(message)) || codes.has('ESERVFAIL') || codes.has('ETIMEOUT')) return { kind: 'dns_unreachable', message: 'MongoDB DNS lookup failed. If your network permits it, configure MONGODB_DNS_SERVERS with a working resolver; this affects process DNS only. It cannot unblock a database port.' };
  if (codes.has('18') || messages.some(message => /authentication failed|bad auth/i.test(message))) return { kind: 'authentication', message: 'MongoDB rejected authentication. Check the Atlas database user, URL-encoded password, and authSource in root .env.' };
  if (messages.some(message => /certificate|TLS|SSL/i.test(message))) return { kind: 'tls', message: 'MongoDB TLS verification failed. Check the system clock and trusted certificates/network inspection. Certificate verification remains enabled.' };
  if (names.includes('MongoParseError')) return { kind: 'configuration', message: 'MongoDB connection URI is invalid. Copy the current driver URI from Atlas into root .env.' };
  if (names.some(name => /ServerSelection|Network/.test(name)) || ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH'].some(code => codes.has(code))) return { kind: 'network', message: 'MongoDB could not be reached over IPv4. Check the Atlas IP access list and whether the network permits the cluster database ports. Use local MongoDB for offline development or ask the network administrator; TLS/access checks have not been weakened.' };
  return { kind: 'unknown', message: 'MongoDB connection failed. Run pnpm db:check for redacted DNS, network and authentication diagnostics.' };
}

export function configureDatabaseDns(config: Config) {
  if (config.MONGODB_DNS_SERVERS) setServers(config.MONGODB_DNS_SERVERS.split(',').map(ip => ip.trim()));
}
export function databaseOptions(config: Config): mongoose.ConnectOptions {
  return { family: 4, serverSelectionTimeoutMS: config.MONGODB_TIMEOUT_MS, connectTimeoutMS: config.MONGODB_TIMEOUT_MS, maxPoolSize: 10 };
}
export async function connectDatabase(config: Config) {
  configureDatabaseDns(config);
  try { await mongoose.connect(config.MONGODB_URI, databaseOptions(config)); }
  catch (error) { throw new Error(databaseFailure(error).message); }
}
