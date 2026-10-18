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
const adminEmail = z.email().parse(process.env.SEED_ADMIN_EMAIL || 'hq_admin@pitchprism.test').toLowerCase();
// Staff normally join by invitation (W-01). Per-role demo staff are an explicit, development-only opt-in.
const demoStaff = process.env.SEED_DEMO_STAFF === 'true';
const demo: { type: OrgType; roles: Role[] }[] = [
  { type: 'centre', roles: ['centre_assessor', 'cohort_lead', 'facilitator'] },
  { type: 'implementation_partner', roles: ['implementation_partner'] }, { type: 'sector_partner', roles: ['sector_partner'] },
  { type: 'funding_partner', roles: ['funding_partner'] },
];
await connectDatabase(config);
try {
  await Promise.all([Org.init(), User.init()]);
  const passwordHash = await hashPassword(password);
  // Reruns reuse the existing HQ and never overwrite credentials, roles or disabled status.
  const hq = await Org.findOne({ type: 'hq' }) ?? await Org.create({ name: 'Tata STRIVE HQ', type: 'hq' });
  await User.updateOne({ email: adminEmail }, { $setOnInsert: { email: adminEmail, displayName: 'HQ administrator', role: 'hq_admin', orgId: hq._id, passwordHash } },
    { upsert: true, runValidators: true });
  // Entrepreneurs pick a centre to apply to (Q-08), so a fresh database needs at least one active centre.
  await Org.findOneAndUpdate({ type: 'centre', name: 'Tata STRIVE Demo Centre' }, { $setOnInsert: { type: 'centre', name: 'Tata STRIVE Demo Centre', active: true, parentOrgId: hq._id } }, { upsert: true });
  console.log(`Bootstrap HQ admin: ${adminEmail}. Invite every other staff member from the dashboard.`);
  if (demoStaff) {
    let centreId: mongoose.Types.ObjectId | undefined;
    for (const definition of demo) {
      const parentOrgId = definition.type === 'implementation_partner' ? centreId : hq._id;
      const org = await Org.findOneAndUpdate({ name: `Demo ${definition.type}` }, { $setOnInsert: { type: definition.type, active: true, parentOrgId,
        ...(definition.type === 'funding_partner' ? { fundingMode: 'lender' } : {}) } }, { upsert: true, returnDocument: 'after' });
      if (definition.type === 'centre') centreId = org!._id;
      for (const role of definition.roles) {
        const email = `${role}@pitchprism.test`;
        await User.updateOne({ email }, { $setOnInsert: { email, displayName: `Demo ${role.replaceAll('_', ' ')}`, role, orgId: org!._id, passwordHash } }, { upsert: true, runValidators: true });
        console.log(email);
      }
    }
    console.log('SEED_DEMO_STAFF=true: synthetic demo staff ready (development only).');
  }
  console.log('Entrepreneurs create their own accounts with email and password in the app.');
} finally { await mongoose.disconnect(); }
