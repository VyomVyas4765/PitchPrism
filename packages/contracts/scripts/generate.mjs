import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
const schema = JSON.parse(await readFile(new URL('../schemas/session-user.json', import.meta.url), 'utf8'));
await writeFile(new URL('../src/generated.ts', import.meta.url), await compile(schema, 'SessionUser'));
await writeFile(new URL('../src/roles.ts', import.meta.url), `// Generated from schemas/session-user.json. Do not edit.\nexport const ROLES = ${JSON.stringify(schema.definitions.Role.enum)} as const;\nexport const ORG_TYPES = ${JSON.stringify(schema.definitions.OrgType.enum)} as const;\n`);
