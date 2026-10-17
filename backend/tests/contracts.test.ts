import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { COLLECTIONS, domainSchema, type EntityName } from '@pitchprism/contracts';
import { ALL_MODELS } from '../src/models/index.js';
import { contactHasher, isPlaceholderContact, normaliseContact, sameDigest } from '../src/crypto.js';

// The contract bundle, the generated Mongoose models and the published fixtures must agree (D-03).
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
const fixtures: Record<string, Record<string, unknown>[]> = JSON.parse(
  await readFile(new URL('../../packages/contracts/fixtures/synthetic.json', import.meta.url), 'utf8'));
const entityFor = Object.fromEntries(Object.entries(COLLECTIONS).map(([entity, collection]) => [collection, entity as EntityName]));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('objectid', /^[a-f\d]{24}$/i);
ajv.addSchema(domainSchema);
const check = (entity: string, doc: unknown) => {
  const valid = ajv.validate({ $ref: `${domainSchema.$id}#/definitions/${entity}` }, doc);
  return valid ? [] : (ajv.errors ?? []).map(error => `${error.instancePath} ${error.message}`);
};
const withoutId = ({ _id, ...doc }: Record<string, unknown>) => doc;

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(ALL_MODELS.map(model => model.init()));
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

describe('domain contracts', () => {
  it('has a model and fixtures for every contract collection', () => {
    const modelCollections = new Set(ALL_MODELS.map(model => model.collection.collectionName));
    for (const collection of Object.values(COLLECTIONS)) {
      expect(modelCollections, collection).toContain(collection);
      expect(fixtures[collection]?.length ?? 0, `fixtures for ${collection}`).toBeGreaterThan(0);
    }
  });
  it('validates every published fixture against its JSON Schema', () => {
    for (const [collection, docs] of Object.entries(fixtures)) {
      if (collection.startsWith('_')) continue;
      const entity = entityFor[collection];
      expect(entity, `known collection ${collection}`).toBeDefined();
      for (const doc of docs) expect(check(entity!, withoutId(doc)), `${collection} ${String(doc._id ?? '')}`).toEqual([]);
    }
  });
  it('stores every published fixture through its Mongoose model', async () => {
    for (const [collection, docs] of Object.entries(fixtures)) {
      if (collection.startsWith('_')) continue;
      const model = mongoose.model(entityFor[collection]!);
      await model.deleteMany({});
      await expect(model.insertMany(docs), collection).resolves.toHaveLength(docs.length);
    }
    const stored = await mongoose.model('Submission').findById('655000000000000000000001').lean<Record<string, any>>();
    expect(stored?.ownerOrgId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(stored?.fields?.offering?.segIds).toEqual(['s_0001']);
  });
  it('rejects fields outside the contract on both sides', async () => {
    expect(check('StageEvent', { ...withoutId(fixtures.stageEvents![0]!), prompt: 'leaked' })).not.toEqual([]);
    await expect(mongoose.model('StageEvent').create({ ...fixtures.stageEvents![0]!, prompt: 'leaked' })).rejects.toThrow();
    expect(check('Submission', { ...withoutId(fixtures.submissions![0]!), unknownField: { name: 'x' } })).not.toEqual([]);
    await expect(mongoose.model('Submission').create({ ...withoutId(fixtures.submissions![0]!), unknownField: { name: 'x' } })).rejects.toThrow();
  });
  it('enforces contract enums and identifiers in the database models', async () => {
    const event = withoutId(fixtures.stageEvents![0]!);
    await expect(mongoose.model('StageEvent').create({ ...event, stage: 'bogus' })).rejects.toThrow();
    await expect(mongoose.model('Job').create({ ...withoutId(fixtures.jobs![0]!), ownerOrgId: 'not-an-id' })).rejects.toThrow();
  });
  it('creates the stage-event collection capped for tailing (D-26)', async () => {
    expect(await mongoose.connection.db!.collection(COLLECTIONS.StageEvent).isCapped()).toBe(true);
  });
});

describe('contact matching', () => {
  const hash = contactHasher('ab'.repeat(32))!;
  it('needs a valid PII_ENCRYPTION_KEY', () => {
    expect(contactHasher('')).toBeNull();
    expect(contactHasher('not-hex')).toBeNull();
  });
  it('hashes contacts after normalisation so formatting does not hide duplicates', () => {
    expect(normaliseContact('+91 98765-43210', 'phone')).toBe('9876543210');
    expect(hash('+91 98765 43210', 'phone')).toBe(hash('9876543210', 'phone'));
    expect(hash(' Person@Example.COM ', 'email')).toBe(hash('person@example.com', 'email'));
    expect(hash('9876543210', 'phone')).not.toBe(hash('9876543210', 'email'));
    expect(hash('9876543210', 'phone')).not.toBe(contactHasher('cd'.repeat(32))!('9876543210', 'phone'));
  });
  it('recognises placeholder contacts so they never link people as duplicates', () => {
    expect(isPlaceholderContact('9000000080', 'phone')).toBe(true);
    expect(isPlaceholderContact('student80@demo.com', 'email')).toBe(true);
    expect(isPlaceholderContact('9876501234', 'phone')).toBe(false);
  });
  it('compares digests in constant time and rejects length mismatches', () => {
    expect(sameDigest('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
    expect(sameDigest('ab'.repeat(32), 'ab'.repeat(31))).toBe(false);
  });
});
