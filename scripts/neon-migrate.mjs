import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error('DATABASE_URL_UNPOOLED is required for migrations.');
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
try {
 await client.connect();
 await client.query('BEGIN');
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('rydr-schema-migrations',0))");
 await client.query('CREATE TABLE IF NOT EXISTS rydr_schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
 for (const file of (await fs.readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  const applied = await client.query('SELECT version FROM rydr_schema_migrations WHERE version=$1',[file]);
  if (applied.rowCount) { console.log('Already applied '+file); continue; }
  await client.query(await fs.readFile(path.join('migrations',file),'utf8'));
  await client.query('INSERT INTO rydr_schema_migrations(version) VALUES($1)',[file]);
  console.log('Applied '+file);
 }
 await client.query('COMMIT');
 console.log('Neon schema ready. Credentials were not printed.');
} catch (error) {
 await client.query('ROLLBACK').catch(()=>undefined);
 console.error('Migration failed: '+(error.code ?? error.name)); process.exitCode=1;
} finally { await client.end(); }
