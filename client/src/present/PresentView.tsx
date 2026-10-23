import { useEffect, useRef, useState } from 'react';
import type { Battlefield, Decision, MatchConfig, Side } from '../../../shared/types.js';
import { PROVIDER_DISPLAY_NAMES } from '../../../shared/rules.js';
import { Arena } from '../game/Arena.js';
import { Overlay } from './Overlay.js';
import './present.css';

declare global { interface Window { __present?: { round: number; finished: boolean; winner: string | null; reason: string | null; pending: boolean; knockdown: boolean; finishKind: string | null; decisions: number } } }
const pretty = (action: string) => action.replaceAll('_', ' ');

function Thinking({ since }: { since: number }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(performance.now()), 100); return () => window.clearInterval(timer); }, []);
  return <span className="pv-thinking">DECIDING… {((now - since) / 1000).toFixed(1)} s</span>;
}

function BrainCard({ side, state, config, pending, since }: { side: Side; state: Battlefield | null; config: MatchConfig; pending: boolean; since: number }) {
  const robot = state?.robots[side], decision: Decision | undefined = state?.decisions.filter(d => d.robot === side).at(-1);
  const provider = config.mode === 'demo' ? 'demo' : config.providers[side], brain = provider === 'demo' ? 'RULE-BASED BOT' : PROVIDER_DISPLAY_NAMES[provider as keyof typeof PROVIDER_DISPLAY_NAMES] + ' · LIVE MODEL';
  const bars = decision?.probabilities ? Object.entries(decision.probabilities).sort(([, a], [, b]) => (b ?? 0) - (a ?? 0)).slice(0, 4) : [];
  const chosen = decision?.selectedProbability;
  return <article className={'pv-card ' + side}>
    <header><b>{robot?.name ?? config[side].name}</b><span className="pv-badge">{brain}</span></header>
    <div className="pv-action">{pending ? <Thinking since={since} /> : decision ? <>{pretty(decision.action)}{chosen !== undefined && <em>{(chosen * 100).toFixed(0)}%</em>}</> : <span className="pv-wait">WAITING FOR THE BELL</span>}</div>
    {!pending && decision?.fallback && <div className="pv-illegal">ILLEGAL “{decision.fallback.attempted}” → GUARD</div>}
    {!pending && decision && (bars.length
      ? <div className="pv-bars">{bars.map(([action, p]) => <div key={action} className={action === decision.action ? 'on' : ''}><span>{pretty(action)}</span><i><u style={{ width: (p ?? 0) * 100 + '%' }} /></i><b>{((p ?? 0) * 100).toFixed(0)}%</b></div>)}</div>
      : <div className="pv-note">{decision.source === 'demo' ? 'Utility score for every legal action, then a weighted pick: no probabilities.' : 'This provider returns one choice and no probability table.'}</div>)}
    <footer>{decision && !pending ? <>⏱ {decision.source === 'demo' ? 'local' : decision.latencyMs.toLocaleString() + ' ms'} · {decision.legalActions.length} legal actions{decision.model ? ' · ' + decision.model : ''}</> : <>&nbsp;</>}</footer>
    <div className="pv-history">{(robot?.history ?? []).slice(-7).map((a, i, all) => <span key={i} className={i === all.length - 1 ? 'last' : ''}>{pretty(a)}</span>)}</div>
  </article>;
}

/** Full-screen arena with a broadcast-style panel that puts the two decision makers side by side. */
export function PresentView({ state, config, speed, pending, view }: { state: Battlefield | null; config: MatchConfig; speed: number; pending: boolean; view: Battlefield | null }) {
  const since = useRef(performance.now()), wasPending = useRef(false);
  if (pending && !wasPending.current) since.current = performance.now();
  wasPending.current = pending;
  useEffect(() => { document.body.classList.add('present-mode'); return () => document.body.classList.remove('present-mode'); }, []);
  useEffect(() => {
    window.__present = { round: state?.round ?? 0, finished: state?.status === 'finished', winner: state?.winner ?? null, reason: state?.finishReason ?? null, pending,
      knockdown: Boolean(state?.events.some(e => e.round === state.round && e.kind === 'knockdown')), finishKind: /^Knockout/.test(state?.finishReason ?? '') ? 'ko' : /^Technical/.test(state?.finishReason ?? '') ? 'tko' : state?.status === 'finished' ? 'decision' : null, decisions: state?.decisions.length ?? 0 };
  });
  return <div className="present">
    <Arena state={state} config={config} speed={speed} />
    <div className="pv-strip">
      <BrainCard side="red" state={state} config={config} pending={pending} since={since.current} />
      <div className="pv-centre">
        <div className="pv-flow"><b>STATE + LEGAL ACTIONS</b><i>→</i><b className="hot">DECISION MODEL</b><i>→</i><b>CHOICE + PROBABILITIES</b><i>→</i><b>RULES ENGINE</b></div>
        <p>Both brains read the same snapshot and answer at the same time. Neither sees the other's move.</p>
        <small>EXCHANGE {view?.round ?? 0} · {config.maxRounds / 12} ROUNDS</small>
      </div>
      <BrainCard side="blue" state={state} config={config} pending={pending} since={since.current} />
    </div>
    <Overlay />
  </div>;
}
