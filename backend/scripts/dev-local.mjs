import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLocalMongo } from './local-mongo.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const database = await startLocalMongo();
const environment = { ...process.env, NODE_ENV: 'development', MONGODB_URI: database.uri, MONGODB_DNS_SERVERS: '' };
let child;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
  await database.stop();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0)); });
function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn('pnpm', args, { cwd: root, env: environment, stdio: 'inherit', detached: process.platform !== 'win32' });
    child.once('error', reject);
    child.once('exit', code => code === 0 || stopping ? resolve() : reject(new Error(`Local development command exited (${code}).`)));
  });
}
try {
  console.log('Using persistent local MongoDB; Atlas URI in root .env is preserved. Redis is not required.');
  await run(['--filter', '@pitchprism/contracts', 'build']);
  await run(['--filter', '@pitchprism/backend', 'seed']);
  if (!stopping) await run(['--parallel', '--filter', '@pitchprism/backend', '--filter', '@pitchprism/frontend', 'dev']);
} finally { await stop(); }
