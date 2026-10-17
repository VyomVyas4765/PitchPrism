import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const target = new URL('../.env', import.meta.url);
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
// Secrets generated for a new .env; on an existing .env only missing ones are appended, never replaced.
const secrets = {
  JWT_SECRET: () => randomBytes(48).toString('hex'),
  SEED_PASSWORD: () => randomBytes(24).toString('base64url'),
  PII_ENCRYPTION_KEY: () => randomBytes(32).toString('hex'),
};
let existing;
try { existing = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing === undefined) {
  let text = template;
  for (const [key, make] of Object.entries(secrets)) text = text.replace(`${key}=\n`, `${key}=${make()}\n`);
  await writeFile(target, text, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env with random secrets. Staff seed password is SEED_PASSWORD in that file.');
} else {
  const missing = Object.keys(secrets).filter(key => !new RegExp(`^${key}=.+`, 'm').test(existing));
  if (missing.length === 0) { console.log('.env already has every generated secret; preserved without changes.'); process.exit(0); }
  const lines = missing.map(key => `${key}=${secrets[key]()}`);
  await writeFile(target, `${existing.replace(/\n?$/, '\n')}${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`.env preserved; added missing ${missing.join(', ')}. Compare the rest with .env.example yourself.`);
}
