import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { DocumentChunk, PitchDocument } from './intake-models.js';

// Private original storage (A-01): a GridFS bucket in the same database, so no extra service or
// public URL exists. Only the API reads it, after its own scope checks.
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: 'originals' });

/** Appends a chunk only at the expected offset; returns the new received byte count or null on a mismatch. */
export async function appendChunk(documentId: mongoose.Types.ObjectId, offset: number, data: Buffer, total: number) {
  if (offset + data.length > total) return null;
  const updated = await PitchDocument.findOneAndUpdate(
    { _id: documentId, state: 'receiving', receivedBytes: offset },
    { $inc: { receivedBytes: data.length } },
    { returnDocument: 'after' },
  );
  if (!updated) return null;
  try {
    await DocumentChunk.create({ documentId, offset, data });
  } catch (error) {
    await PitchDocument.updateOne({ _id: documentId }, { $inc: { receivedBytes: -data.length } });
    throw error;
  }
  return updated.receivedBytes;
}

/** Verifies size and sha256, then stores the original once. A mismatch rejects the document. */
export async function finalise(documentId: mongoose.Types.ObjectId) {
  const document = await PitchDocument.findById(documentId);
  if (!document || document.state !== 'receiving' || document.receivedBytes !== document.bytes) return document;
  const chunks = await DocumentChunk.find({ documentId }).sort({ offset: 1 }).lean();
  const content = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data.buffer ?? chunk.data)));
  const hash = createHash('sha256').update(content).digest('hex');
  if (content.length !== document.bytes || hash !== document.sha256) {
    document.state = 'rejected';
  } else {
    const upload = bucket().openUploadStream(String(document._id), { metadata: { documentId: document._id, sha256: hash, kind: document.kind } });
    await new Promise<void>((resolve, reject) => { upload.once('finish', () => resolve()).once('error', reject).end(content); });
    document.storageId = upload.id as mongoose.Types.ObjectId;
    document.state = 'complete';
    document.completedAt = new Date();
  }
  await document.save();
  await DocumentChunk.deleteMany({ documentId });
  return document;
}

/** Stores small server-built originals (typed answers) with the same immutability and hash. */
export async function storeOriginal(name: string, content: Buffer, metadata: Record<string, unknown>) {
  const upload = bucket().openUploadStream(name, { metadata: { ...metadata, sha256: createHash('sha256').update(content).digest('hex') } });
  await new Promise<void>((resolve, reject) => { upload.once('finish', () => resolve()).once('error', reject).end(content); });
  return upload.id as mongoose.Types.ObjectId;
}

export async function readOriginal(storageId: mongoose.Types.ObjectId) {
  const parts: Buffer[] = [];
  for await (const part of bucket().openDownloadStream(storageId)) parts.push(part as Buffer);
  return Buffer.concat(parts);
}
