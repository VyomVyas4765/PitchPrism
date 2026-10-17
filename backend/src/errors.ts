import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof ZodError || error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Check the request fields and try again.' }); return; }
  if (error?.type === 'entity.too.large') { res.status(413).json({ error: 'Request is too large.' }); return; }
  console.error('API error:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
