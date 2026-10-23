import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { createBattle, legalActions } from '../server/src/game/engine.js';
import { buildQuestion } from '../server/src/ai/questions.js';
import { parseJevResponse } from '../server/src/ai/parseResponse.js';
import { jevDecision } from '../server/src/ai/jevDecisionEngine.js';

const valid = { model: 'jev-test', answers: { action: { type: 'choice', choice: 'GUARD', confidence: 0.1, probabilities: { GUARD: 0.65, JAB: 0.35 } } } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('Jev contract', () => {
  it('uses selected probability, never SDK confidence or a win estimate', () => {
    const d = parseJevResponse(valid, ['GUARD', 'JAB'], 'red', 1, 32);
    expect(d.selectedProbability).toBe(0.65); expect(d.latencyMs).toBe(32);
    expect(d).not.toHaveProperty('confidence'); expect(d).not.toHaveProperty('winProbability');
  });
  it('preserves missing probabilities without inventing numbers', () => {
    const d = parseJevResponse({ answers: { action: { type: 'choice', choice: 'GUARD' } } }, ['GUARD'], 'red', 1, 2);
    expect(d.probabilities).toBeUndefined(); expect(d.selectedProbability).toBeUndefined();
  });
  it.each([
    { answers: { action: { type: 'choice', choice: 'FLY' } } },
    { answers: { action: { type: 'choice', choice: 'GUARD', probabilities: { GUARD: 1.5, JAB: -0.5 } } } },
    { answers: { action: { type: 'choice', choice: 'GUARD', probabilities: { GUARD: 0.2, JAB: 0.2 } } } },
    { answers: { action: { type: 'choice', choice: 'GUARD', probabilities: { GUARD: 1 } } } },
    { choices: { action: { choice: 'BLOCK' } } },
  ])('rejects malformed, legacy or illegal SDK answers', raw => {
    expect(() => parseJevResponse(raw, ['GUARD', 'JAB'], 'red', 1, 1)).toThrow();
  });
  it('includes personality, history, cover and only legal choices', () => {
    const state = createBattle(DEFAULT_CONFIG); state.robots.blue.history = ['GUARD', 'JAB'];
    const prompt = buildQuestion(state, 'red');
    expect(Object.keys(prompt.criteria)).toEqual(legalActions(state, 'red'));
    expect(prompt.state.recentOpponentActions).toEqual(['GUARD', 'JAB']);
    expect(prompt.state.personality.length).toBeGreaterThan(50);
    expect(prompt.state.punchRange).toBeGreaterThan(0);
  });
  it('fails clearly when the backend key is missing and never falls back', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    await expect(jevDecision(createBattle(DEFAULT_CONFIG), 'red', context())).rejects.toThrow('TYPESAFE_API_KEY');
  });
  it('sanitizes provider errors rather than exposing their content', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key-not-a-secret');
    vi.spyOn(TypeSafeClient.prototype, 'systemOne').mockRejectedValueOnce({ status: 401, message: 'do-not-expose-provider-body' });
    await expect(jevDecision(createBattle(DEFAULT_CONFIG), 'blue', context())).rejects.toThrow('authentication failed');
  });
  it('parses an official SDK response without making a network call', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key-not-a-secret');
    const state = createBattle(DEFAULT_CONFIG), legal = legalActions(state, 'red');
    const raw = { model: 'jev-test', answers: { action: { type: 'choice' as const, choice: 'GUARD', confidence: 1,
      probabilities: Object.fromEntries(legal.map(a => [a, a === 'GUARD' ? 1 : 0])) } }, usage: { input_tokens: 10, output_tokens: 5 } };
    vi.spyOn(TypeSafeClient.prototype, 'systemOne').mockResolvedValueOnce(raw as never);
    const ctx = context(); const d = await jevDecision(state, 'red', ctx);
    expect(d.source).toBe('jev'); expect(d.action).toBe('GUARD'); expect(ctx.usage.completedDecisions).toBe(1);
  });
  it('counts actual HTTP attempts, including the SDK bounded retry', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key-not-a-secret');
    const state = createBattle(DEFAULT_CONFIG), legal = legalActions(state, 'red');
    const raw = { model: 'jev-test', answers: { action: { type: 'choice', choice: 'GUARD', confidence: 1,
      probabilities: Object.fromEntries(legal.map(a => [a, a === 'GUARD' ? 1 : 0])) } }, usage: { input_tokens: 10, output_tokens: 5 } };
    const transport = vi.fn().mockResolvedValueOnce(new Response('{"error":"temporary"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(raw), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', transport);
    const ctx = context(); const d = await jevDecision(state, 'red', ctx);
    expect(d.action).toBe('GUARD'); expect(ctx.usage.apiCalls).toBe(2); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not send a request after exhausting the match budget', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key-not-a-secret');
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    const ctx = context(); ctx.usage.apiCalls = ctx.maxCalls;
    await expect(jevDecision(createBattle(DEFAULT_CONFIG), 'red', ctx)).rejects.toThrow('budget');
    expect(transport).not.toHaveBeenCalled();
  });
});
function context() { return { signal: new AbortController().signal, maxCalls: 8, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 } }; }
