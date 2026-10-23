import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { MatchConfig } from '../../../shared/types.js';
import { TEST_TYPE_NOTES, differences, testTypeOf } from '../../../shared/fairness.js';
import type { FairnessReport, TestType } from '../../../shared/fairness.js';
import { api } from '../api.js';
import { Icon } from './Icon.js';
import './fairness.css';

const TITLES: Record<TestType, string> = { 'model-only': 'MODEL-ONLY TEST', 'personality-only': 'PERSONALITY-ONLY TEST', 'model-and-personality': 'MODEL + PERSONALITY (MIXED)', identical: 'IDENTICAL SETUPS' };

/** Shows the evidence that both corners are judged on the same base, and which single factor the current setup varies. */
export function FairnessPanel({ config, setConfig, disabled }: { config: MatchConfig; setConfig: Dispatch<SetStateAction<MatchConfig>>; disabled: boolean }) {
  const [report, setReport] = useState<FairnessReport | null>(null), [failed, setFailed] = useState(false);
  const { mode, providers, red, blue, maxRounds } = config;
  useEffect(() => {
    const timer = window.setTimeout(() => { api.fairness(config).then(next => { setReport(next); setFailed(false); }).catch(() => setFailed(true)); }, 350);
    return () => window.clearTimeout(timer);
    // The audit only depends on the setup, not on the seed or names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, providers.red, providers.blue, red.personality, blue.personality, maxRounds]);
  // The test type is pure arithmetic on the setup, so it updates instantly; the server audit fills in the evidence below.
  const type = testTypeOf(config), differs = differences(config), mixed = type === 'model-and-personality';
  return <section className={'panel fairness-panel' + (report && !report.ok ? ' broken' : '')} aria-label="Fairness audit">
    <div className="panel-heading"><span><Icon name="shield" size={15} /> FAIRNESS AUDIT</span><span className={'micro fairness-type ' + type}>{TITLES[type]}</span></div>
    <div className="fairness-body">
      <p className="fairness-note">{TEST_TYPE_NOTES[type]}</p>
      {!report && <p className="fairness-note">{failed ? 'Backend offline: start it to run the audit.' : 'Running the audit…'}</p>}
      <ul>{report?.checks.map(check => <li key={check.id} className={check.pass ? 'pass' : 'fail'} title={check.detail}><b>{check.pass ? '✓' : '✗'}</b><span>{check.label}</span><small>{check.detail}</small></li>)}</ul>
      <div className="fairness-actions">
        <button className="secondary-button" disabled={disabled || !differs.personality} onClick={() => setConfig(c => ({ ...c, blue: { ...c.blue, personality: c.red.personality } }))}>SAME PERSONALITY</button>
        <button className="secondary-button" disabled={disabled || config.mode === 'demo' || !differs.model} onClick={() => setConfig(c => ({ ...c, providers: { ...c.providers, blue: c.providers.red }, blue: { ...c.blue, name: c.red.name } }))}>SAME MODEL</button>
      </div>
      {mixed && <p className="fairness-warning">Both the model and the personality differ, so a winner cannot be credited to either. Make one identical to isolate the other.</p>}
    </div>
  </section>;
}
