import { resolveSrv } from 'node:dns/promises';
import { createConnection } from 'node:net';
import mongoose from 'mongoose';
import { readConfig } from './config.js';
import { configureDatabaseDns, databaseFailure, databaseOptions } from './database.js';

const config = readConfig();
configureDatabaseDns(config);
let failures = false;
try {
  console.log('Checking saved root .env. URI and credentials are never printed.');
  if (config.MONGODB_URI.startsWith('mongodb+srv:')) {
    const host = new URL(config.MONGODB_URI).hostname;
    const records = await resolveSrv(`_mongodb._tcp.${host}`);
    console.log(`DNS SRV: OK (${records.length} nodes).`);
    const outcomes = await Promise.all(records.map(record => new Promise<boolean>(resolve => {
      const socket = createConnection({ host: record.name, port: record.port, family: 4 });
      const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(Math.min(config.MONGODB_TIMEOUT_MS, 4000));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    })));
    console.log(`TCP reachability: ${outcomes.filter(Boolean).length}/${records.length} nodes (authentication/TLS not yet checked).`);
  }
  await mongoose.connect(config.MONGODB_URI, databaseOptions(config));
  await mongoose.connection.db!.command({ ping: 1 });
  console.log('MongoDB authenticated connection and ping: OK.');
} catch (error) {
  failures = true;
  const failure = databaseFailure(error);
  console.error(`${failure.kind}: ${failure.message}`);
} finally {
  await mongoose.disconnect();
  if (failures) process.exitCode = 1;
}
