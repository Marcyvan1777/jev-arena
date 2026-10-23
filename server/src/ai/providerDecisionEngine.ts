import type { Action, Battlefield, Decision, Provider, Side } from '../../../shared/types.js';
import { config, hasClaudeKey, hasOpenAiKey } from '../config.js';
import { IllegalMoveError, PublicError } from '../errors.js';
import { AI_SETTINGS, buildQuestion } from './questions.js';
import type { DecisionContext, DecisionEngine } from './jevDecisionEngine.js';

const nameOf = (provider: Provider) => provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : provider === 'jev' ? 'Jev' : 'Demo';
// Every provider receives the same instructions, the same state snapshot and the same legal-action descriptions
// that Jev receives, so a tournament compares the models and not the prompts.
const instruction = AI_SETTINGS.instructions + ' Answer with exactly one legal action and no explanation.';
const signalFor = (context: DecisionContext) => AbortSignal.any([context.signal, AbortSignal.timeout(config.timeoutMs)]);
const actionOf = (value: unknown, legal: Action[]) => typeof value === 'string' && legal.includes(value as Action) ? value as Action : null;
function count(context: DecisionContext) { if (context.usage.apiCalls >= context.maxCalls) throw new PublicError('Match API budget reached. Start a new match to continue.', 429); context.usage.apiCalls++; }
function rejected(provider: Provider, response: Response): never {
  const label = nameOf(provider);
  if (response.status === 401 || response.status === 403) throw new PublicError(label + ' authentication failed. Check the backend API key and account access.', 502);
  if (response.status === 429) throw new PublicError(label + ' rate or credit limit reached. No turn was committed.', 502);
  throw new PublicError(label + ' rejected the decision request (HTTP ' + response.status + '). No turn was committed.', 502);
}
function complete(provider: 'openai' | 'claude', state: Battlefield, side: Side, action: Action, legal: Action[], model: string, start: number, context: DecisionContext): Decision {
  const latencyMs = Math.round(performance.now() - start); context.usage.completedDecisions++; context.usage.totalLatencyMs += latencyMs;
  return { robot: side, action, source: provider, round: state.round + 1, latencyMs, model, legalActions: legal };
}
/** Models sometimes wrap JSON in a code fence or add a sentence around it; accept the first JSON object found. */
function actionFromText(text: string | undefined): unknown {
  const body = (text ?? '').replace(/```(?:json)?/gi, ' ');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try { return (JSON.parse(body.slice(start, end + 1)) as { action?: unknown }).action; } catch { return undefined; }
}
const userMessage = (built: ReturnType<typeof buildQuestion>) =>
  'STATE: ' + JSON.stringify(built.state) + '\nLEGAL ACTIONS:\n' + Object.entries(built.criteria).map(([action, text]) => '- ' + action + ': ' + text).join('\n');

async function openAi(state: Battlefield, side: Side, context: DecisionContext): Promise<Decision> {
  if (!hasOpenAiKey()) throw new PublicError('OpenAI requires OPENAI_API_KEY in the backend .env, then a server restart.', 503);
  const built = buildQuestion(state, side), start = performance.now(); count(context);
  const schema = { type: 'object', properties: { action: { type: 'string', enum: built.legal } }, required: ['action'], additionalProperties: false };
  const body = { model: config.openaiModel, input: [{ role: 'system', content: instruction }, { role: 'user', content: userMessage(built) }], text: { format: { type: 'json_schema', name: 'boxing_action', strict: true, schema } }, max_output_tokens: 64 };
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: signalFor(context), headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY!.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) rejected('openai', response);
  // The raw REST response carries the text under output[].content[]; `output_text` only exists as an SDK convenience.
  const data = await response.json() as { output_text?: string; model?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  const text = data.output_text ?? data.output?.flatMap(item => item.content ?? []).find(part => part.type === 'output_text')?.text;
  const said = actionFromText(text), action = actionOf(said, built.legal); if (!action) throw new IllegalMoveError('OpenAI returned an illegal boxing action.', String(said ?? 'no action'));
  return complete('openai', state, side, action, built.legal, data.model || config.openaiModel, start, context);
}
async function claude(state: Battlefield, side: Side, context: DecisionContext): Promise<Decision> {
  if (!hasClaudeKey()) throw new PublicError('Claude requires ANTHROPIC_API_KEY in the backend .env, then a server restart.', 503);
  const built = buildQuestion(state, side), start = performance.now(); count(context);
  // A forced tool call whose input schema is the legal-action enum. `strict: true` makes the API enforce that schema, exactly as OpenAI's
  // strict JSON schema does for GPT; without it Claude sometimes answered outside the enum (e.g. a punch on cooldown), which is an
  // unfair handicap in a head-to-head comparison.
  const tool = { name: 'choose_action', description: 'Choose your single boxing action for this exchange.', strict: true, input_schema: { type: 'object', properties: { action: { type: 'string', enum: built.legal } }, required: ['action'], additionalProperties: false } };
  const body = { model: config.claudeModel, max_tokens: 128, system: instruction, tools: [tool], tool_choice: { type: 'tool', name: 'choose_action' }, messages: [{ role: 'user', content: userMessage(built) }] };
  const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: signalFor(context), headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) rejected('claude', response);
  const data = await response.json() as { model?: string; content?: Array<{ type?: string; text?: string; input?: { action?: unknown } }> };
  const fromTool = data.content?.find(block => block.type === 'tool_use')?.input?.action;
  const said = fromTool ?? actionFromText(data.content?.find(block => block.type === 'text')?.text), action = actionOf(said, built.legal);
  if (!action) throw new IllegalMoveError('Claude returned an illegal boxing action.', String(said ?? 'no action'));
  return complete('claude', state, side, action, built.legal, data.model || config.claudeModel, start, context);
}
export const externalDecision = (provider: Provider): DecisionEngine => async (state, side, context) => {
  try { if (provider === 'openai') return await openAi(state, side, context); if (provider === 'claude') return await claude(state, side, context); throw new PublicError('Unsupported external provider.', 400); }
  catch (error) { if (error instanceof PublicError) throw error; if (context.signal.aborted) throw new PublicError('Turn cancelled.', 409); if (error instanceof DOMException && error.name === 'TimeoutError') throw new PublicError(nameOf(provider) + ' timed out. No turn was committed.', 502); throw new PublicError(nameOf(provider) + ' connection failed before a decision. Check connectivity and Retry.', 502); }
};
