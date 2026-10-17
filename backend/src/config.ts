import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { isIP } from 'node:net';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//, 'Use a MongoDB connection URI').default('mongodb://127.0.0.1:27017/pitchprism'),
  MONGODB_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(10000),
  MONGODB_DNS_SERVERS: z.string().default('').refine(value => !value || value.split(',').every(ip => isIP(ip.trim()) !== 0), 'Use comma-separated DNS server IP addresses'),
  JWT_SECRET: z.string().min(32, 'Set JWT_SECRET to at least 32 random characters in .env'),
  FIREBASE_PROJECT_ID: z.string().default(''),
});
export type Config = z.infer<typeof configSchema>;
export function readConfig(): Config {
  const config = configSchema.parse(process.env);
  if (config.NODE_ENV === 'production' && !config.WEB_ORIGIN.startsWith('https://')) throw new Error('Production WEB_ORIGIN must use HTTPS');
  if (config.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Firebase emulator is forbidden in production');
  return config;
}
