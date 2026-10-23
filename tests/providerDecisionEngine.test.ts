import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { externalDecision } from '../server/src/ai/providerDecisionEngine.js';
import { createBattle } from '../server/src/game/engine.js';

const context = () => ({ signal: new AbortController().signal, maxCalls: 8, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('OpenAI and Claude decision adapters', () => {
  it('uses an OpenAI structured action without inventing probabilities', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'gpt-test', output_text: '{\"action\":\"JAB\"}' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', transport);
    const ctx = context(), decision = await externalDecision('openai')(createBattle(DEFAULT_CONFIG), 'red', ctx);
    expect(decision.source).toBe('openai'); expect(decision.action).toBe('JAB'); expect(decision.probabilities).toBeUndefined();
    expect(ctx.usage.apiCalls).toBe(1); expect(transport.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
  });
  it('uses a Claude action from its text content', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'claude-test', content: [{ type: 'text', text: '{\"action\":\"GUARD\"}' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', transport);
    const ctx = context(), decision = await externalDecision('claude')(createBattle(DEFAULT_CONFIG), 'blue', ctx);
    expect(decision.source).toBe('claude'); expect(decision.action).toBe('GUARD'); expect(decision.probabilities).toBeUndefined();
    expect(ctx.usage.apiCalls).toBe(1); expect(transport.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });
  it('rejects an illegal provider action without committing it', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: '{\"action\":\"FLY\"}' }), { status: 200 })));
    await expect(externalDecision('openai')(createBattle(DEFAULT_CONFIG), 'red', context())).rejects.toThrow('illegal boxing action');
  });
});

describe('provider adapters are fair and robust', () => {
  it('reads the OpenAI action from the raw REST output array, not only the SDK output_text helper', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const body = { model: 'gpt-test', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"action":"CROSS"}' }] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
    expect((await externalDecision('openai')(createBattle(DEFAULT_CONFIG), 'red', context())).action).toBe('CROSS');
  });
  it('forces Claude to answer through a legal-action tool call', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'claude-test', content: [{ type: 'tool_use', name: 'choose_action', input: { action: 'SLIP' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', transport);
    const decision = await externalDecision('claude')(createBattle(DEFAULT_CONFIG), 'blue', context());
    expect(decision.action).toBe('SLIP');
    const sent = JSON.parse(transport.mock.calls[0][1].body);
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'choose_action' });
    expect(sent.tools[0].input_schema.properties.action.enum).toContain('GUARD');
    expect(sent.tools[0].strict).toBe(true); expect(sent.tools[0].input_schema.additionalProperties).toBe(false);
  });
  it('shows OpenAI and Claude the same instructions, state and legal-action descriptions', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key'); vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const transport = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('openai')
      ? { output_text: '{"action":"GUARD"}' } : { content: [{ type: 'tool_use', input: { action: 'GUARD' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', transport);
    const state = createBattle(DEFAULT_CONFIG);
    await externalDecision('openai')(state, 'red', context()); await externalDecision('claude')(state, 'red', context());
    const [openai, claude] = transport.mock.calls.map(call => JSON.parse(call[1].body));
    expect(openai.input[0].content).toBe(claude.system);
    expect(openai.input[1].content).toBe(claude.messages[0].content);
    expect(claude.system).toContain('boxing rounds');
  });
  it('accepts a code-fenced JSON answer from a text-only reply', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Sure!\n```json\n{"action":"JAB"}\n```' }] }), { status: 200 })));
    expect((await externalDecision('claude')(createBattle(DEFAULT_CONFIG), 'red', context())).action).toBe('JAB');
  });
});
