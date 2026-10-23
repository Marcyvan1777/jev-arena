import type { Battlefield, MatchConfig, Side } from '../../../shared/types.js';
import { PROVIDER_DISPLAY_NAMES, RULES, judgeScore } from '../../../shared/rules.js';

function Fighter({ side, state, config }: { side: Side; state: Battlefield | null; config: MatchConfig }) {
  const robot = state?.robots[side], hp = robot?.hp ?? RULES.hp, stamina = robot?.stamina ?? RULES.stamina;
  const brain = PROVIDER_DISPLAY_NAMES[config.mode === 'demo' ? 'demo' : config.providers[side]];
  const damaged = state ? 1 - hp / RULES.hp : 0, landed = robot?.stats.punchesLanded ?? 0, thrown = robot?.stats.punchesThrown ?? 0;
  const decision = state?.decisions.filter(d => d.robot === side).at(-1);
  const combo = Boolean(state?.events.some(e => e.round === state.round && e.actor === side && e.combo));
  return <div className={'hud-fighter ' + side}>
    <div className="hud-name"><b>{robot?.name ?? config[side].name}</b><span>{config.mode === 'demo' || config.providers[side] === 'demo' ? 'LOCAL BOT' : 'LIVE · ' + brain}</span></div>
    <div className="hud-bar hp" aria-label={`${side} health ${hp} of ${RULES.hp}`}><i style={{ width: (hp / RULES.hp) * 100 + '%' }} /><em style={{ opacity: damaged > 0.6 ? 1 : 0 }} /></div>
    <div className="hud-bar stamina" aria-label={`${side} stamina ${stamina}`}><i style={{ width: stamina + '%' }} /></div>
    <div className="hud-pips" aria-label={`${robot?.knockdownsTaken ?? 0} knockdowns taken`}>{[0, 1, 2].map(n => <span key={n} className={n < (robot?.knockdownsTaken ?? 0) ? 'on' : ''} />)}</div>
    <div className="hud-stats">{thrown ? `LANDED ${landed}/${thrown} · ${Math.round(landed / thrown * 100)}%` : 'NO PUNCHES YET'}{combo && <b key={state?.round} className="hud-combo">COMBO</b>}</div>
    {decision && state && state.round > 0 && <div className={'hud-decision' + (decision.fallback ? ' bad' : '')} title="This boxer's choice in the last exchange"><i>CHOSE</i> {decision.fallback ? `ILLEGAL “${decision.fallback.attempted}” → GUARD` : decision.action.replaceAll('_', ' ')}{decision.selectedProbability !== undefined && <i>{(decision.selectedProbability * 100).toFixed(0)}%</i>}</div>}
  </div>;
}

/** The big on-screen call-outs: round bell, knockdowns and the finish. Re-keyed per exchange so each one animates once. */
function callout(state: Battlefield | null) {
  if (!state || state.round === 0) return null;
  const events = state.events.filter(e => e.round === state.round);
  if (state.round === 1 && state.status !== 'finished') return { text: 'FIGHT!', sub: 'ROUND 1', tone: 'bell' };
  if (state.status === 'finished') {
    if (state.winner === 'draw') return { text: 'DRAW', tone: 'draw' };
    const reason = state.finishReason ?? '', how = /^Technical/.test(reason) ? 'TKO' : /^Knockout/.test(reason) ? 'K.O.' : 'DECISION';
    const kind = /^Judges' decision \((\w+)\)/.exec(reason)?.[1];
    return { text: how, sub: `${state.winner ? state.robots[state.winner].name : ''} WINS${kind ? ' · ' + kind.toUpperCase() + ' DECISION' : ''}`, tone: 'finish' };
  }
  if (events.some(e => e.kind === 'knockdown')) return { text: 'KNOCKDOWN!', tone: 'knockdown' };
  const bell = events.find(e => e.kind === 'bell' && e.message.startsWith('ROUND'));
  const card = state.cards.at(-1);
  if (bell) return { text: `ROUND ${state.boxingRound}`, sub: card ? `ROUND ${card.round} CARD ${card.red}–${card.blue} · ${card.note.toUpperCase()}` : 'SECONDS OUT', tone: 'bell' };
  return null;
}

const COUNT_WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];

/** Who is winning the current round, from the same score the judges use: -1 (all blue) to +1 (all red). */
function momentum(state: Battlefield | null) {
  if (!state || state.round === 0) return 0;
  const gain = (side: Side) => judgeScore(state.robots[side]) - state.roundBaseline[side].score;
  return Math.max(-1, Math.min(1, (gain('red') - gain('blue')) / 40));
}

export function Hud({ state, config, count }: { state: Battlefield | null; config: MatchConfig; count: number }) {
  const message = callout(state), inRound = state ? ((state.round - 1) % RULES.exchangesPerRound) + 1 : 0, cards = state?.cards ?? [];
  const totalRounds = Math.ceil(config.maxRounds / RULES.exchangesPerRound);
  const intro = !state || state.round === 0;
  return <div className="hud" aria-hidden="true">
    {intro && <div className="hud-intro"><span>TONIGHT'S MAIN EVENT</span>
      <div><b className="red">{config.red.name}</b><em>VS</em><b className="blue">{config.blue.name}</b></div>
      <small>SAME HEALTH · SAME STAMINA · SAME RULES · {Math.ceil(config.maxRounds / RULES.exchangesPerRound)} ROUNDS</small></div>}
    <div className="hud-top">
      <Fighter side="red" state={state} config={config} />
      <div className="hud-centre">
        <span className="hud-round">ROUND {state?.boxingRound ?? 1}<small>/ {totalRounds}</small></span>
        <span className="hud-exchange">{state && state.round > 0 ? `${String(inRound).padStart(2, '0')} / ${RULES.exchangesPerRound}` : 'READY'}</span>
        <span className="hud-momentum" title="Who is ahead in the current round"><i style={{ left: 50 + momentum(state) * 50 + '%' }} /></span>
        {cards.length > 0 && <span className="hud-cards">{cards.map(c => <b key={c.round}>{c.red}–{c.blue}</b>)}</span>}
      </div>
      <Fighter side="blue" state={state} config={config} />
    </div>
    {count > 0 && <div className="hud-count" key={count}><strong>{count}</strong><span>{COUNT_WORDS[count]}</span></div>}
    {message && !(count > 0 && message.tone === 'finish') && <div key={`${state?.round}-${message.tone}`} className={'hud-callout ' + message.tone}><strong>{message.text}</strong>{message.sub && <span>{message.sub}</span>}</div>}
  </div>;
}
