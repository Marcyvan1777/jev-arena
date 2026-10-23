import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONFIG, ACTION_RULES, RULES, withFighterNames } from '../../shared/rules.js';
import type { MatchConfig, Provider, Side } from '../../shared/types.js';
import { request } from './api.js';
import { useBattle } from './useBattle.js';
import { useSpectator } from './spectate.js';
import { spectateFeed } from './game/stateFeed.js';
import { Arena } from './game/Arena.js';
import { Icon } from './components/Icon.js';
import { RobotCard } from './components/RobotCard.js';
import { DecisionInspector } from './components/DecisionInspector.js';
import { Victory } from './components/Victory.js';
import { LiveDecisionBoard } from './components/LiveDecisionBoard.js';
import { Tournament } from './components/Tournament.js';
import { FairnessPanel } from './components/FairnessPanel.js';
import { GridLab } from './components/GridLab.js';
import { PROJECT_NAME, PROJECT_TAGLINE } from './project.js';
import { applyParams, presentParams } from './present/params.js';
import { PresentView } from './present/PresentView.js';
import { Overlay } from './present/Overlay.js';

export default function App() {
  const [config, setConfig] = useState<MatchConfig>(() => applyParams(structuredClone(DEFAULT_CONFIG)));
  const [speed, setSpeed] = useState(presentParams.speed ?? 1), [results, setResults] = useState(false);
  const [health, setHealth] = useState<{ jevConfigured: boolean; openaiConfigured: boolean; claudeConfigured: boolean; model: string; maxRounds: number } | null>(null);
  const [offline, setOffline] = useState(false), [logFilter, setLogFilter] = useState<'all' | 'combat'>('all');
  const rules = useRef<HTMLDialogElement>(null);
  // Names are derived from model and personality ("JEV (BERSERKER)"), so they can never drift from what is actually fighting.
  const named = useMemo(() => withFighterNames(config), [config]);
  const battle = useBattle(named, speed), { view, running, busy, controlling, error } = battle;
  // While a tournament is being watched, the ring, panels and log show that simulation instead of the single match.
  const [watchId, setWatchId] = useState<string | null>(null);
  const spectator = useSpectator(watchId), spectating = watchId !== null;
  const state = spectating ? spectator.state : view?.state ?? null;
  const editable = !spectating && (!view || state?.round === 0 || state?.status === 'finished');
  const activeConfig = (spectating || !editable) && state ? state.config : named;
  useEffect(() => {
    void request<{ jevConfigured: boolean; openaiConfigured: boolean; claudeConfigured: boolean; model: string; maxRounds: number }>('/health').then(h => {
      setHealth(h); setConfig(c => ({ ...c, maxRounds: Math.min(c.maxRounds, h.maxRounds) }));
    }).catch(() => setOffline(true));
  }, []);
  useEffect(() => {
    if (state?.status !== 'finished') { setResults(false); return; }
    // Leave time to watch the knockout and the winner's celebration before the results dialog covers the ring.
    const timer = setTimeout(() => setResults(true), /^Knockout/.test(state.finishReason ?? '') ? 9500 : 5000);
    return () => clearTimeout(timer);
  }, [state?.status, state?.finishReason]);
  const updateRobot = (side: Side, value: MatchConfig['red']) => setConfig(c => ({ ...c, [side]: value }));
  const updateProvider = (side: Side, value: Provider) => setConfig(c => ({ ...c, providers: { ...c.providers, [side]: value }, [side]: { ...c[side], name: value === "openai" ? "GPT" : value === "claude" ? "CLAUDE" : value === "jev" ? "JEV" : "DEMO" } }));
  const valid = config.red.name.trim().length > 0 && config.blue.name.trim().length > 0;
  const latestEvent = [...(state?.events || [])].reverse().find(e => e.kind !== 'move');
  const events = [...(state?.events || [])].reverse().filter(e => logFilter === 'all' || e.kind !== 'move');
  const status = spectating ? 'WATCHING SIMULATION' : error ? 'SIGNAL INTERRUPTED' : state?.status === 'finished' ? 'MATCH COMPLETE' : busy ? 'ROBOTS THINKING' : running ? 'LIVE COMBAT' : state?.round ? 'BATTLE PAUSED' : 'AWAITING DEPLOYMENT';
  const avg = view?.usage.completedDecisions ? Math.round(view.usage.totalLatencyMs / view.usage.completedDecisions) : null;

  // Presentation mode (?present=1): the ring full screen with both decisions on show, started from the address bar.
  const autostarted = useRef(false);
  // Lets a recording script start the fight at the exact moment it wants.
  useEffect(() => { if (presentParams.present) (window as unknown as { __startFight?: () => void }).__startFight = () => void battle.control('start'); });
  const backendReady = health !== null; // a boolean: the health object itself changes identity on every (double) fetch in dev
  useEffect(() => {
    if (!presentParams.present || !presentParams.autostart || !backendReady || autostarted.current) return;
    autostarted.current = true; const timer = window.setTimeout(() => void battle.control('start'), 1500);
    return () => window.clearTimeout(timer);
  }, [backendReady]); // eslint-disable-line react-hooks/exhaustive-deps
  if (presentParams.present) return <PresentView state={state} config={activeConfig} speed={speed} pending={busy} view={view?.state ?? null} />;

  return <div className="app-shell">
    <div className="project-strip" role="banner"><span>{PROJECT_NAME}</span><small>{PROJECT_TAGLINE}</small></div>
    <header className="site-header"><a href="/" className="brand" aria-label="JEV ARENA home"><span className="brand-symbol">J</span><span>JEV<span className="brand-light">ARENA</span></span><span className="version">V.01</span></a>
      <div className="header-center"><span className="tiny-dot" /> AUTONOMOUS BOXING LEAGUE</div>
      <button className="text-button" onClick={() => rules.current?.showModal()}><Icon name="eye" size={15} /> How it works <span>↗</span></button>
    </header>
    <main>
      <section className="intro"><div><div className="eyebrow"><span /> THE MACHINES HAVE SOMETHING TO SETTLE.</div><h1>Two minds. <span>One ring.</span></h1><p>Pick a fighting style. Watch Jev call the shots. Let the robots trade hands.</p></div><div className="intro-stamp"><Icon name="cpu" size={24} /><div><span>POWERED BY</span><strong>TypeSafe <b>Jev</b></strong></div></div></section>
      <div className="mode-strip"><div className="mode-toggle" role="group" aria-label="Execution mode"><button disabled={!editable} className={config.mode === 'jev' ? 'active' : ''} onClick={() => setConfig(c => ({ ...c, mode: 'jev' }))}><Icon name="cpu" size={15} /> LIVE PROVIDERS <span className="live-label">API</span></button><button disabled={!editable} className={config.mode === 'demo' ? 'active' : ''} onClick={() => setConfig(c => ({ ...c, mode: 'demo' }))}>DEMO MODE</button></div>
        <div className="connection"><i className={`dot ${offline || (config.mode === 'jev' && health && ((!health.jevConfigured && (config.providers.red === 'jev' || config.providers.blue === 'jev')) || (!health.openaiConfigured && (config.providers.red === 'openai' || config.providers.blue === 'openai')) || (!health.claudeConfigured && (config.providers.red === 'claude' || config.providers.blue === 'claude')))) ? 'amber' : 'lime'}`} /><span>{offline ? 'Backend offline · run npm run dev' : config.mode === 'demo' ? 'Local rule-based bots · no API credits' : !health ? 'Checking backend…' : ['Jev ' + (health.jevConfigured ? 'ready' : 'missing'), 'GPT ' + (health.openaiConfigured ? 'ready' : 'missing'), 'Claude ' + (health.claudeConfigured ? 'ready' : 'missing')].join(' · ')}</span></div>
      </div>
      {config.mode === 'jev' && health && <div className="provider-readiness">JEV: {health.jevConfigured ? 'READY' : 'MISSING'} · GPT: {health.openaiConfigured ? 'READY' : 'MISSING'} · CLAUDE: {health.claudeConfigured ? 'READY' : 'MISSING'} · KEYS STAY ON THE SERVER</div>}
      <div className="battle-layout">
        <aside className="fighters-column"><div className="column-heading"><span>THE CONTENDERS</span><span>02 UNITS</span></div>
          <RobotCard side="red" robot={state?.robots.red} config={activeConfig} disabled={!editable} update={updateRobot} updateProvider={updateProvider} />
          <div className="versus-separator"><span />VS<span /></div>
          <RobotCard side="blue" robot={state?.robots.blue} config={activeConfig} disabled={!editable} update={updateRobot} updateProvider={updateProvider} />
        </aside>
        <section className="main-column">
          <div className="arena-panel panel"><div className="arena-topbar"><div><span className={`tiny-dot ${running ? 'pulse' : ''}`} /><b>THE CHAMPIONSHIP RING</b><span className="arena-tag">RING 01</span></div><span className="round">ROUND <b>{state?.boxingRound ?? 1}</b><span> / {Math.ceil(activeConfig.maxRounds / RULES.exchangesPerRound)} · EXCHANGE {String(state?.round ?? 0).padStart(3, '0')} / {activeConfig.maxRounds}</span></span></div>
            <div className="arena-wrapper"><Arena state={state} config={activeConfig} speed={spectating ? spectator.speed ?? 8 : speed} feed={spectating ? spectateFeed : undefined} />{spectating && <div className="spectate-bar"><span><i className="tiny-dot pulse" /> WATCHING · {spectator.label || 'WAITING FOR THE FIRST BOUT…'}</span><div role="group" aria-label="Simulation speed">{[1, 2, 4, 8].map(s => <button key={s} className={spectator.speed === s ? 'active' : ''} onClick={() => spectator.setSpeed(s)}>{s}×</button>)}<button className={spectator.speed === null ? 'active' : ''} onClick={() => spectator.setSpeed(null)} title="Fast-forward: no pacing">FAST</button><button className="stop" onClick={() => setWatchId(null)}>STOP WATCHING</button></div></div>}<div className={`arena-state ${busy ? 'thinking' : ''}`}><span className="tiny-dot" />{status}</div>{state?.status === 'finished' && <button className="view-results" onClick={() => setResults(true)}>VIEW MATCH RESULTS <Icon name="arrow" size={14} /></button>}</div>
            <div className="announcer"><span className="announcer-label"><Icon name="bolt" size={13} /> ANNOUNCER</span><p>{latestEvent?.message || 'Two autonomous robots enter. The warranty leaves immediately.'}</p><span className="template-label" title="Predefined deterministic event commentary, not generated by Jev">SCRIPTED</span></div>
            <div className="controls"><div className="transport"><button className="primary-button" disabled={spectating || controlling || !valid || (busy && !running)} onClick={() => void battle.control(running ? 'pause' : 'start')}><Icon name={running ? 'pause' : 'play'} size={16} />{controlling ? 'PLEASE WAIT' : running ? 'PAUSE' : state?.status === 'finished' ? 'REMATCH' : state?.round ? 'RESUME' : 'START BATTLE'}</button>
              <button className="secondary-button step-button" disabled={spectating || running || busy || controlling || !valid || state?.status === 'finished'} onClick={() => void battle.control('step')} title="Run exactly one turn"><Icon name="step" size={16} /><span>STEP</span></button>
              <button className="icon-button" aria-label="Restart battle" title="Reset battlefield and usage counters" disabled={spectating || controlling} onClick={() => void battle.control('restart')}><Icon name="reset" size={17} /></button></div>
              <div className="speed-control" role="group" aria-label="Battle animation speed"><span>SPEED</span>{[1, 2, 4].map(s => <button key={s} className={s === speed ? 'active' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
            </div>
          </div>
          {error && <div className="error-banner" role="alert"><Icon name="bolt" /><p>{error}</p><button onClick={() => void battle.control(view ? 'retry' : 'start')} disabled={busy || controlling}>RETRY</button></div>}
          <div className="match-settings panel"><div><label className="field-label" htmlFor="layout">VENUE</label><select id="layout" disabled={!editable} value={config.layout} onChange={e => setConfig(c => ({ ...c, layout: e.target.value as MatchConfig['layout'] }))}><option value="championship">01 / Championship Ring</option></select></div><div><label className="field-label" htmlFor="seed">SIMULATION SEED <button type="button" className="seed-random" disabled={!editable} title="Pick a random seed so the dice are different every fight" onClick={() => setConfig(c => ({ ...c, seed: Math.floor(Math.random() * 1_000_000) }))}>🎲 RANDOM</button></label><input id="seed" type="number" min={0} max={2147483647} disabled={!editable} value={config.seed} onChange={e => setConfig(c => ({ ...c, seed: Math.max(0, Math.min(2147483647, Math.trunc(Number(e.target.value)))) }))} /><small className="seed-note" title="The seed fixes the dice for both corners: whether each punch lands, is slipped or knocks down. It does not change what the AI chooses.">Fixes the dice (hits, slips, knockdowns) for both corners, not the AI’s choices.</small></div><div><label className="field-label" htmlFor="rounds">BOUT LENGTH</label><select id="rounds" disabled={!editable} value={config.maxRounds} onChange={e => setConfig(c => ({ ...c, maxRounds: Number(e.target.value) }))}>{[...new Set([12, 24, 36, 48, 60])].filter(n => n <= (health?.maxRounds ?? 60)).map(n => <option key={n} value={n}>{n / RULES.exchangesPerRound} {n === RULES.exchangesPerRound ? 'round' : 'rounds'} · {n} exchanges</option>)}</select></div></div>
          <FairnessPanel config={config} setConfig={setConfig} disabled={!editable} />
          <LiveDecisionBoard state={state} pending={busy} />
          <section className="panel log-panel"><div className="panel-heading"><span><Icon name="bolt" size={15} /> BATTLE FEED <b className="count-badge">{state?.events.length ?? 0}</b></span><div className="log-tabs"><button className={logFilter === 'all' ? 'active' : ''} onClick={() => setLogFilter('all')}>ALL EVENTS</button><button className={logFilter === 'combat' ? 'active' : ''} onClick={() => setLogFilter('combat')}>COMBAT</button></div></div>
            <div className="event-log" role="log" aria-live="polite" aria-label="Battle event history">{events.length ? events.map((event, i) => <div className={`log-event ${event.kind}`} key={`${state?.round}-${i}`}><span className="log-round">R{String(event.round).padStart(3, '0')}</span><i className={`dot ${event.actor || 'lime'}`} /><p>{event.message}</p>{event.amount !== undefined && <b>−{event.amount}</b>}</div>) : <div className="log-empty"><span className="terminal-cursor">▌</span> Combat systems online. Waiting for the first move.<span className="micro">NO ROBOTS WERE HARMED. YET.</span></div>}</div>
          </section>
        </section>
        <div className="intel-column"><div className="column-heading"><span>NEURAL TELEMETRY</span><Icon name="cpu" size={13} /></div><DecisionInspector state={state} pending={busy} />
          <div className="panel usage-panel"><div className="micro">SESSION METRICS</div><div><span>Jev API calls</span><strong>{String(view?.usage.apiCalls ?? 0).padStart(2, '0')}</strong></div><div><span>Average response</span><strong>{avg === null ? '—' : `${avg.toLocaleString()}`}<small>{avg === null ? '' : ' ms'}</small></strong></div><div><span>Combined damage</span><strong>{(state?.robots.red.stats.damage ?? 0) + (state?.robots.blue.stats.damage ?? 0)}<small> HP</small></strong></div><p>HTTP attempts include bounded retries. Metrics refresh when each turn settles.</p></div>
          <Tournament config={named} disabled={!editable || running || busy || controlling} onWatch={setWatchId} />
        </div>
      </div>
      <GridLab mode={config.mode} health={health} onWatch={setWatchId} onLoadMatchup={(a, b) => { setConfig(c => ({ ...c, mode: c.mode, providers: { red: a.provider, blue: b.provider }, red: { ...c.red, personality: a.personality }, blue: { ...c.blue, personality: b.personality } })); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      <footer className="site-footer"><span><i className="tiny-dot" /> {config.mode === 'jev' ? 'LIVE PROVIDERS CHOOSE. THE ENGINE EXECUTES.' : 'DEMO MODE / LOCAL RULES. NO API CALLS.'}</span><span>BUILT FOR THE SPECTACLE. DESIGNED TO BE INSPECTED.</span><span>JEV ARENA © 2026</span></footer>
    </main>
    {presentParams.overlay && <Overlay />}
    {results && view && <Victory view={view} onClose={() => setResults(false)} onRematch={() => { setResults(false); void battle.control('start'); }} />}
    <dialog ref={rules} className="rules-dialog" aria-labelledby="rules-title"><button className="icon-button close-dialog" aria-label="Close rules" onClick={() => rules.current?.close()}><Icon name="cross" /></button><div className="eyebrow">RING MANUAL / 01</div><h2 id="rules-title">Intelligence meets impact.</h2><p>Every exchange, both robots independently choose from the same pre-exchange ring snapshot. The server validates their choices, applies movement, then resolves their punches fairly and simultaneously.</p><div className="rules-grid">{Object.entries(ACTION_RULES).map(([name, rule]) => <div key={name}><strong>{name.replaceAll('_', ' ')}</strong><span>{rule.cost} STAMINA</span><p>{rule.description}</p></div>)}</div><p>Robots begin in punching range. Stamina regenerates each exchange; guards reduce damage, slips evade punches, and counters punish an attacking opponent. Three quiet exchanges force a neutral referee reset at boxing range—no damage, no hidden advantage.</p><p><b>Styles.</b> A BERSERKER is a pressure fighter: it walks forward, cuts off the ring and throws combinations, accepting punches to land more. A COUNTERPUNCHER lets the other boxer come, slips or blocks, then answers while they are open. Both have identical health, stamina, rules and dice; only the decision differs. An LLM reads a paragraph describing its style; the local rule-based bot scores every legal action with temperament weights. You can put them in the same ring: pick LOCAL BOT as a fighter's brain.</p><p>A fight is boxed in rounds of 12 exchanges. Between rounds both corners recover some stamina and health, and each round is scored 10–9 (10–8 when dominant, 10–10 when level) from damage, landed punches, knockdowns, guards and slips. A fight ends by KO at zero health, TKO after three knockdowns, or the judges’ cards at the bout length; level cards fall back to total scoring, then finite sudden death and a documented tie-breaker. Below 25 stamina a boxer is gassed: punches are weaker and less accurate.</p><p>The seed fixes the dice for both corners (whether each punch lands, is slipped or knocks down). It does not choose what the AI does: model decisions are not seeded, so only the dice replay identically. Clinching ties the opponent up to recover stamina, but a second clinch in a row draws a warning and a third costs a point; three judges score each round with slightly different emphasis, so close fights can be split decisions.</p><p>Pause cancels pending decisions; requests already sent may still cost credits. Step runs one complete exchange. Speed changes presentation only. Real Jev Mode never falls back to local bots; Demo Mode is clearly labelled. Announcer lines are deterministic templates, not Jev explanations.</p></dialog>
  </div>;
}
