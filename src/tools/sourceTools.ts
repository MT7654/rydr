import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fingerprint } from '../lib/hash';
import {
  SOURCE_TOOL_VERSION,
  SourceResultSchema,
  type SourceRequest,
  type SourceResult,
  type SourceStatus,
  type SourceToolId,
} from '../domain/collection';

/**
 * The allowlisted source adapters.
 *
 * Each tool takes a validated trip id and a bounded window and reads a
 * **simulated** fixture. There is deliberately no tool that accepts a URL, a SQL
 * string or a filesystem path: a plan can only name one of the four ids, so a
 * compromised or over-eager planner cannot reach anything else.
 *
 * The fixtures live in `fixtures/sources/` and are separate from the case
 * fixtures on purpose — they describe what a platform source system would
 * return, and none of them contains an expected ruling. A source read cannot
 * "know the answer"; it can only supply a record.
 */

const SOURCES_DIR = path.join(process.cwd(), 'fixtures', 'sources');

interface SourceFixtureTool {
  status?: SourceStatus;
  recordIds?: string[];
  note?: string;
  [key: string]: unknown;
}

interface SourceFixture {
  tripId?: string;
  sourceType?: string;
  note?: string;
  tools?: Record<string, SourceFixtureTool>;
}

export function sourceFixturePath(tripId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(tripId)) throw new Error('Invalid trip source identifier.');
  return path.join(SOURCES_DIR, `${tripId}.json`);
}

async function readFixture(tripId: string): Promise<SourceFixture | null> {
  try {
    const raw = await fs.readFile(sourceFixturePath(tripId), 'utf8');
    return JSON.parse(raw) as SourceFixture;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Reads one allowlisted source.
 *
 * A missing fixture is `unavailable`, not an error: a real integration would
 * have exactly this case, and the honest answer is that the record could not be
 * retrieved — never a fabricated one.
 */
export async function readSource(request: SourceRequest): Promise<SourceResult> {
  const fixture = await readFixture(request.tripId);
  const tool = fixture?.tools?.[request.tool] as SourceFixtureTool | undefined;

  if (!fixture || !tool) {
    return SourceResultSchema.parse({
      requestId: request.id,
      tool: request.tool,
      toolVersion: SOURCE_TOOL_VERSION,
      sourceType: 'simulated',
      status: 'unavailable',
      sourceRecordIds: [],
      retrievedAt: new Date().toISOString(),
      tripId: request.tripId,
      payloadHash: fingerprint({ tripId: request.tripId, tool: request.tool, missing: true }),
      evidenceIds: [],
      note: `The simulated ${request.tool} source holds no record for trip ${request.tripId}.`,
      payload: null,
    });
  }

  const { status: rawStatus, recordIds, note, ...payload } = tool;
  const status: SourceStatus = rawStatus ?? 'found';

  return SourceResultSchema.parse({
    requestId: request.id,
    tool: request.tool,
    toolVersion: SOURCE_TOOL_VERSION,
    sourceType: 'simulated',
    status,
    sourceRecordIds: recordIds ?? [],
    retrievedAt: new Date().toISOString(),
    tripId: request.tripId,
    payloadHash: fingerprint({ tripId: request.tripId, tool: request.tool, payload }),
    evidenceIds: [],
    note:
      note ??
      (status === 'found'
        ? `Simulated ${request.tool} returned ${(recordIds ?? []).length} record(s).`
        : `Simulated ${request.tool} reported "${status}" for trip ${request.tripId}.`),
    payload,
  });
}

/** The tool ids a source fixture can answer, for diagnostics and tests. */
export async function availableSourceTools(tripId: string): Promise<SourceToolId[]> {
  const fixture = await readFixture(tripId);
  if (!fixture?.tools) return [];
  return Object.keys(fixture.tools) as SourceToolId[];
}
