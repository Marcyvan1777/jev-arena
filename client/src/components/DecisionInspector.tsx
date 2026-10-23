import { useState } from 'react';
import type { Battlefield, Side } from '../../../shared/types.js';
import { Icon } from './Icon.js';
export function DecisionInspector({ state, pending }: { state: Battlefield | null; pending: boolean }) {
  const [side, setSide] = useState<Side>('red');
  const [selectedRound, setSelectedRound] = useState(0);
  const history = state?.decisions.filter(d => d.robot === side) || [];
  const decision = selectedRound ? history.find(d => d.round === selectedRound) ?? history.at(-1) : history.at(-1);
  const entries = decision?.probabilities ? Object.entries(decision.probabilities).sort(([, a], [, b]) => (b ?? 0) - (a ?? 0)) : [];
  const fighter = state?.robots[side];
  const accuracy = fighter?.stats.punchesThrown ? Math.round(fighter.stats.punchesLanded / fighter.stats.punchesThrown * 100) : 0;
  return <aside className={`panel inspector ${side}`}>
    <div className="panel-heading"><span><Icon name="cpu" /> DECISION INSPECTOR</span><span className={`tiny-dot ${pending ? 'pulse' : ''}`} /></div>
    <div className="inspector-tabs" role="tablist" aria-label="Robot decisions">
      {(['red', 'blue'] as const).map(s => <button key={s} role="tab" aria-selected={side === s} className={side === s ? `selected ${s}` : ''} onClick={() => setSide(s)}><i className={`dot ${s}`} />{state?.robots[s].name || (s === 'red' ? 'RAVAGER' : 'AEGIS')}</button>)}
    </div>
    <div className="inspector-body">
      <label className="field-label" htmlFor="history">DECISION HISTORY</label>
      <select id="history" value={selectedRound} onChange={e => setSelectedRound(Number(e.target.value))}>
        <option value={0}>Latest decision {pending ? '· thinking…' : ''}</option>
        {[...history].reverse().map(d => <option value={d.round} key={d.round}>Round {d.round} · {d.action.replaceAll('_', ' ')}</option>)}
      </select>
      {decision ? <>
        {fighter && <div className="decision-meta boxing-meta"><div><span>HEALTH / STAMINA</span><b>{fighter.hp} / {fighter.stamina}</b></div><div><span>LANDED / THROWN</span><b>{fighter.stats.punchesLanded} / {fighter.stats.punchesThrown}</b></div><div><span>ACCURACY / DAMAGE</span><b>{accuracy}% / {fighter.stats.damage}</b></div><div><span>KNOCKDOWNS</span><b>{fighter.stats.knockdowns}</b></div></div>}
        <div className="decision-source"><span className="micro">{decision.source === 'demo' ? 'LOCAL RULE-BASED BOT' : decision.source.toUpperCase() + ' CHOICE'}</span><span className="micro">R{String(decision.round).padStart(3, '0')}</span></div>
        <div className="chosen-action"><Icon name="bolt" size={23} /><strong>{decision.action.replaceAll('_', ' ')}</strong></div>
        {decision.fallback && <p className="illegal-note">The model answered “{decision.fallback.attempted}”, which was not a legal move ({decision.fallback.reason}). The referee made this boxer guard; the fight went on and the fault was counted.</p>}
        <div className="selection-prob"><span>Selected action probability</span><b>{decision.selectedProbability === undefined ? '—' : `${(decision.selectedProbability * 100).toFixed(1)}%`}</b></div>
        <div className="divider" />
        <div className="micro section-label">ACTION DISTRIBUTION</div>
        {entries.length ? <div className="probabilities">{entries.map(([action, probability]) => <div className={action === decision.action ? 'prob selected' : 'prob'} key={action}>
          <div><span>{action.replaceAll('_', ' ')}</span><span>{((probability ?? 0) * 100).toFixed(1)}%</span></div>
          <div className="prob-track"><i style={{ width: `${(probability ?? 0) * 100}%` }} /></div>
        </div>)}</div> : <div className="empty-distribution"><Icon name="cpu" size={28} /><p>{decision.source === 'demo' ? 'Demo Mode uses deterministic rules. No API probabilities are generated.' : 'This provider did not return an action probability distribution.'}</p></div>}
        <div className="decision-meta"><div><span>RESPONSE TIME</span><b>{decision.source === 'demo' ? 'LOCAL' : decision.latencyMs.toLocaleString() + ' ms'}</b></div><div><span>LEGAL ACTIONS</span><b>{decision.legalActions.length.toString().padStart(2, '0')}</b></div></div>
        {decision.model && <p className="model-label">MODEL / {decision.model}</p>}
        <p className="inspector-note">Probabilities describe action selection, not the chance of winning. Both robots decide independently from the same battlefield snapshot.</p>
      </> : <div className="inspector-empty"><div className="cpu-ring"><Icon name="cpu" size={38} /></div><h3>Inside the machine.</h3><p>Start a battle to inspect each robot’s choices, response times and actual Jev probabilities.</p><span className="micro">AWAITING FIRST DECISION</span></div>}
    </div>
    <div className="inspector-footer"><span className="tiny-dot" /> OBSERVABLE BY DESIGN</div>
  </aside>;
}
