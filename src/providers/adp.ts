import { randomUUID, createHash } from 'node:crypto';
import type { AgentInvocation, AgentProvider, AgentResult } from './types';
import { ProviderError } from './types';
import { reserveProviderAttempt } from '../repositories/providerBudget';
import { currentStorageSession } from '../repositories/store';

function makeConversationId(runId: string, role: string): string {
  return createHash('sha256').update(`${runId}:${role}`).digest('hex').slice(0, 32);
}

function appKeyForRole(role: string): string | undefined {
  switch (role) {
    case 'rider':
      return process.env.RYDR_ADP_RIDER_APPKEY;
    case 'driver':
      return process.env.RYDR_ADP_DRIVER_APPKEY;
    case 'judge':
      return process.env.RYDR_ADP_JUDGE_APPKEY;
    case 'navigator':
      return process.env.RYDR_ADP_NAVIGATOR_APPKEY;
    case 'vision':
      return process.env.RYDR_ADP_VISION_APPKEY;
    default:
      return undefined;
  }
}

async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event?: string; data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent: string | undefined;
      let currentData: string | undefined;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          currentData = trimmed.slice(5).trim();
        } else if (trimmed === '' && currentData !== undefined) {
          yield { event: currentEvent, data: currentData };
          currentEvent = undefined;
          currentData = undefined;
        }
      }
    }

    if (buffer.trim()) {
      const lines = buffer.split('\n');
      let currentEvent: string | undefined;
      let currentData: string | undefined;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          currentData = trimmed.slice(5).trim();
        } else if (trimmed === '' && currentData !== undefined) {
          yield { event: currentEvent, data: currentData };
          currentEvent = undefined;
          currentData = undefined;
        }
      }
      if (currentData !== undefined) {
        yield { event: currentEvent, data: currentData };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractReplyText(completedEvent: unknown): string | null {
  if (typeof completedEvent !== 'object' || completedEvent === null) return null;
  const resp = (completedEvent as Record<string, unknown>).Response;
  if (typeof resp !== 'object' || resp === null) return null;
  const messages = (resp as Record<string, unknown>).Messages;
  if (!Array.isArray(messages)) return null;

  for (const msg of messages) {
    if (typeof msg !== 'object' || msg === null) continue;
    if ((msg as Record<string, unknown>).Type !== 'reply') continue;
    const contents = (msg as Record<string, unknown>).Contents;
    if (!Array.isArray(contents) || contents.length === 0) continue;
    const first = contents[0];
    if (typeof first !== 'object' || first === null) continue;
    const text = (first as Record<string, unknown>).Text;
    if (typeof text === 'string') return text;
  }
  return null;
}

function extractTokenStats(
  completedEvent: unknown,
): { inputTokens?: number; outputTokens?: number; totalTokens?: number } {
  if (typeof completedEvent !== 'object' || completedEvent === null) return {};
  const resp = (completedEvent as Record<string, unknown>).Response;
  if (typeof resp !== 'object' || resp === null) return {};
  const statInfo = (resp as Record<string, unknown>).StatInfo;
  if (typeof statInfo !== 'object' || statInfo === null) return {};

  const result: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  const inputTokens = (statInfo as Record<string, unknown>).InputTokens;
  const outputTokens = (statInfo as Record<string, unknown>).OutputTokens;
  const totalTokens = (statInfo as Record<string, unknown>).TotalTokens;

  if (typeof inputTokens === 'number') result.inputTokens = inputTokens;
  if (typeof outputTokens === 'number') result.outputTokens = outputTokens;
  if (typeof totalTokens === 'number') result.totalTokens = totalTokens;

  return result;
}

/**
 * Aggressively extract JSON from a model response that may contain prose,
 * markdown fences, or other wrappers.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // 1. Try the whole text directly
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // 2. Strip markdown fences and try
  const fenceRe = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const fenceMatch = trimmed.match(fenceRe);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* continue */ }
  }

  // 3. Look for a JSON object anywhere in the text
  const objectRe = /(\{[\s\S]*\})/;
  const objectMatch = text.match(objectRe);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[1]);
    } catch { /* continue */ }
  }

  // 4. Look for a JSON array anywhere in the text
  const arrayRe = /(\[[\s\S]*\])/;
  const arrayMatch = text.match(arrayRe);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[1]);
    } catch { /* continue */ }
  }

  throw new Error('No valid JSON found in response');
}

