import type { MatchConfig } from './types.js';

/** What a match setup can actually attribute a result to. */
export type TestType = 'identical' | 'model-only' | 'personality-only' | 'model-and-personality';

export interface FairnessCheck { id: string; label: string; pass: boolean; detail: string }
export interface FairnessReport { ok: boolean; testType: TestType; differs: { model: boolean; personality: boolean }; checks: FairnessCheck[]; note: string }

/** The two corners differ in the AI model when providers differ (Demo Mode means both corners run the same local bot). */
export function differences(config: MatchConfig) {
  const providers = config.mode === 'demo' ? { red: 'demo', blue: 'demo' } : config.providers;
  return { model: providers.red !== providers.blue, personality: config.red.personality !== config.blue.personality };
}

export function testTypeOf(config: MatchConfig): TestType {
  const d = differences(config);
  return d.model && d.personality ? 'model-and-personality' : d.model ? 'model-only' : d.personality ? 'personality-only' : 'identical';
}

export const TEST_TYPE_NOTES: Record<TestType, string> = {
  'model-only': 'Same personality, different model: a result can be attributed to the model.',
  'personality-only': 'Same model, different personality: a result can be attributed to the personality.',
  'model-and-personality': 'Model and personality both differ: a result cannot be attributed to either one alone.',
  identical: 'Identical setups: any gap is luck. Use it to see how noisy the game is.',
};
