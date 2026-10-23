import { useEffect, useRef } from 'react';
import type { MatchView } from '../../../shared/types.js';
import { JUDGES } from '../../../shared/rules.js';
import { Icon } from './Icon.js';
const favorite = (actions: Record<string, number | undefined>) => Object.entries(actions).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0].replaceAll('_', ' ') || '—';
export function Victory({ view, onClose, onRematch }: { view: MatchView; onClose: () => void; onRematch: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), state = view.state;
  const matchup = state.config.mode === 'demo' ? 'DEMO MODE · LOCAL RULE-BASED BOTS' : state.config.providers.red.toUpperCase() + ' VS ' + state.config.providers.blue.toUpperCase() + ' · LIVE PROVIDER DECISIONS';
  useEffect(() => { dialog.current?.showModal(); }, []);
  const winner = state.winner === 'draw' ? null : state.winner;
  return <dialog ref={dialog} className={`victory-dialog ${winner || ''}`} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="victory-title">
    <button className="icon-button close-dialog" aria-label="Close match results" onClick={onClose}><Icon name="cross" /></button>
    <div className="victory-emblem"><Icon name={winner === 'blue' ? 'shield' : 'bolt'} size={50} /></div><span className="micro">COMBAT PROTOCOL COMPLETE</span>
    <h2 id="victory-title">{winner ? state.robots[winner].name : 'DEADLOCK'}<br/><em>{winner ? 'WINS.' : 'DRAW.'}</em></h2>
    <p>{state.finishReason}</p>
    <div className="result-highlights"><div><strong>{state.round}</strong><span>EXCHANGES</span></div><div><strong>{view.usage.apiCalls}</strong><span>API CALLS</span></div><div><strong>{view.usage.completedDecisions ? Math.round(view.usage.totalLatencyMs / view.usage.completedDecisions) : '—'}<small>{view.usage.completedDecisions ? ' ms' : ''}</small></strong><span>AVG. RESPONSE</span></div></div>
    {state.cards.length > 0 && <table className="result-table"><thead><tr><th>JUDGES' CARDS</th><th className="text-red">{state.robots.red.name}</th><th className="text-blue">{state.robots.blue.name}</th></tr></thead><tbody>
      {state.cards.map(card => <tr key={card.round}><td>Round {card.round} · {card.note}</td><td>{card.red}</td><td>{card.blue}</td></tr>)}
      <tr><td>Total</td><td>{state.cards.reduce((n, c) => n + c.red, 0)}</td><td>{state.cards.reduce((n, c) => n + c.blue, 0)}</td></tr>
      {JUDGES.map((judge, i) => <tr key={judge.name} className="judge-row"><td>{judge.name} <small>(favours {judge.favours})</small></td><td>{state.cards.reduce((n, c) => n + (c.judges[i]?.red ?? 0), 0)}</td><td>{state.cards.reduce((n, c) => n + (c.judges[i]?.blue ?? 0), 0)}</td></tr>)}
    </tbody></table>}
    <table className="result-table"><thead><tr><th>COMBAT REPORT</th><th className="text-red">{state.robots.red.name}</th><th className="text-blue">{state.robots.blue.name}</th></tr></thead><tbody>
      {(['damage', 'punchesThrown', 'punchesLanded', 'blocks', 'dodges', 'knockdowns'] as const).map(key => <tr key={key}><td>{({ damage: 'Damage dealt', punchesThrown: 'Punches thrown', punchesLanded: 'Punches landed', blocks: 'Successful guards', dodges: 'Successful slips', knockdowns: 'Knockdowns scored' })[key]}</td><td>{state.robots.red.stats[key]}</td><td>{state.robots.blue.stats[key]}</td></tr>)}
      <tr><td>Most used action</td><td>{favorite(state.robots.red.stats.actions)}</td><td>{favorite(state.robots.blue.stats.actions)}</td></tr>
    </tbody></table>
    <button className="primary-button rematch" onClick={onRematch}><Icon name="reset" /> RUN IT BACK <Icon name="arrow" /></button>
    <p className="micro">{matchup} · SEED {state.config.seed} · <a href={`/api/matches/${view.id}/export`} download={`jev-arena-fight-${state.config.seed}.json`}>DOWNLOAD FIGHT LOG</a></p>
  </dialog>;
}
