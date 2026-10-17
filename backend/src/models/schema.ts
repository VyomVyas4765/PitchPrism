import { Schema, type IndexDefinition, type IndexOptions, type SchemaOptions } from 'mongoose';
import { COLLECTIONS, domainSchema, type EntityName } from '@pitchprism/contracts';
import { tenancyPlugin } from '../platform/tenancy.js';

// Builds Mongoose schemas from the generated contract bundle so database models cannot drift from
// packages/contracts (D-03). Only the JSON Schema subset used by schemas/domain is supported; anything
// else fails loudly at startup instead of being stored unvalidated.
type Json = Record<string, any>;
const definitions = domainSchema.definitions as Record<string, Json>;

function resolve(node: Json): Json {
  if (!node.$ref) return node;
  const target = definitions[String(node.$ref).replace('#/definitions/', '')];
  if (!target) throw new Error(`Contract reference ${node.$ref} is missing`);
  return resolve(target);
}

function path(raw: Json, required: boolean, where: string): any {
  const node = resolve(raw);
  if (node.anyOf) {
    const options = (node.anyOf as Json[]).map(resolve).filter(option => option.type !== 'null');
    if (options.length !== 1) return { type: Schema.Types.Mixed };
    return path(options[0]!, false, where);
  }
  const extra: Json = {};
  if (required) extra.required = true;
  if (raw.default !== undefined || node.default !== undefined) extra.default = raw.default ?? node.default;
  switch (node.type) {
    case 'string': {
      if (node.format === 'objectid') return { type: Schema.Types.ObjectId, ...extra };
      if (node.format === 'date-time') return { type: Date, ...extra };
      if (node.enum) extra.enum = node.enum;
      if (node.pattern) extra.match = new RegExp(node.pattern);
      if (node.maxLength !== undefined) extra.maxlength = node.maxLength;
      if (node.minLength !== undefined) extra.minlength = node.minLength;
      return { type: String, ...extra };
    }
    case 'integer':
    case 'number': {
      if (node.enum) extra.enum = node.enum;
      if (node.minimum !== undefined) extra.min = node.minimum;
      if (node.maximum !== undefined) extra.max = node.maximum;
      if (node.type === 'integer') extra.validate = { validator: (value: unknown) => value == null || Number.isInteger(value), message: `${where} must be a whole number` };
      return { type: Number, ...extra };
    }
    case 'boolean': return { type: Boolean, ...extra };
    case 'array': {
      // Mongoose arrays default to [] and its `required` rejects empty arrays, which the contracts allow
      // (a missing field cites no segments). Array presence and minItems stay with JSON Schema validation.
      const { required: _required, ...rest } = extra;
      return { type: [path(node.items ?? {}, false, `${where}[]`)], ...rest };
    }
    case 'object': {
      // Embedded objects get no _id unless the contract declares one (for example Submission.shares entries).
      if (node.properties) return { type: new Schema(paths(node, where), { _id: '_id' in node.properties, strict: 'throw' }), ...extra };
      if (node.additionalProperties && typeof node.additionalProperties === 'object') return { type: Map, of: path(node.additionalProperties, false, `${where}{}`), ...extra };
      return { type: Schema.Types.Mixed, ...extra };
    }
    case undefined: return { type: Schema.Types.Mixed, ...extra };
    default: throw new Error(`Unsupported contract type ${node.type} at ${where}`);
  }
}

function paths(node: Json, where: string): Json {
  const required = new Set<string>(node.required ?? []);
  const out: Json = {};
  for (const [name, child] of Object.entries(node.properties as Json)) {
    if (name === 'createdAt' || name === 'updatedAt') continue; // Mongoose timestamps own these.
    if (name === '_id') continue; // Mongoose generates declared sub-document IDs.
    out[name] = path(child, required.has(name), `${where}.${name}`);
  }
  return out;
}

export interface ModelSpec {
  /** Extra Mongoose path options merged over the contract (for example select: false, lowercase, unique). */
  overrides?: Record<string, Json>;
  indexes?: [IndexDefinition, IndexOptions?][];
  options?: SchemaOptions;
  /** Holds applicant or submission data: in-request queries must declare a tenant scope (platform/tenancy.ts). */
  tenant?: boolean;
}

export function contractSchema(name: EntityName, spec: ModelSpec = {}) {
  const contract = definitions[name];
  if (!contract) throw new Error(`No contract named ${name}`);
  const definition = paths(contract, name);
  for (const [field, extra] of Object.entries(spec.overrides ?? {})) {
    if (!definition[field]) throw new Error(`Override for unknown field ${name}.${field}`);
    definition[field] = { ...definition[field], ...extra };
  }
  const hasTimestamps = 'createdAt' in (contract.properties ?? {});
  const schema = new Schema(definition, { collection: COLLECTIONS[name], strict: 'throw', timestamps: hasTimestamps, ...spec.options });
  for (const [fields, options] of spec.indexes ?? []) schema.index(fields, options);
  if (spec.tenant) schema.plugin(tenancyPlugin);
  return schema;
}
