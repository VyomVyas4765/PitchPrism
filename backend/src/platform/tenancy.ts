import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import type { Schema } from 'mongoose';

// Tenancy guard (PRD section 19, "No unscoped queries"). Inside an HTTP request, every query on a tenant
// collection must declare its access scope:
//   Model.find(filter).setOptions({ tenant: submissionScope(req.auth!) })   // scope is added with $and
//   Model.find(filter).setOptions({ tenant: 'system' })                     // deliberate cross-tenant read
// Scope is combined with $and, so a route filter can never overwrite it. Queries outside a request
// (worker, seed, scripts, direct test calls) are system work and are not checked.
// Modes: 'enforce' refuses unscoped in-request queries; 'warn' logs each unscoped call site once (default
// while role modules adopt the option); 'off' disables the check.
export type TenancyMode = 'enforce' | 'warn' | 'off';
let mode: TenancyMode = 'warn';
export function setTenancyMode(next: TenancyMode) { mode = next; }

interface RequestScope { route: string }
const context = new AsyncLocalStorage<RequestScope>();
export const tenancyContext: RequestHandler = (req, _res, next) => {
  context.run({ route: `${req.method} ${req.baseUrl}${req.path}`.replace(/[a-f\d]{24}/gi, ':id') }, next);
};

/**
 * Run an already-authorised helper as system work (outside request scope), for example a consent check in
 * another module. The caller must have checked access first; prefer setOptions({ tenant }) for your own queries.
 */
export function asSystem<T>(fn: () => Promise<T>): Promise<T> { return context.exit(fn); }

export class UnscopedQueryError extends Error {
  constructor(collection: string, route: string) { super(`Unscoped query on ${collection} during ${route}`); this.name = 'UnscopedQueryError'; }
}
const warned = new Set<string>();
function check(tenant: unknown, collection: string) {
  const request = context.getStore();
  if (!request || mode === 'off' || tenant === 'system' || (tenant && typeof tenant === 'object')) return;
  if (mode === 'enforce') throw new UnscopedQueryError(collection, request.route);
  const key = `${collection} ${request.route}`;
  if (!warned.has(key)) { warned.add(key); console.warn(`tenancy: unscoped query on ${collection} during ${request.route}; add setOptions({ tenant })`); }
}

const QUERY_OPS = ['find', 'findOne', 'countDocuments', 'distinct', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany'] as const;

export function tenancyPlugin(schema: Schema) {
  for (const op of QUERY_OPS) {
    schema.pre(op, function () {
      const tenant = this.getOptions().tenant as unknown;
      check(tenant, this.model.collection.collectionName);
      if (tenant && typeof tenant === 'object') this.and([tenant as Record<string, unknown>]);
    });
  }
  schema.pre('aggregate', function () {
    const tenant = (this.options as { tenant?: unknown }).tenant;
    check(tenant, this.model().collection.collectionName);
    if (tenant && typeof tenant === 'object') this.pipeline().unshift({ $match: tenant as Record<string, unknown> });
  });
}
