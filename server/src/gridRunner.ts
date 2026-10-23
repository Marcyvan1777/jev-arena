import { randomUUID } from 'node:crypto';
import type { Battlefield, MatchConfig, Usage } from '../../shared/types.js';
import { DEFAULT_CONFIG } from '../../shared/rules.js';
import { analyseGrid, buildContenders, buildPairings, estimateGrid } from '../../shared/grid.js';
import type { Contender, GridBout, GridEstimate, GridProgress, GridSetup } from '../../shared/grid.js';
import { PublicError } from './errors.js';
import type { Recorder } from './recorder.js';
import { LiveFeed } from './liveFeed.js';

export type PlayBout = (config: MatchConfig, signal: AbortSignal, observer?: ReturnType<LiveFeed['observer']>) => Promise<{ state: Battlefield; usage: Usage }>;
interface Job { id: string; setup: GridSetup; contenders: Contender[]; estimate: GridEstimate; bouts: GridBout[]; total: number; running: Map<number, string>; status: GridProgress['status']; abort: AbortController; started: number; finished?: number; touched: number; apiCalls: number; error?: string; savedTo?: string; feed?: LiveFeed }

/**
 * Round-robin "grid search": every model-and-personality contender meets every other. Bouts are scheduled round by round
 * (bout 1 of every pairing, then bout 2 of every pairing...) so stopping early still leaves a balanced result, and
 * bout k of every pairing uses the same seed, once with each corner assignment, so all contenders face the same luck.
 */
export class GridRunner {
  private jobs = new Map<string, Job>();
  // Plain fields (not constructor parameter properties) so the dependency-free offline suite can run this file with Node's type stripping.
  private play: PlayBout; private recorder: Recorder;
  constructor(play: PlayBout, recorder: Recorder) { this.play = play; this.recorder = recorder; }

  feed(id: string) { return this.jobs.get(id)?.feed; }
  start(setup: GridSetup, watch?: { speed: number | null }): GridProgress {
    this.prune();
    const contenders = buildContenders(setup), pairings = buildPairings(contenders, setup.includeMirror);
    if (pairings.length === 0) throw new PublicError('A grid needs at least two contenders (or mirror matches switched on).', 400);
    const estimate = estimateGrid(setup);
    const job: Job = { id: randomUUID(), setup, contenders, estimate, bouts: [], total: estimate.bouts, running: new Map(), status: 'running', abort: new AbortController(), started: Date.now(), touched: Date.now(), apiCalls: 0, feed: watch ? new LiveFeed(watch.speed, estimate.bouts) : undefined };
    this.jobs.set(job.id, job);
    void this.run(job, pairings);
    return this.view(job);
  }

  get(id: string) { const job = this.jobs.get(id); if (!job) throw new PublicError('Grid not found or expired.', 404); job.touched = Date.now(); return this.view(job); }
  cancel(id: string) {
    const job = this.jobs.get(id); if (!job) throw new PublicError('Grid not found or expired.', 404);
    if (job.status === 'running') { job.status = 'cancelled'; job.finished = Date.now(); job.abort.abort(); }
    job.touched = Date.now(); return this.view(job);
  }
  prune() { for (const [id, job] of this.jobs) if (job.status !== 'running' && Date.now() - job.touched > 3600000) this.jobs.delete(id); }

  private view(job: Job): GridProgress {
    return { id: job.id, status: job.status, setup: job.setup, contenders: job.contenders, estimate: job.estimate, completedBouts: job.bouts.length, totalBouts: job.total, apiCalls: job.apiCalls, running: [...job.running.values()],
      analysis: analyseGrid(job.contenders, job.bouts), elapsedSeconds: Math.round(((job.finished ?? Date.now()) - job.started) / 1000), error: job.error, savedTo: job.savedTo };
  }

  private async run(job: Job, pairings: Array<[Contender, Contender]>) {
    const { setup } = job, tasks: Array<{ pairing: number; k: number }> = [];
    for (let k = 0; k < setup.boutsPerPairing; k++) for (let p = 0; p < pairings.length; p++) tasks.push({ pairing: p, k });
    let next = 0, slot = 0;
    const worker = async () => {
      const id = slot++;
      while (job.status === 'running') {
        const task = tasks[next++]; if (!task) return;
        const [a, b] = pairings[task.pairing], aIsRed = task.k % 2 === 0, seed = (setup.baseSeed + Math.floor(task.k / 2)) % 2147483647, red = aIsRed ? a : b, blue = aIsRed ? b : a;
        job.running.set(id, `${a.name} vs ${b.name}`);
        // Only one bout can be on show; with parallel bouts it is the first worker's.
        const watched = id === 0 ? job.feed : undefined;
        watched?.prepare(`${task.pairing}:${task.k}`, `BOUT ${next} / ${job.total}: ${red.name} (red) vs ${blue.name} (blue)`, next);
        const config: MatchConfig = { ...DEFAULT_CONFIG, mode: setup.mode, seed, maxRounds: setup.maxRounds, providers: { red: red.provider, blue: blue.provider }, red: { name: red.name, personality: red.personality }, blue: { name: blue.name, personality: blue.personality } };
        try {
          const { state, usage } = await this.play(config, job.abort.signal, watched?.observer());
          watched?.end();
          const aSide = aIsRed ? 'red' : 'blue', bSide = aIsRed ? 'blue' : 'red', reason = state.finishReason ?? '';
          const winner = state.winner === 'draw' || state.winner === null ? 'draw' : state.winner === aSide ? 'A' : 'B';
          const kind = winner === 'draw' ? 'draw' : /^Technical/.test(reason) ? 'tko' : /^Knockout/.test(reason) ? 'ko' : 'decision';
          job.apiCalls += usage.apiCalls;
          job.bouts.push({ pairing: task.pairing, a: a.id, b: b.id, aIsRed, seed, winner, kind, reason, exchanges: state.round, hpA: state.robots[aSide].hp, hpB: state.robots[bSide].hp, apiCalls: usage.apiCalls, illegalA: state.robots[aSide].stats.illegalMoves, illegalB: state.robots[bSide].stats.illegalMoves });
        } catch (error) {
          if (job.status !== 'running') return;
          job.status = 'failed'; job.finished = Date.now(); job.abort.abort();
          job.error = error instanceof PublicError ? error.message : 'A bout failed. Check provider configuration and retry.';
          return;
        } finally { job.running.delete(id); }
      }
    };
    // Watching a fight means playing them one at a time, in order; otherwise local bots run four at once.
    const live = setup.mode !== 'demo', workers = job.feed && !live ? 1 : live ? setup.concurrency : 4;
    await Promise.all(Array.from({ length: workers }, worker));
    if (job.status === 'running') { job.status = 'finished'; job.finished = Date.now(); }
    job.touched = Date.now();
    // Save even a failed or cancelled grid: the finished bouts are real data.
    if (job.bouts.length) job.savedTo = await this.recorder.save('tournament', job.id, { kind: 'grid', setup: job.setup, status: job.status, contenders: job.contenders, analysis: analyseGrid(job.contenders, job.bouts), bouts: job.bouts });
  }
}
