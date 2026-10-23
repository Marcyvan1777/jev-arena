import { useRef, useState } from "react";
import { PROVIDER_DISPLAY_NAMES } from "../../../shared/rules.js";
import type { ContenderSummary, MatchConfig, TournamentProgress, TournamentSummary } from "../../../shared/types.js";
import { api } from "../api.js";
import { Icon } from "./Icon.js";
import "./tournament.css";

const pause = () => new Promise<void>(resolve => window.setTimeout(resolve, 700));
const percent = (value: number) => Math.round(value * 100) + "%";

function Contender({ side, contender }: { side: "red" | "blue"; contender: ContenderSummary }) {
  const [low, high] = contender.ci95;
  return <div className={"contender " + side}><span>{contender.label}</span><b>{contender.wins} <small>WINS</small></b>
    <em title="Win rate counts a draw as half a win. The interval is a 95% Wilson confidence interval: the true rate probably lies inside it.">{percent(contender.winRate)} · 95% CI {percent(low)}–{percent(high)}{contender.illegalMoves ? ` · ${contender.illegalMoves} illegal moves` : ''}</em></div>;
}

export function Tournament({ config, disabled, onWatch }: { config: MatchConfig; disabled: boolean; onWatch: (id: string | null) => void }) {
  const live = config.mode !== "demo";
  const [fights, setFights] = useState(10), [confirmPaid, setConfirmPaid] = useState(false), [balanceCorners, setBalanceCorners] = useState(true), [running, setRunning] = useState(false), [watch, setWatch] = useState(true), [watchSpeed, setWatchSpeed] = useState<number | null>(2);
  const [progress, setProgress] = useState<TournamentProgress | null>(null), [result, setResult] = useState<TournamentSummary | null>(null), [error, setError] = useState<string | null>(null), job = useRef<string | null>(null);
  const limit = 100;
  const redName = live ? PROVIDER_DISPLAY_NAMES[config.providers.red] + " RED" : "DEMO RED";
  const blueName = live ? PROVIDER_DISPLAY_NAMES[config.providers.blue] + " BLUE" : "DEMO BLUE";
  const run = async () => {
    setRunning(true); setError(null); setResult(null); setProgress(null);
    try {
      let next = await api.startTournament(config, Math.min(fights, limit), confirmPaid, balanceCorners, watch ? { speed: watchSpeed } : undefined);
      job.current = next.id; setProgress(next); if (watch) onWatch(next.id);
      while (next.status === "running") { await pause(); next = await api.tournamentStatus(next.id); setProgress(next); }
      if (next.status === "cancelled") { setError("Tournament cancelled. Requests already sent may still be billed."); return; }
      if (next.status === "failed") throw new Error(next.error || "Tournament failed.");
      if (!next.summary) throw new Error("Tournament completed without a result.");
      setResult(next.summary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Tournament failed."); }
    finally { setRunning(false); job.current = null; onWatch(null); }
  };
  const cancel = () => { if (job.current) void api.cancelTournament(job.current).catch(() => undefined); };
  const accuracy = result?.punchesThrown ? Math.round(result.punchesLanded / result.punchesThrown * 100) : 0;
  const matchup = redName + " VS " + blueName;
  return <section className="panel tournament-panel"><div className="panel-heading"><span><Icon name="bolt" size={15} /> TOURNAMENT</span><span className="micro">{matchup}</span></div>
    <div className="tournament-controls"><label className="field-label" htmlFor="tournament-fights">EXACT BOUT COUNT · MAX {limit}</label><div><input id="tournament-fights" type="number" min={1} max={limit} value={fights} disabled={disabled || running} onChange={event => setFights(Math.max(1, Math.min(limit, Math.trunc(Number(event.target.value) || 1))))} />
      {running ? <button className="secondary-button" onClick={cancel}>CANCEL</button> : <button className="secondary-button" disabled={disabled || (live && !confirmPaid)} onClick={() => void run()}>RUN TOURNAMENT</button>}</div>
      <label className="paid-confirm"><input type="checkbox" checked={watch} disabled={disabled || running} onChange={event => setWatch(event.target.checked)} /> Watch every fight in the ring as it is played{watch && <select className="watch-speed" value={watchSpeed ?? 'fast'} disabled={running} onChange={event => setWatchSpeed(event.target.value === 'fast' ? null : Number(event.target.value))}>{[1, 2, 4, 8].map(s => <option key={s} value={s}>{s}×</option>)}<option value="fast">fast-forward</option></select>}</label>
      <label className="paid-confirm"><input type="checkbox" checked={balanceCorners} disabled={disabled || running} onChange={event => setBalanceCorners(event.target.checked)} /> Swap corners every other bout, so a corner advantage cannot decide the result.</label>
      {live && <label className="paid-confirm"><input type="checkbox" checked={confirmPaid} disabled={disabled || running} onChange={event => setConfirmPaid(event.target.checked)} /> I understand this makes paid API calls.</label>}
      {running && progress && <p className="tournament-progress">SIMULATING BOUT {progress.completedFights} / {progress.fights}. KEEP THIS TAB OPEN.</p>}</div>
    {error && <p className="tournament-error">{error}</p>}
    {result && <div className="tournament-results">
      <Contender side="red" contender={result.contenderA} /><Contender side="blue" contender={result.contenderB} />
      <div><b>{result.draws}</b><span>DRAWS</span></div><div><b>{result.knockouts + result.technicalKnockouts}</b><span>STOPPAGES</span></div><div><b>{result.judgesDecisions}</b><span>DECISIONS</span></div><div><b>{result.averageExchanges}</b><span>AVG EXCHANGES</span></div>
      <p>{result.fights} bouts · {result.balancedCorners ? "corners swapped every other bout" : "corners fixed"} · red corner won {result.redWins}, blue corner {result.blueWins} · {result.punchesThrown} punches/bout · {accuracy}% accuracy · {result.apiCalls} provider calls</p>
      {result.testType === "model-and-personality" && <p className="tournament-caution">Model and personality both differ in this setup, so a winner cannot be credited to either one alone. See the fairness audit.</p>}
      {result.fights < 30 && <p className="tournament-caution">With fewer than 30 bouts the interval is wide: treat a gap inside it as a tie, not a ranking.</p>}
      {result.savedTo && <p>Per-bout log saved to {result.savedTo}</p>}
    </div>}
  </section>;
}
