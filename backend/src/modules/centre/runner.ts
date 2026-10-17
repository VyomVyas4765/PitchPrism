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
}

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const localPython = fileURLToPath(new URL('../../../../ai/.venv/bin/python', import.meta.url));

export async function assessLocally(input: CentreExtractedInput): Promise<AssessmentResult> {
  const python = process.env.PITCHPRISM_PYTHON || (existsSync(localPython) ? localPython : 'python3');
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
