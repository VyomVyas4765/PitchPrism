import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
  // Refinement messages (code 'custom') are written for people, for example "Domain weights must add up to 100".
  if (error instanceof ZodError) { res.status(400).json({ error: error.issues.find(issue => issue.code === 'custom')?.message ?? 'Check the request fields and try again.' }); return; }
  if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Check the request fields and try again.' }); return; }
  // Contract validation in Mongoose (strict 'throw', enums, patterns) is a client error, not a server fault.
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError || error?.name === 'StrictModeError') { res.status(400).json({ error: 'Check the request fields and try again.' }); return; }
  if (error?.type === 'entity.too.large') { res.status(413).json({ error: 'Request is too large.' }); return; }
  console.error('API error:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
