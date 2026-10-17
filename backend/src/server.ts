import mongoose from 'mongoose';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { connectDatabase } from './database.js';
const config = readConfig();
await connectDatabase(config);
const server = createApp(config).listen(config.PORT, () => { console.log(`PitchPrism API: http://localhost:${config.PORT}/api/v1`); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => { void mongoose.disconnect().then(() => process.exit(0)); });
});
