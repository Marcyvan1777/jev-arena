import type { Action, Decision, Side } from '../../../shared/types.js';
import { AI_SETTINGS } from './questions.js';
import { IllegalMoveError } from '../errors.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const invalid = (attempted = 'an unreadable response') => new IllegalMoveError('Jev returned an invalid response.', attempted);
export function parseJevResponse(raw: unknown, legal: Action[], robot: Side, round: number, latencyMs: number): Decision {
  if (!isRecord(raw) || !isRecord(raw.answers) || !isRecord(raw.answers.action)) throw invalid();
  const answer = raw.answers.action;
  if (answer.type !== 'choice' || typeof answer.choice !== 'string') throw invalid();
  if (!legal.includes(answer.choice as Action)) throw new IllegalMoveError('Jev selected an illegal action.', answer.choice);
  if (raw.model !== undefined && typeof raw.model !== 'string') throw invalid();
  let probabilities: Partial<Record<Action, number>> | undefined;
  if (answer.probabilities !== undefined) {
    if (!isRecord(answer.probabilities)) throw invalid();
    const entries = Object.entries(answer.probabilities);
    if (entries.length !== legal.length || entries.some(([a, p]) => !legal.includes(a as Action) ||
      typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1)) throw invalid();
    const values = entries as [Action, number][];
    if (Math.abs(values.reduce((sum, [, p]) => sum + p, 0) - 1) > AI_SETTINGS.probabilitySumTolerance)
      throw new IllegalMoveError('Jev returned an invalid probability distribution.', String(answer.choice));
    probabilities = Object.fromEntries(values);
  }
  return { robot, action: answer.choice as Action, source: 'jev', round, latencyMs,
    legalActions: [...legal], probabilities, selectedProbability: probabilities?.[answer.choice as Action],
    model: raw.model as string | undefined };
}
