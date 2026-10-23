import { useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDER_DISPLAY_NAMES } from '../../../shared/rules.js';
import { GRID_LIMITS } from '../../../shared/grid.js';
import type { Contender, Effect, GridEstimate, GridSetup } from '../../../shared/grid.js';
import type { Personality, Provider } from '../../../shared/types.js';
import { PERSONALITIES } from '../../../shared/types.js';
import { api } from '../api.js';
import type { GridProgress } from '../api.js';
import { Icon } from './Icon.js';
import { presentParams } from '../present/params.js';
import './gridlab.css';

interface Health { jevConfigured: boolean; openaiConfigured: boolean; claudeConfigured: boolean; maxRounds: number }
const LIVE_MODELS: Array<{ id: Provider; label: string; ready: (h: Health) => boolean }> = [
  { id: 'jev', label: 'JEV', ready: h => h.jevConfigured }, { id: 'openai', label: 'GPT', ready: h => h.openaiConfigured }, { id: 'claude', label: 'CLAUDE', ready: h => h.claudeConfigured },
  { id: 'demo', label: 'LOCAL BOT (baseline)', ready: () => true },
];
const pct = (v: number) => Math.round(v * 100) + '%';
const short = (c: Contender) => `${PROVIDER_DISPLAY_NAMES[c.provider as keyof typeof PROVIDER_DISPLAY_NAMES]}·${c.personality.slice(0, 3)}`;
const heat = (score: number, played: number) => played === 0 ? 'transparent' : `hsl(${Math.round(score * 125)} 62% ${30 + Math.abs(score - 0.5) * 10}% / ${0.35 + Math.min(1, played / 8) * 0.55})`;

function EffectBars({ title, note, effects }: { title: string; note: string; effects: Effect[] }) {
  return <div className="effect-card"><h4>{title}</h4><p>{note}</p>
    {effects.length === 0 ? <em>Needs at least two different options to compare.</em> : effects.map(e => <div className="effect-row" key={e.key} title={`95% CI ${pct(e.ci95[0])}–${pct(e.ci95[1])} over ${e.bouts} bouts`}>
      <span>{e.label}</span><div className="effect-track"><i style={{ width: e.scoreRate * 100 + '%' }} /><b style={{ left: e.ci95[0] * 100 + '%', width: (e.ci95[1] - e.ci95[0]) * 100 + '%' }} /><u /></div><strong>{pct(e.scoreRate)}</strong></div>)}
  </div>;
}

