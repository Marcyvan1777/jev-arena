import type { Battlefield, Decision, Side } from '../../../shared/types.js';
import { Icon } from './Icon.js';
import './decisions.css';

const pretty = (action: string) => action.replaceAll('_', ' ');

function DecisionCard({ state, side, pending }: { state: Battlefield | null; side: Side; pending: boolean }) {
  const decision: Decision | undefined = state?.decisions.filter(value => value.robot === side).at(-1), robot = state?.robots[side];
  const brain = !decision ? 'WAITING' : decision.source === 'demo' ? 'LOCAL RULE-BASED BOT' : 'LIVE · ' + decision.source.toUpperCase();
  const chosen = decision?.selectedProbability === undefined ? null : decision.selectedProbability;
  const bars = decision?.probabilities ? Object.entries(decision.probabilities).sort(([, a], [, b]) => (b ?? 0) - (a ?? 0)).slice(0, 5) : [];
  return <article className={'live-decision-card ' + side}>
    <div className="ldc-head"><i className={'dot ' + side} /><span>{robot?.name || side.toUpperCase()}</span><small>{brain}</small></div>
    <strong className="ldc-action">{pending ? 'THINKING…' : decision ? pretty(decision.action) : '—'}</strong>
    {!pending && decision?.fallback && <em className="illegal-badge" title={decision.fallback.reason}>ILLEGAL MOVE “{decision.fallback.attempted}” → GUARD</em>}
    {!pending && decision && (bars.length
      ? <div className="ldc-bars" aria-label="Probability of each action">{bars.map(([action, probability]) => <div key={action} className={action === decision.action ? 'ldc-bar chosen' : 'ldc-bar'}><span>{pretty(action)}</span><div><i style={{ width: (probability ?? 0) * 100 + '%' }} /></div><b>{((probability ?? 0) * 100).toFixed(0)}%</b></div>)}</div>
      : <p className="ldc-note">{decision.source === 'demo' ? 'Rule-based bot: it scores every legal action and picks by weighted chance, so there is no model probability to show.' : 'This provider returned a single choice with no probability table.'}</p>)}
    <footer><span>EXCHANGE {decision?.round ?? '—'}</span><span>{chosen === null ? 'PROB. —' : 'CHOSE ' + (chosen * 100).toFixed(1) + '%'}</span><span>{decision ? (decision.source === 'demo' ? 'LOCAL' : decision.latencyMs.toLocaleString() + ' ms') : ''}</span><span>{decision ? decision.legalActions.length + ' LEGAL' : ''}</span></footer>
    {decision?.model && <small className="ldc-model">MODEL / {decision.model}</small>}
  </article>;
}

/** Both boxers' decisions for the last exchange, side by side, so the two minds can be compared at a glance. */
export function LiveDecisionBoard({ state, pending }: { state: Battlefield | null; pending: boolean }) {
  return <section className="panel live-decisions" aria-live="polite" aria-label="Both robot decisions for the current exchange"><div className="panel-heading"><span><Icon name="cpu" size={15} /> BOTH DECISIONS, SIDE BY SIDE</span><span className={pending ? 'micro pulse' : 'micro'}>{pending ? 'BOTH ROBOTS DECIDING' : 'LAST RESOLVED EXCHANGE'}</span></div>
    <div className="live-decision-grid"><DecisionCard state={state} side="red" pending={pending} /><DecisionCard state={state} side="blue" pending={pending} /></div>
    <p>Both selections are requested independently from the same frozen ring state. A probability table is shown only when the provider returned one.</p></section>;
}
