import mongoose from 'mongoose';
import { z } from 'zod';
import { readConfig } from './config.js';
import { Org, User } from './models.js';
import { hashPassword } from './auth/password.js';
import type { Role, OrgType } from '@pitchprism/contracts';
import { connectDatabase } from './database.js';
const config = readConfig();
if (config.NODE_ENV === 'production') throw new Error('Development seed is forbidden in production');
const password = z.string().min(12).max(128).parse(process.env.SEED_PASSWORD);
const definitions: { type: OrgType; roles: Role[] }[] = [
  { type: 'hq', roles: ['hq_admin'] }, { type: 'centre', roles: ['centre_assessor', 'cohort_lead', 'facilitator'] },
  { type: 'implementation_partner', roles: ['implementation_partner'] }, { type: 'sector_partner', roles: ['sector_partner'] },
  { type: 'funding_partner', roles: ['funding_partner'] },
];
await connectDatabase(config);
try {
  await Promise.all([Org.init(), User.init()]);
  const passwordHash = await hashPassword(password);
  for (const definition of definitions) {
    const org = await Org.findOneAndUpdate({ name: `Demo ${definition.type}` }, { $setOnInsert: { type: definition.type, active: true, ...(definition.type === 'funding_partner' ? { fundingMode: 'lender' } : {}) } }, { upsert: true, returnDocument: 'after' });
    for (const role of definition.roles) {
      const email = `${role}@pitchprism.test`;
      // Reruns do not overwrite credentials, permissions, or disabled status on existing users.
      await User.updateOne({ email }, { $setOnInsert: { email, displayName: `Demo ${role.replaceAll('_', ' ')}`, role, orgId: org!._id, passwordHash } }, { upsert: true, runValidators: true });
      console.log(email);
    }
  }
  console.log('Synthetic staff accounts ready. Entrepreneur accounts are created after verified Firebase phone sign-in.');
} finally { await mongoose.disconnect(); }
