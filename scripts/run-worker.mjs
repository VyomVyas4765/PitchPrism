// Starts the pipeline worker (python -m ai.worker) from the worker virtualenv on Windows, macOS or Linux.
// Extra arguments pass through, for example `pnpm worker -- --once`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = ['ai/.venv/Scripts/python.exe', 'ai/.venv/bin/python'].map(path => fileURLToPath(new URL(`../${path}`, import.meta.url))).find(existsSync);
if (!python) {
  console.error('No worker virtualenv found. Run `make worker-setup` (or create ai/.venv and install ai/requirements.txt) first.');
  process.exit(1);
}
const child = spawn(python, ['-m', 'ai.worker', ...process.argv.slice(2).filter(arg => arg !== '--')], { cwd: root, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
