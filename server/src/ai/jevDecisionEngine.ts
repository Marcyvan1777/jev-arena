import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Battlefield, Decision, Side, Usage } from '../../../shared/types.js';
import { config, hasApiKey } from '../config.js';
import { PublicError } from '../errors.js';
import { AI_SETTINGS, buildQuestion } from './questions.js';
import { parseJevResponse } from './parseResponse.js';

export interface DecisionContext { signal: AbortSignal; usage: Usage; maxCalls: number }
export type DecisionEngine = (state: Battlefield, side: Side, context: DecisionContext) => Promise<Decision>;

// One logical SDK request per robot; fetch counts every HTTP attempt, including retries.
export const jevDecision: DecisionEngine = async (state, side, context) => {
  if (!hasApiKey()) throw new PublicError('Real Jev Mode requires TYPESAFE_API_KEY in the backend .env. Add it and restart the server, then Retry.', 503);
  if (context.usage.apiCalls >= context.maxCalls) throw new PublicError('Match API budget reached. Start a new match to continue.', 429);
  const prompt = buildQuestion(state, side);
  const client = new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY!.trim(), baseURL: 'https://api.typesafe.ai',
    defaultModel: config.model, timeout: config.timeoutMs, logLevel: 'off',
    retry: { maxRetries: config.retries, backoffInitialMs: 300, backoffMaxMs: 600, maxRetryAfterMs: 1000 },
    fetch: async (input, init) => {
      context.signal.throwIfAborted();
      if (context.usage.apiCalls >= context.maxCalls) throw new PublicError('Match API budget reached. Start a new match to continue.', 429);
      context.usage.apiCalls++;
      return fetch(input, init);
    },
  });
  const start = performance.now();
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(config.timeoutMs * (config.retries + 1) + 2500)]);
  try {
    const response = await client.systemOne({ state: JSON.stringify(prompt.state),
      questions: { action: choice(AI_SETTINGS.instructions, prompt.criteria) } }, { signal });
    const decision = parseJevResponse(response, prompt.legal, side, state.round + 1, Math.round(performance.now() - start));
    context.usage.completedDecisions++; context.usage.totalLatencyMs += decision.latencyMs;
    return decision;
  } catch (error) {
    if (context.signal.aborted) throw new PublicError('Turn cancelled.', 409);
    context.usage.failedDecisions++;
    if (error instanceof PublicError) throw error;
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    if (status === 401 || status === 403) throw new PublicError('Jev authentication failed. Check your server API key and account access, then Retry.', 502);
    if (status === 429) throw new PublicError('Jev rate or credit limit reached. Check your TypeSafe account, then Retry.', 502);
    if (status === 400 || status === 404 || status === 422) throw new PublicError(`Jev rejected the request (HTTP ${status}). No turn was committed; check the server integration.`, 502);
    const name = typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : '';
    if (signal.aborted || name === 'APITimeoutError') throw new PublicError('Jev timed out. No turn was committed. Retry when ready.', 502);
    if (name === 'APIConnectionError' || name === 'TypeError') throw new PublicError('Jev connection failed before a response. Check internet access, proxy or firewall rules, then Retry.', 502);
    throw new PublicError('Jev request failed before a usable decision. No turn was committed; Retry after checking the server connection.', 502);
  }
};
