import path from 'node:path';
import {randomUUID} from 'node:crypto';
process.env.PORT=process.env.CUTROOM_TEST_PORT || '4318';
process.env.CUTROOM_DATA_DIR=path.resolve('data', 'test-'+randomUUID());
delete process.env.OPENAI_API_KEY;
await import('../server.mjs');
try {await import('./integration.mjs');process.exit(0);}catch(error){console.error(error);process.exit(1);}
