import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const databasePath = fileURLToPath(new URL('../../local/mongodb/', import.meta.url));
const lockPath = `${databasePath}/launcher.lock`;

export async function startLocalMongo() {
  if (process.env.NODE_ENV === 'production') throw new Error('Local development MongoDB is forbidden in production.');
  await mkdir(databasePath, { recursive: true });
  // Protect the persistent database from two launchers opening the same files.
  try {
    const old = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(old.pid) || old.pid <= 0) throw new Error('Local MongoDB lock is invalid; inspect local/mongodb/launcher.lock.');
    let alive = true;
    try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive) throw new Error('Local MongoDB is already managed by another process. Stop that launcher before restarting.');
    await unlink(lockPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();
  const mongo = new MongoMemoryServer({
    binary: { version: '7.0.24' },
    instance: { ip: '127.0.0.1', port: 27017, portGeneration: false, dbName: 'pitchprism', dbPath: databasePath, storageEngine: 'wiredTiger' },
  });
  try { await mongo.start(true); }
  catch (error) { await unlink(lockPath).catch(() => {}); throw error; }
  let stopped = false;
  return {
    uri: mongo.getUri('pitchprism'),
    async stop() {
      if (stopped) return;
      stopped = true;
      await mongo.stop({ doCleanup: false, force: false });
      await unlink(lockPath).catch(() => {});
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const database = await startLocalMongo();
  console.log('Local MongoDB ready: mongodb://127.0.0.1:27017/pitchprism');
  console.log('Persistent files: local/mongodb/. Ctrl+C stops the process without deleting data.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void database.stop().then(() => process.exit(0)); });
}
