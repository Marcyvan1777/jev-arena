import { randomUUID } from 'node:crypto';
import type { Battlefield, BoutRecord, Decision, MatchConfig, MatchView, Provider, Side, TournamentProgress, TournamentSummary, Usage } from '../../shared/types.js';
import { SIDES } from '../../shared/types.js';
import { createBattle, legalActions, resolveTurn } from './game/engine.js';
import { demoDecision } from './ai/demoDecisionEngine.js';
import type { DecisionEngine } from './ai/jevDecisionEngine.js';
import { IllegalMoveError, PublicError } from './errors.js';
import { createRecorder } from './recorder.js';
import { wilson } from '../../shared/grid.js';
import type { GridSetup } from '../../shared/grid.js';
import { GridRunner } from './gridRunner.js';
import { LiveFeed } from './liveFeed.js';
import type { BoutObserver } from './liveFeed.js';
import { testTypeOf } from '../../shared/fairness.js';
import { auditFairness } from './game/fairness.js';
import type { Recorder } from './recorder.js';

interface Session { view: MatchView; abort?: AbortController; flight?: Promise<MatchView>;
  cached: Partial<Record<Side, Decision>>; touched: number; recorded?: boolean }
interface TournamentJob { progress: TournamentProgress; touched: number; abort: AbortController; feed?: LiveFeed }
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
const emptyUsage = (): Usage => ({ apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 });
export class MatchManager {
  private sessions = new Map<string, Session>();
  private tournaments = new Map<string, TournamentJob>();
  private realEngine: DecisionEngine;
  private recorder: Recorder;
  private grids: GridRunner;
  constructor(realEngine?: DecisionEngine, recorder: Recorder = createRecorder()) {
    this.recorder = recorder;
    this.grids = new GridRunner((config, signal, observer) => this.playBout(config, signal, observer), recorder);
    this.realEngine = realEngine ?? (async (...args) => (await import('./ai/jevDecisionEngine.js')).jevDecision(...args));
  }
  /**
   * Asks a model for its move. If it answers with something unusable (an illegal action, malformed JSON) the bout does NOT stop:
   * the boxer guards for that exchange, the fault is recorded and shown, and play goes on. Real failures (network, credentials,
   * rate limits) still raise, because nothing was decided.
   */
  private async decide(engine: DecisionEngine, snapshot: Battlefield, side: Side, context: Parameters<DecisionEngine>[2]): Promise<Decision> {
    try { return await engine(structuredClone(snapshot), side, context); }
    catch (error) {
      if (!(error instanceof IllegalMoveError) || context.signal.aborted) throw error;
      context.usage.illegalMoves = (context.usage.illegalMoves ?? 0) + 1;
      return { robot: side, action: 'GUARD', source: this.provider(snapshot.config, side), round: snapshot.round + 1, latencyMs: 0, legalActions: legalActions(snapshot, side), fallback: { reason: error.message, attempted: error.attempted } };
    }
  }
  private provider(config: MatchConfig, side: Side): Provider { return config.mode === 'demo' ? 'demo' : config.providers[side]; }
  private async engine(provider: Provider): Promise<DecisionEngine> {
    if (provider === 'demo') return demoDecision;
    if (provider === 'jev') return this.realEngine;
    return (await import('./ai/providerDecisionEngine.js')).externalDecision(provider);
  }
  create(config: MatchConfig): MatchView {
    this.prune();
    if (this.sessions.size >= 100) throw new PublicError('Too many local sessions. Restart the server to clear them.', 429);
    const view: MatchView = { id: randomUUID(), generation: 0, state: createBattle(config), usage: emptyUsage(), pending: false, paused: true, error: null };
    this.sessions.set(view.id, { view, cached: {}, touched: Date.now() });
    return structuredClone(view);
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new PublicError('Match not found or expired. Start a new battle.', 404);
    session.touched = Date.now(); return session;
  }
  get(id: string) { return structuredClone(this.session(id).view); }
  async pause(id: string) {
    const s = this.session(id); s.view.paused = true;
    // Invalidate first; a completion arriving during abort can never commit.
    s.view.generation++; s.abort?.abort(); s.cached = {}; s.view.error = null;
    await s.flight?.catch(() => undefined);
    return this.get(id);
  }
  resume(id: string) { const s = this.session(id); s.view.paused = false; s.view.error = null; return this.get(id); }
  async reset(id: string, config: MatchConfig) {
    const s = this.session(id); await this.pause(id);
    await s.flight?.catch(() => undefined);
    s.view = { id, generation: s.view.generation, state: createBattle(config), usage: emptyUsage(), pending: false, paused: true, error: null };
    s.cached = {}; s.recorded = false; return this.get(id);
  }
  /** Everything needed to analyse or replay a fight later: setup, per-round cards, every decision and the event log. */
  private exportMatch(view: MatchView) {
    const { state } = view;
    return { id: view.id, config: state.config, testType: testTypeOf(state.config), usage: view.usage, winner: state.winner, finishReason: state.finishReason, exchanges: state.round, cards: state.cards, stats: { red: state.robots.red.stats, blue: state.robots.blue.stats }, decisions: state.decisions, events: state.events };
  }
  export(id: string) { return this.exportMatch(this.session(id).view); }
  async turn(id: string, round: number, generation: number, step = false): Promise<MatchView> {
    const s = this.session(id);
    if (generation !== s.view.generation) throw new PublicError('Stale match generation. Refresh the match.', 409);
    if (round < s.view.state.round) return this.get(id); // Idempotent retry of an already committed round.
    if (round !== s.view.state.round) throw new PublicError('Round does not match the current state.', 409);
    if (s.flight) return s.flight;
    if (s.view.state.status === 'finished') return this.get(id);
    if (s.view.paused && !step) throw new PublicError('Match is paused.', 409);
    s.view.pending = true; s.view.error = null; s.abort = new AbortController();
    const abort = s.abort, snapshot = structuredClone(s.view.state), usage = s.view.usage;
    const work = async () => {
      try {
        const results = await Promise.allSettled(SIDES.map(async side => {
          if (s.cached[side]) return s.cached[side]!;
          const engine = await this.engine(this.provider(snapshot.config, side));
          const decision = await this.decide(engine, snapshot, side, { signal: abort.signal, usage, maxCalls: snapshot.config.maxRounds * 4 + 8 });
          if (!abort.signal.aborted && generation === s.view.generation) s.cached[side] = decision;
          return decision;
        }));
        if (abort.signal.aborted || generation !== s.view.generation) throw new PublicError('Turn cancelled.', 409);
        const failed = results.find(r => r.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        const red = s.cached.red!, blue = s.cached.blue!;
        s.view.state = resolveTurn(snapshot, { red: red.action, blue: blue.action }, [red, blue]);
        s.cached = {};
        if (s.view.state.status === 'finished' && !s.recorded) { s.recorded = true; void this.recorder.save('match', id, this.exportMatch(s.view)); }
      } catch (error) {
        if (!abort.signal.aborted && generation === s.view.generation) {
          s.view.paused = true;
          s.view.error = error instanceof PublicError ? error.message : 'Decision failed. Retry this turn.';
        }
        throw error;
      } finally {
        s.view.pending = false; s.flight = undefined; s.abort = undefined;
      }
      return this.get(id);
    };
    s.flight = work(); return s.flight;
  }
  /** Plays one bout to the end. A provider hiccup (HTTP 502) is retried twice before the bout is given up on. */
  async playBout(config: MatchConfig, signal: AbortSignal, observer?: BoutObserver): Promise<{ state: Battlefield; usage: Usage }> {
    let state = createBattle(config);
    const usage = emptyUsage();
    if (observer) { observer.start(state); await sleep(observer.delayMs(state), signal); }
    while (state.status !== 'finished') {
      const snapshot = state;
      const decide = async (side: Side) => {
        const engine = await this.engine(this.provider(snapshot.config, side));
        for (let attempt = 0; ; attempt++) {
          try { return await this.decide(engine, snapshot, side, { signal, usage, maxCalls: snapshot.config.maxRounds * 4 + 8 }); }
          catch (error) {
            if (signal.aborted || !(error instanceof PublicError) || error.status !== 502 || attempt >= 2) throw error;
            await sleep(1200 * (attempt + 1), signal);
          }
        }
      };
      const [red, blue] = await Promise.all(SIDES.map(decide));
      signal.throwIfAborted();
      // Local bots answer instantly, which would otherwise keep the server busy until the whole grid ends and starve progress polls and cancels.
      await new Promise<void>(resolve => setImmediate(resolve));
      state = resolveTurn(snapshot, { red: red.action, blue: blue.action }, [red, blue]);
      // When someone is watching, the simulation runs at the pace of the animation.
      if (observer) { observer.onState(state); await sleep(observer.delayMs(state), signal); }
    }
    return { state, usage };
  }
  startGrid(setup: GridSetup, watch?: { speed: number | null }) { return this.grids.start(setup, watch); }
  /** The bout of a watched tournament or grid that is on show; `after` is the last exchange the browser already has. */
  getLive(id: string, key: string, after: number) {
    const feed = this.tournaments.get(id)?.feed ?? this.grids.feed(id);
    if (!feed) throw new PublicError('Nothing to watch for that job.', 404);
    return feed.read(key, after);
  }
  /** Change how fast a watched simulation plays (null = fast-forward). */
  setPace(id: string, speed: number | null) {
    const feed = this.tournaments.get(id)?.feed ?? this.grids.feed(id);
    if (!feed) throw new PublicError('Nothing to watch for that job.', 404);
    feed.speed = speed; return { speed };
  }
  getGrid(id: string) { return this.grids.get(id); }
  cancelGrid(id: string) { return this.grids.cancel(id); }

  async tournament(config: MatchConfig, fights: number, onFightComplete?: (completed: number) => void, signal: AbortSignal = new AbortController().signal, balanceCorners = true, feed?: LiveFeed): Promise<TournamentSummary> {
    const label = (side: Side) => config[side].name;
    const summary: TournamentSummary = { fights, redWins: 0, blueWins: 0, draws: 0, knockouts: 0, technicalKnockouts: 0, judgesDecisions: 0, averageExchanges: 0, punchesThrown: 0, punchesLanded: 0, apiCalls: 0, balancedCorners: balanceCorners, testType: testTypeOf(config),
      contenderA: { label: label('red'), wins: 0, winRate: 0, ci95: [0, 0] }, contenderB: { label: label('blue'), wins: 0, winRate: 0, ci95: [0, 0] }, bouts: [] };
    const logs: unknown[] = [];
    for (let index = 0; index < fights; index++) {
      signal.throwIfAborted();
      // Contender A starts in the red corner; with balanced corners the two swap places every other bout.
      const swapped = balanceCorners && index % 2 === 1, seed = (config.seed + index) % 2147483647;
      const boutConfig: MatchConfig = swapped
        ? { ...structuredClone(config), seed, red: structuredClone(config.blue), blue: structuredClone(config.red), providers: { red: config.providers.blue, blue: config.providers.red } }
        : { ...structuredClone(config), seed };
      feed?.prepare(String(index), `BOUT ${index + 1} / ${fights}: ${boutConfig.red.name} (red) vs ${boutConfig.blue.name} (blue)`, index + 1);
      const { state, usage } = await this.playBout(boutConfig, signal, feed?.observer());
      feed?.end();
      const aSide: Side = swapped ? 'blue' : 'red', bSide: Side = swapped ? 'red' : 'blue';
      const winner: BoutRecord['winner'] = state.winner === 'draw' || state.winner === null ? 'draw' : state.winner === aSide ? 'A' : 'B';
      if (state.winner === 'red') summary.redWins++; else if (state.winner === 'blue') summary.blueWins++; else summary.draws++;
      if (winner === 'A') summary.contenderA.wins++; else if (winner === 'B') summary.contenderB.wins++;
      if (state.finishReason?.includes('Technical knockout')) summary.technicalKnockouts++;
      else if (state.finishReason?.includes('Knockout')) summary.knockouts++;
      else summary.judgesDecisions++;
      summary.averageExchanges += state.round;
      for (const side of SIDES) { summary.punchesThrown += state.robots[side].stats.punchesThrown; summary.punchesLanded += state.robots[side].stats.punchesLanded; }
      summary.apiCalls += usage.apiCalls;
      summary.bouts.push({ index, seed, aIsRed: !swapped, winner, reason: state.finishReason ?? '', exchanges: state.round, hp: { A: state.robots[aSide].hp, B: state.robots[bSide].hp }, apiCalls: usage.apiCalls, illegal: { A: state.robots[aSide].stats.illegalMoves, B: state.robots[bSide].stats.illegalMoves } });
      summary.contenderA.illegalMoves = (summary.contenderA.illegalMoves ?? 0) + state.robots[aSide].stats.illegalMoves; summary.contenderB.illegalMoves = (summary.contenderB.illegalMoves ?? 0) + state.robots[bSide].stats.illegalMoves;
      logs.push({ index, seed, config: state.config, cards: state.cards, decisions: state.decisions.map(d => ({ round: d.round, robot: d.robot, action: d.action, source: d.source, model: d.model, latencyMs: d.latencyMs, selectedProbability: d.selectedProbability })) });
      onFightComplete?.(index + 1);
    }
    summary.averageExchanges = Number((summary.averageExchanges / fights).toFixed(2));
    summary.punchesThrown = Number((summary.punchesThrown / fights).toFixed(2));
    summary.punchesLanded = Number((summary.punchesLanded / fights).toFixed(2));
    for (const contender of [summary.contenderA, summary.contenderB]) {
      const score = contender.wins + summary.draws / 2; // a draw counts as half a win for both contenders
      contender.winRate = Number((score / fights).toFixed(3)); contender.ci95 = wilson(score, fights);
    }
    summary.savedTo = await this.recorder.save('tournament', randomUUID(), { config, fairness: auditFairness(config), summary, bouts: logs });
    return summary;
  }
  startTournament(config: MatchConfig, fights: number, balanceCorners = true, watch?: { speed: number | null }): TournamentProgress {
    this.prune();
    const id = randomUUID(), abort = new AbortController(), feed = watch ? new LiveFeed(watch.speed, fights) : undefined, job: TournamentJob = { progress: { id, status: "running", completedFights: 0, fights }, touched: Date.now(), abort, feed };
    this.tournaments.set(id, job);
    void this.tournament(config, fights, completed => { job.progress.completedFights = completed; job.touched = Date.now(); }, abort.signal, balanceCorners, feed)
      .then(summary => { job.progress = { ...job.progress, status: "finished", completedFights: fights, summary }; job.touched = Date.now(); })
      .catch(error => {
        job.touched = Date.now();
        if (abort.signal.aborted) { job.progress = { ...job.progress, status: "cancelled" }; return; }
        job.progress = { ...job.progress, status: "failed", error: error instanceof PublicError ? error.message : "Tournament failed. Check provider configuration and retry." };
      });
    return structuredClone(job.progress);
  }
  cancelTournament(id: string): TournamentProgress {
    const job = this.tournaments.get(id);
    if (!job) throw new PublicError("Tournament not found or expired.", 404);
    if (job.progress.status === "running") { job.abort.abort(); job.progress = { ...job.progress, status: "cancelled" }; }
    job.touched = Date.now(); return structuredClone(job.progress);
  }
  getTournament(id: string): TournamentProgress {
    const job = this.tournaments.get(id);
    if (!job) throw new PublicError("Tournament not found or expired.", 404);
    job.touched = Date.now(); return structuredClone(job.progress);
  }
  prune() {
    for (const [id, s] of this.sessions) if (!s.view.pending && Date.now() - s.touched > 3600000) this.sessions.delete(id);
    for (const [id, job] of this.tournaments) if (job.progress.status !== "running" && Date.now() - job.touched > 3600000) this.tournaments.delete(id);
  }
}
