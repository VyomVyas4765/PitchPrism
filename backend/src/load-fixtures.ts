import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { z } from 'zod';
import { COLLECTIONS } from '@pitchprism/contracts';
import { readConfig } from './config.js';
import { connectDatabase } from './database.js';
import { dataCrypto } from './crypto.js';
import { hashPassword } from './auth/password.js';
import { ALL_MODELS } from './models.js';

// Development only: loads packages/contracts/fixtures/synthetic.json so every role has realistic records to
// work against (pnpm fixtures:load). Upserts by _id, so reruns refresh the fixtures without touching other data.
// Fixture staff sign in with SEED_PASSWORD. The applicant's personal fields are re-encrypted with this
// environment's DATA_ENCRYPTION_KEY, because the fixture file carries placeholder ciphertext only.
const config = readConfig();
if (config.NODE_ENV === 'production') throw new Error('Fixture loading is forbidden in production');
const password = z.string().min(12).max(128).parse(process.env.SEED_PASSWORD);
const crypto = dataCrypto(config.DATA_ENCRYPTION_KEY);
const fixtures: Record<string, Record<string, unknown>[]> = JSON.parse(
  await readFile(new URL('../../packages/contracts/fixtures/synthetic.json', import.meta.url), 'utf8'));
const entityFor = Object.fromEntries(Object.entries(COLLECTIONS).map(([entity, collection]) => [collection, entity]));
const SYNTHETIC_PERSON = { name: 'Synthetic Applicant', phone: '+910000000123' };

await connectDatabase(config);
try {
  await Promise.all(ALL_MODELS.map(model => model.init()));
  const passwordHash = await hashPassword(password);
  for (const [collection, docs] of Object.entries(fixtures)) {
    if (collection.startsWith('_')) continue;
    const model = mongoose.model(entityFor[collection]!);
    if (collection === COLLECTIONS.StageEvent) {
      // Capped and insert-only: add the replay once per job.
      const jobIds = [...new Set(docs.map(doc => String(doc.jobId)))];
      const fresh = await model.countDocuments({ jobId: { $in: jobIds } }) === 0;
      if (fresh) await model.insertMany(docs);
      console.log(`${collection}: ${fresh ? docs.length : 'already present'}`);
      continue;
    }
    for (const fixture of docs) {
      const doc: Record<string, unknown> = { ...fixture };
      if (collection === COLLECTIONS.User && doc.email) doc.passwordHash = passwordHash;
      if (collection === COLLECTIONS.Entrepreneur) {
        doc.nameEnc = crypto.encrypt(SYNTHETIC_PERSON.name, 'entrepreneur.name');
        doc.phoneEnc = crypto.encrypt(SYNTHETIC_PERSON.phone, 'entrepreneur.phone');
        doc.contactHashes = [crypto.contactHash(SYNTHETIC_PERSON.phone, 'phone')];
      }
      const hydrated = new model(doc);
      await hydrated.validate();
      await model.replaceOne({ _id: hydrated._id }, hydrated.toObject({ depopulate: true }), { upsert: true });
    }
    console.log(`${collection}: ${docs.length}`);
  }
  console.log('Synthetic fixtures loaded. Fixture staff emails start with "fixture."; they use SEED_PASSWORD.');
} finally { await mongoose.disconnect(); }