export function GridLab({ mode, health, onWatch, onLoadMatchup }: { mode: 'jev' | 'demo'; health: Health | null; onWatch: (id: string | null) => void; onLoadMatchup: (a: Contender, b: Contender) => void }) {
  const live = mode === 'jev';
  const [models, setModels] = useState<Provider[]>(['jev']), [personalities, setPersonalities] = useState<Personality[]>([...PERSONALITIES]);
  const [bouts, setBouts] = useState(4), [maxRounds, setMaxRounds] = useState(36), [baseSeed, setBaseSeed] = useState(42), [mirror, setMirror] = useState(false), [concurrency, setConcurrency] = useState(3), [confirm, setConfirm] = useState(false), [watch, setWatch] = useState(false), [watchSpeed, setWatchSpeed] = useState<number | null>(4);
  const [estimate, setEstimate] = useState<GridEstimate | null>(null), [progress, setProgress] = useState<GridProgress | null>(null), [error, setError] = useState<string | null>(null), [running, setRunning] = useState(false);
  const job = useRef<string | null>(null);
  const setup: GridSetup = useMemo(() => ({ mode, models: live ? models : ['demo'], personalities, boutsPerPairing: bouts, maxRounds, baseSeed, includeMirror: mirror, concurrency }), [mode, live, models, personalities, bouts, maxRounds, baseSeed, mirror, concurrency]);
  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) => set(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

  useEffect(() => {
    if (setup.personalities.length === 0 || setup.models.length === 0) { setEstimate(null); return; }
    const timer = window.setTimeout(() => { api.gridEstimate(setup).then(setEstimate).catch(() => setEstimate(null)); }, 300);
    return () => window.clearTimeout(timer);
  }, [setup]);

  // ?grid=<id> reopens a grid that is running or finished on the server (kept for an hour), e.g. to present its results.
  useEffect(() => {
    const id = presentParams.grid; if (!id) return;
    let stop = false; const tick = () => { api.gridStatus(id).then(next => { if (!stop) setProgress(next); }).catch(() => undefined); };
    tick(); const timer = window.setInterval(tick, 2500); return () => { stop = true; window.clearInterval(timer); };
  }, []);
  const tooBig = estimate ? estimate.bouts > GRID_LIMITS.maxBouts || estimate.callsMax > GRID_LIMITS.maxLiveCalls : false;
  const needs = estimate ? estimate.bouts < 1 : true;
  const run = async () => {
    setError(null); setProgress(null); setRunning(true);
    try {
      let next = await api.gridStart(setup, confirm, watch ? { speed: watchSpeed } : undefined); job.current = next.id; setProgress(next); if (watch) { onWatch(next.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      while (next.status === 'running') { await new Promise(r => window.setTimeout(r, 1200)); next = await api.gridStatus(next.id); setProgress(next); }
      if (next.status === 'failed') setError(next.error ?? 'The grid failed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The grid failed.'); }
    finally { setRunning(false); job.current = null; onWatch(null); }
  };
  const cancel = () => { if (job.current) void api.gridCancel(job.current).catch(() => undefined); };
  const csv = () => {
    if (!progress) return;
    const rows = [['rank', 'contender', 'played', 'wins', 'draws', 'losses', 'score_rate', 'ci95_low', 'ci95_high', 'stoppages', 'avg_exchanges'], ...progress.analysis.standings.map((s, i) => [i + 1, s.name, s.played, s.wins, s.draws, s.losses, s.scoreRate, s.ci95[0], s.ci95[1], s.stoppages, s.avgExchanges])];
    const url = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })), a = document.createElement('a'); a.href = url; a.download = 'jev-arena-grid.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const analysis = progress?.analysis, byId = new Map((progress?.contenders ?? []).map(c => [c.id, c]));
  const done = progress ? progress.completedBouts / Math.max(1, progress.totalBouts) : 0;

  return <section className="panel grid-lab" aria-label="Tournament lab">
    <div className="panel-heading"><span><Icon name="cpu" size={15} /> TOURNAMENT LAB · GRID SEARCH</span><span className="micro">EVERY MODEL × EVERY PERSONALITY, ALL VS ALL</span></div>
    <div className="grid-form">
      <fieldset disabled={running}><legend>MODELS</legend>
        {live ? LIVE_MODELS.map(m => { const ready = health ? m.ready(health) : false; return <label key={m.id} className={ready ? '' : 'missing'}><input type="checkbox" checked={models.includes(m.id)} disabled={!ready} onChange={() => toggle(models, m.id, setModels)} /> {m.label} <small>{ready ? 'READY' : 'NO KEY'}</small></label>; })
          : <label><input type="checkbox" checked disabled /> DEMO BOT <small>LOCAL</small></label>}
      </fieldset>
      <fieldset disabled={running}><legend>PERSONALITIES</legend>
        {PERSONALITIES.map(p => <label key={p}><input type="checkbox" checked={personalities.includes(p)} onChange={() => toggle(personalities, p, setPersonalities)} /> {p}</label>)}
      </fieldset>
      <fieldset disabled={running} className="grid-options"><legend>SETTINGS</legend>
        <label>BOUTS PER PAIRING<select value={bouts} onChange={e => setBouts(Number(e.target.value))}>{[2, 4, 6, 10, 20, 40].map(n => <option key={n} value={n}>{n} ({n / 2} per corner)</option>)}</select></label>
        <label>BOUT LENGTH<select value={maxRounds} onChange={e => setMaxRounds(Number(e.target.value))}>{[12, 24, 36, 48].filter(n => n <= (health?.maxRounds ?? 48)).map(n => <option key={n} value={n}>{n / 12} {n === 12 ? 'round' : 'rounds'}</option>)}</select></label>
        <label>BASE SEED<span className="seed-row"><input type="number" min={0} max={2147483647} value={baseSeed} onChange={e => setBaseSeed(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} /><button type="button" className="seed-random" onClick={() => setBaseSeed(Math.floor(Math.random() * 1_000_000))}>🎲</button></span></label>
        {live && <label>PARALLEL BOUTS<select value={concurrency} onChange={e => setConcurrency(Number(e.target.value))}>{[1, 2, 3, 4, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>}
        <label className="inline"><input type="checkbox" checked={watch} onChange={e => setWatch(e.target.checked)} /> Watch every fight in the ring as it is played (one at a time, in order){watch && <select className="watch-speed" value={watchSpeed ?? 'fast'} onChange={e => setWatchSpeed(e.target.value === 'fast' ? null : Number(e.target.value))}>{[1, 2, 4, 8].map(s => <option key={s} value={s}>{s}×</option>)}<option value="fast">fast-forward</option></select>}</label>
        <label className="inline"><input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} /> Include mirror matches (a contender vs itself: pure luck baseline)</label>
      </fieldset>
    </div>
    <details className="seed-help"><summary>What does the seed do?</summary>
      <p><b>The seed fixes the dice</b>: whether each punch lands, is slipped, or knocks the opponent down. Both corners read the same dice, so two boxers making the same choices get the same luck, and the same seed with the same decisions replays the identical fight.</p>
      <p><b>It does not choose what the AI does.</b> Model decisions are not seeded, so a live fight can change from one run to the next even with the same seed (only the local Demo bots draw small variations from it).</p>
      <p><b>In a grid</b>, bout 1 of every pairing uses the base seed, bout 2 the next one, and so on. Each seed is boxed twice, once with each corner assignment, so a pairing is judged on identical luck from both corners, and every contender faces the same sequence of luck. Change the base seed to test a different set of dice.</p>
    </details>
    {estimate && <div className={'grid-estimate' + (tooBig ? ' over' : '')}>
      <b>{estimate.contenders} contenders</b> · {estimate.pairings} pairings · <b>{estimate.bouts} bouts</b> · up to {estimate.exchangesMax.toLocaleString()} exchanges
      {estimate.callsMax > 0 && <> · <b>up to {estimate.callsMax.toLocaleString()} paid API calls</b> (about {estimate.callsExpected.toLocaleString()} expected{estimate.minutes ? `, roughly ${estimate.minutes >= 90 ? Math.round(estimate.minutes / 60) + ' h' : estimate.minutes + ' min'}` : ''})</>}
      {tooBig && <p>Over the limit ({GRID_LIMITS.maxBouts} bouts, {GRID_LIMITS.maxLiveCalls.toLocaleString()} paid calls). Pick fewer models, personalities or bouts.</p>}
    </div>}
    <div className="grid-actions">
      {live && <label className="paid-confirm"><input type="checkbox" checked={confirm} disabled={running} onChange={e => setConfirm(e.target.checked)} /> I understand this makes many paid API calls.</label>}
      {running ? <button className="secondary-button" onClick={cancel}>CANCEL GRID</button> : <button className="primary-button" disabled={tooBig || needs || (live && !confirm) || personalities.length === 0 || (live && models.length === 0)} onClick={() => void run()}><Icon name="play" size={15} /> RUN GRID</button>}
    </div>
    {error && <p className="tournament-error">{error}</p>}
    {progress && <div className="grid-progress"><div className="bar"><i style={{ width: done * 100 + '%' }} /></div>
      <span>{progress.status.toUpperCase()} · {progress.completedBouts} / {progress.totalBouts} bouts · {progress.elapsedSeconds}s{progress.apiCalls ? ` · ${progress.apiCalls.toLocaleString()} API calls` : ''}</span>
      {progress.running.length > 0 && <small>NOW: {progress.running.slice(0, 3).join(' · ')}</small>}</div>}
    {analysis && analysis.bouts > 0 && progress && <div className="grid-results">
      <p className="grid-verdict"><Icon name="bolt" size={14} /> {analysis.verdict}{progress.completedBouts < progress.totalBouts ? ' (partial)' : ''}</p>
      <div className="grid-columns">
        <div><h4>LEADERBOARD</h4>
          <table className="grid-table"><thead><tr><th>#</th><th>FIGHTER</th><th>W-D-L</th><th>SCORE</th><th>95% CI</th><th title="Answers that were not a legal move; the referee made the boxer guard instead">ILLEGAL</th></tr></thead><tbody>
            {analysis.standings.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td>{s.name}</td><td>{s.wins}-{s.draws}-{s.losses}</td><td><b>{pct(s.scoreRate)}</b></td><td>{pct(s.ci95[0])}–{pct(s.ci95[1])}</td><td className={s.illegalMoves ? 'warn' : ''}>{s.illegalMoves}</td></tr>)}
          </tbody></table>
          <div className="grid-export"><button className="secondary-button" onClick={csv}>DOWNLOAD CSV</button>{progress.savedTo && <small>Full log saved to {progress.savedTo}</small>}</div>
        </div>
        <div className="effects">
          <EffectBars title="MODEL EFFECT" note="Same personality, different model. The only difference is the model." effects={analysis.modelEffect} />
          <EffectBars title="PERSONALITY EFFECT" note="Same model, different personality. The only difference is the personality." effects={analysis.personalityEffect} />
        </div>
      </div>
      <h4>HEAD TO HEAD <small>row's score against column · click a cell to load that fight into the ring</small></h4>
      <div className="heat-wrap"><table className="heat"><thead><tr><th />{progress.contenders.map(c => <th key={c.id} title={c.name}><span>{short(c)}</span></th>)}</tr></thead><tbody>
        {progress.contenders.map(r => <tr key={r.id}><th title={r.name}>{short(r)}</th>{progress.contenders.map(c => { const cell = analysis.matrix[r.id][c.id]; return <td key={c.id} style={{ background: heat(cell.score, cell.played) }} className={r.id === c.id ? 'mirror' : ''} title={`${r.name} vs ${c.name}: ${pct(cell.score)} over ${cell.played} bouts`} onClick={() => r.id !== c.id && onLoadMatchup(byId.get(r.id)!, byId.get(c.id)!)}>{cell.played ? pct(cell.score) : ''}</td>; })}</tr>)}
      </tbody></table></div>
    </div>}
  </section>;
}
