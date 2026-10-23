import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { testTypeOf } from '../shared/fairness.js';
import { buildQuestion } from '../server/src/ai/questions.js';
import { auditFairness, mirrorState } from '../server/src/game/fairness.js';
import { createBattle, isCombo, resolveTurn } from '../server/src/game/engine.js';

const config = { ...DEFAULT_CONFIG, mode: 'demo' as const };
describe('fairness audit', () => {
  it('passes every check for the shipped rules and prompts', () => {
    const report = auditFairness(config);
    expect(report.checks.filter(check => !check.pass)).toEqual([]); expect(report.ok).toBe(true);
  });
  it('classifies what a setup can attribute a result to', () => {
    const live = { ...DEFAULT_CONFIG, mode: 'jev' as const };
    const same = { ...live, red: { ...live.red, personality: 'TACTICIAN' as const }, blue: { ...live.blue, personality: 'TACTICIAN' as const } };
    expect(testTypeOf({ ...same, providers: { red: 'claude', blue: 'openai' } })).toBe('model-only');
    expect(testTypeOf({ ...same, blue: { ...same.blue, personality: 'COWARD' } })).toBe('personality-only');
    expect(testTypeOf({ ...live, providers: { red: 'claude', blue: 'openai' } })).toBe('model-and-personality');
    expect(testTypeOf(same)).toBe('identical');
    expect(testTypeOf({ ...live, mode: 'demo' })).toBe('personality-only');
  });
  it('would catch a prompt that leaks the corner (a raw coordinate)', () => {
    const state = createBattle(config), mirrored = mirrorState(state);
    expect(JSON.stringify(buildQuestion(state, 'red').state.self)).toEqual(JSON.stringify(buildQuestion(mirrored, 'blue').state.self));
    expect(JSON.stringify(buildQuestion(state, 'red').state)).not.toContain('"position"');
  });
});
describe('combinations', () => {
  it('reward a follow-up to a clean punch, identically for both corners, and expire after one exchange', () => {
    let landed: ReturnType<typeof resolveTurn> | null = null;
    for (let seed = 1; seed < 200 && !landed; seed++) { const next = resolveTurn(createBattle({ ...config, seed }), { red: 'JAB', blue: 'JAB' }); if (next.robots.red.combo === 'JAB' && next.robots.blue.combo === 'JAB') landed = next; }
    expect(landed).not.toBeNull();
    expect(isCombo(landed!.robots.red, 'CROSS')).toBe(true); expect(isCombo(landed!.robots.blue, 'CROSS')).toBe(true); expect(isCombo(landed!.robots.red, 'JAB')).toBe(false);
    expect(buildQuestion(landed!, 'red').state.self.comboBonusActions).toEqual(['CROSS', 'HOOK']);
    const after = resolveTurn(landed!, { red: 'GUARD', blue: 'GUARD' }); expect(after.robots.red.combo).toBeNull();
  });
});
