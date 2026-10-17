import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/config.js';
import { databaseFailure, databaseOptions } from '../src/database.js';

describe('database connection policy', () => {
  it('uses IPv4 and bounded timeouts without weakening TLS', () => {
    const config = configSchema.parse({ JWT_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: 'y'.repeat(40), MONGODB_TIMEOUT_MS: '2000' });
    expect(databaseOptions(config)).toEqual({ family: 4, serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000, maxPoolSize: 10 });
    expect(databaseOptions(config).tlsAllowInvalidCertificates).toBeUndefined();
  });
  it('validates resolver addresses and connection URI scheme', () => {
    expect(configSchema.safeParse({ JWT_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: 'y'.repeat(40), MONGODB_DNS_SERVERS: '1.1.1.1,8.8.8.8' }).success).toBe(true);
    expect(configSchema.safeParse({ JWT_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: 'y'.repeat(40), MONGODB_DNS_SERVERS: 'https://dns.example' }).success).toBe(false);
    expect(configSchema.safeParse({ JWT_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: 'y'.repeat(40), MONGODB_URI: 'https://example.test' }).success).toBe(false);
  });
  it.each([
    [{ code: 'ENOTFOUND' }, 'dns_missing'],
    [{ cause: { code: 'ENODATA' } }, 'dns_missing'],
    [{ code: 'ESERVFAIL' }, 'dns_unreachable'],
    [{ code: 18, message: 'authentication failed' }, 'authentication'],
    [{ message: 'certificate has expired' }, 'tls'],
    [{ name: 'MongoServerSelectionError', reason: { servers: new Map([['host', { error: { code: 'ETIMEDOUT' } }]]) } }, 'network'],
    [{ name: 'MongoParseError' }, 'configuration'],
  ])('reports an actionable safe category', (error, expected) => {
    expect(databaseFailure(error).kind).toBe(expected);
  });
  it('never repeats raw connection secrets in diagnostics', () => {
    const result = databaseFailure(new Error('Failed mongodb+srv://private-user:private-password@private-host/db'));
    expect(JSON.stringify(result)).not.toMatch(/private-user|private-password|private-host/);
  });
});
