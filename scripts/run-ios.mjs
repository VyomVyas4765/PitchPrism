import { spawn, execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('iOS device builds require macOS and Xcode.');
const { values } = parseArgs({ options: {
  device: { type: 'string' }, 'api-url': { type: 'string' }, mode: { type: 'string' },
  'offline-demo': { type: 'boolean' },
} });
const mode = values.mode ?? 'profile';
if (!['debug', 'profile', 'release'].includes(mode)) throw new Error('Use --mode debug, profile or release.');
const offlineDemo = values['offline-demo'] ?? false;
if (offlineDemo && values['api-url']) throw new Error('Use either --offline-demo or --api-url.');
const address = networkInterfaces().en0?.find(value => value.family === 'IPv4' && !value.internal)?.address;
// The offline build points real sign-in at the phone's unused loopback port; the demo adapter never calls it.
const endpoint = offlineDemo ? 'https://127.0.0.1:1/api/v1' :
  (values['api-url'] ?? process.env.API_BASE_URL ?? (mode === 'debug' && address ? `http://${address}:4000/api/v1` : undefined));
if (!endpoint) throw new Error(mode === 'debug'
  ? 'No Wi-Fi address found. Pass --api-url with a reachable API endpoint.'
  : 'Home Screen launches need a Profile/Release build and a reachable HTTPS API. Pass --api-url https://YOUR_API_HOST/api/v1.');
const url = new URL(endpoint);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
  throw new Error('Use an HTTP(S) API URL without credentials or a fragment.');
}
if (mode !== 'debug' && url.protocol !== 'https:') {
  throw new Error('Profile and Release use the standard iOS transport policy. Pass an HTTPS API URL or use --mode debug for local HTTP.');
}
let deviceId = values.device;
if (!deviceId) {
  const { stdout } = await promisify(execFile)('flutter', ['devices', '--machine', '--device-timeout', '30'], { maxBuffer: 1024 * 1024 });
  const devices = JSON.parse(stdout).filter(device => device.targetPlatform === 'ios' && !device.emulator);
  if (devices.length !== 1) throw new Error('Connect one paired iPhone or pass --device with its flutter devices identifier.');
  deviceId = devices[0].id;
}
console.log(offlineDemo
  ? `Building ${mode} offline demo for iPhone. Real sign-in and submissions are unavailable in this build.`
  : `Building ${mode} for iPhone with API ${url.origin}${url.pathname}.`);
if (mode === 'debug') console.log('Debug builds must be started by Flutter or Xcode each time; use Profile with HTTPS to reopen from the Home Screen.');
const child = spawn('flutter', ['run', `--${mode}`, '-d', deviceId, `--dart-define=API_BASE_URL=${endpoint}`], {
  cwd: fileURLToPath(new URL('../app/', import.meta.url)),
  env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  stdio: 'inherit',
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
