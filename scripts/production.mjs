import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const command = process.argv[2];
if (!['build', 'start'].includes(command)) throw new Error('Expected build or start.');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), command, ...process.argv.slice(3)], {
  stdio: 'inherit', env: { ...process.env, RYDR_BUILD_DIR: process.env.VERCEL ? '.next' : '.next-production' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
