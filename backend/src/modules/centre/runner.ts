import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CentreExtractedInput } from '@pitchprism/contracts';

export interface AssessmentResult {
  status: 'assessed' | 'pending_model';
  evaluation?: Record<string, unknown>;
  quality?: Record<string, unknown>;
  financialChecks?: unknown[];
  followUps?: unknown[];
  planDraft?: Record<string, unknown>;
  reason?: string;
  metrics?: { model: string; durationMs: number; inputTokens: number; outputTokens: number; calls: number };
}

export interface PdfAssessment { input: CentreExtractedInput; assessment: AssessmentResult }
export type PdfAssessmentErrorCode = 'unsupported_pdf' | 'invalid_evidence' | 'worker_unavailable';
export type PdfExtractionCode = 'invalid_pdf' | 'page_layout' | 'name_missing' | 'question_mismatch' |
  'answer_unreadable' | 'address_risk' | 'redaction_failed';
export class PdfAssessmentError extends Error {
  constructor(public code: PdfAssessmentErrorCode, public extractionCode?: PdfExtractionCode) { super(code); }
}

const root = fileURLToPath(new URL('../../../../', import.meta.url));
// POSIX and Windows virtualenv layouts.
const localPythons = ['../../../../ai/.venv/bin/python', '../../../../ai/.venv/Scripts/python.exe']
  .map(path => fileURLToPath(new URL(path, import.meta.url)));

export async function assessLocally(input: CentreExtractedInput): Promise<AssessmentResult> {
  const python = process.env.PITCHPRISM_PYTHON || localPythons.find(path => existsSync(path)) || (process.platform === 'win32' ? 'python' : 'python3');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'ai.intel.cli'], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'], timeout: 135000 });
    let output = '';
    let tooLarge = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024 * 1024) { tooLarge = true; child.kill(); }
    });
    child.on('error', () => reject(new Error('Local assessment worker could not start.')));
    child.on('close', code => {
      if (tooLarge || code !== 0) { reject(new Error('Extracted evidence was rejected or the local worker failed.')); return; }
      try {
        const result = JSON.parse(output) as AssessmentResult;
        if (!['assessed', 'pending_model'].includes(result.status)) throw new Error();
        resolve(result);
      } catch { reject(new Error('Local assessment worker returned an invalid result.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

export async function assessPdfWithGroq(pdf: Buffer, district: string, applicantName: string,
                                        documentId: string): Promise<PdfAssessment> {
  const python = process.env.PITCHPRISM_PYTHON || localPythons.find(path => existsSync(path)) || (process.platform === 'win32' ? 'python' : 'python3');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'ai.intel.pdf_cli'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000 });
    let output = '';
    let diagnostic = '';
    let tooLarge = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024 * 1024) { tooLarge = true; child.kill(); }
    });
    child.stderr.on('data', chunk => { if (diagnostic.length < 1024) diagnostic += chunk.slice(0, 1024 - diagnostic.length); });
    child.on('error', () => reject(new PdfAssessmentError('worker_unavailable')));
    child.on('close', code => {
      if (tooLarge || code !== 0) {
        let kind: PdfAssessmentErrorCode = 'worker_unavailable';
        let extractionCode: PdfExtractionCode | undefined;
        try {
          const report = JSON.parse(diagnostic) as { status?: string; code?: string };
          const status = report.status;
          if (status === 'unsupported_pdf' || status === 'invalid_evidence') kind = status;
          if (status === 'unsupported_pdf' && ['invalid_pdf', 'page_layout', 'name_missing', 'question_mismatch',
            'answer_unreadable', 'address_risk', 'redaction_failed'].includes(report.code ?? ''))
            extractionCode = report.code as PdfExtractionCode;
        } catch { /* Diagnostics never include the applicant document or provider response. */ }
        reject(new PdfAssessmentError(kind, extractionCode)); return;
      }
      try {
        const result = JSON.parse(output) as PdfAssessment;
        if (!result.input || !['assessed', 'pending_model'].includes(result.assessment?.status)) throw new Error();
        resolve(result);
      } catch { reject(new PdfAssessmentError('worker_unavailable')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ pdfBase64: pdf.toString('base64'), district, applicantName, documentId }));
  });
}
