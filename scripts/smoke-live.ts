import 'dotenv/config';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { createBattle } from '../server/src/game/engine.js';
import { jevDecision } from '../server/src/ai/jevDecisionEngine.js';
import { SIDES } from '../shared/types.js';

if (!process.argv.includes('--confirm-paid-api')) {
  console.error('Opt-in required: npm run smoke:live -- --confirm-paid-api');
  process.exitCode = 1;
} else if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error('TYPESAFE_API_KEY is missing from the backend environment.');
  process.exitCode = 1;
} else {
  const state = createBattle(DEFAULT_CONFIG);
  const usage = { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 };
  const results = await Promise.allSettled(SIDES.map(side => jevDecision(structuredClone(state), side,
    { signal: new AbortController().signal, usage, maxCalls: 4 })));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      const d = result.value;
      console.log(SIDES[i] + ': ' + d.action + ' · model ' + (d.model ?? 'not supplied') + ' · ' + d.latencyMs + ' ms · selected probability ' + (d.selectedProbability ?? 'not supplied'));
    } else {
      const reason = result.reason;
      const safeMessage = reason instanceof Error && reason.name === 'PublicError' ? reason.message : 'Live decision failed before a safe response could be parsed.';
      console.error(SIDES[i] + ': ' + safeMessage); process.exitCode = 1;
    }
  }
  console.log('HTTP attempts: ' + usage.apiCalls + '; parsed decisions: ' + usage.completedDecisions + '/2. No keys logged.');
}
