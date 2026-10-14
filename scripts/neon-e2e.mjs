import { spawn } from 'node:child_process';
const child = spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/neon-storage-live.test.ts'],{stdio:'inherit',env:{...process.env,RUN_NEON_STORAGE_TESTS:'1'}});
child.on('exit',code=>{process.exitCode=code??1;});