export function createAdpProvider(endpoint: string): AgentProvider {
  return {
    id: 'adp',
    capabilities: { nativeTools: false, strictJson: false, parallelCalls: true },
    external: true,

    async invoke(request: AgentInvocation): Promise<AgentResult> {
      const appKey = appKeyForRole(request.role);
      if (!appKey) {
        throw new ProviderError(
          `No AppKey configured for role "${request.role}". Check RYDR_ADP_${request.role.toUpperCase()}_APPKEY.`,
          'unavailable',
        );
      }

      const requestId = randomUUID();
      if (!await reserveProviderAttempt()) throw new ProviderError('The shared daily AI allowance has been reached. Use sample assessment or return after the UTC daily reset.', 'cap_exhausted');
      const visitor = createHash('sha256').update(`${await currentStorageSession() ?? 'local'}:${request.role}`).digest('hex').slice(0,32);
      const conversationId = makeConversationId(`${visitor}:${request.runId}`, request.stage === 'assess_risk' ? `${request.role}:risk` : request.role);

      const body = {
        RequestId: requestId,
        ConversationId: conversationId,
        AppKey: appKey,
        VisitorId: visitor,
        UserId: visitor,
        Contents: [
          {
            Type: 'text',
            Text: JSON.stringify(request.input),
          },
          ...(request.imageUrls ?? []).map(url => ({Type:'image',Image:{Url:url}})),
        ],
        SystemRole: request.systemInstruction,
        Incremental: false,
        Stream: 'enable',
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ProviderError(`ADP request timed out after ${request.timeoutMs}ms`, 'timeout');
        }
        throw new ProviderError(
          `ADP transport error: ${err instanceof Error ? err.message : String(err)}`,
          'transport',
        );
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ProviderError(`ADP HTTP ${response.status}: ${text.slice(0, 200)}`, 'transport');
      }

      if (!response.body) {
        throw new ProviderError('ADP response has no body', 'transport');
      }

      let completedEvent: unknown = null;
      let streamText = '';

      try {
        for await (const sse of parseSse(response.body)) {
          if (!sse.data) continue;
          if (sse.data === '[DONE]') break;

          let parsed: unknown;
          try {
            parsed = JSON.parse(sse.data);
          } catch {
            continue;
          }

          const type = (parsed as Record<string, unknown>)?.Type;

          if (type === 'text.delta') {
            const text = (parsed as Record<string, unknown>).Text;
            if (typeof text === 'string') streamText += text;
          } else if (type === 'text.replace') {
            const text = (parsed as Record<string, unknown>).Text;
            if (typeof text === 'string') streamText = text;
          } else if (type === 'response.completed') {
            completedEvent = parsed;
          }

          if (sse.event === 'done' || type === 'done') {
            break;
          }
        }
      } catch (err) {
        throw new ProviderError(
          `ADP stream error: ${err instanceof Error ? err.message : String(err)}`,
          'transport',
        );
      }

      const replyText = extractReplyText(completedEvent) || streamText || null;

      if (!replyText) {
        throw new ProviderError('ADP response contained no reply text', 'invalid_output');
      }

      let output: unknown;
      try {
        output = extractJson(replyText);
      } catch (err) {
        throw new ProviderError(
          `ADP output is not valid JSON: ${err instanceof Error ? err.message : String(err)}. Raw: ${replyText.slice(0, 500)}`,
          'invalid_output',
        );
      }

      const stats = extractTokenStats(completedEvent);

      return {
        output,
        providerRequestId: requestId,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
      };
    },
  };
}
