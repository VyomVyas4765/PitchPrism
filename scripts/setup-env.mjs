import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const target = new URL('../.env', import.meta.url);
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
try {
  await writeFile(target, template.replace('JWT_SECRET=\n', `JWT_SECRET=${randomBytes(48).toString('hex')}\n`)
    .replace('SEED_PASSWORD=\n', `SEED_PASSWORD=${randomBytes(24).toString('base64url')}\n`)
    .replace('PII_ENCRYPTION_KEY=\n', `PII_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`), { flag: 'wx', mode: 0o600 });
  console.log('Created private .env with random secrets. Staff seed password is SEED_PASSWORD in that file.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists; preserved without changes.');
}
