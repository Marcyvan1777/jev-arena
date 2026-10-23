import express from 'express';
import { z } from 'zod';
import { PERSONALITIES, PROVIDERS } from '../../shared/types.js';
import { config, hasApiKey, hasClaudeKey, hasOpenAiKey } from './config.js';
import { MatchManager } from './matchManager.js';
import { PublicError } from './errors.js';
import { auditFairness } from './game/fairness.js';
import { GRID_LIMITS, buildContenders, estimateGrid } from '../../shared/grid.js';

const robot = z.object({ name: z.string().trim().min(1).max(40), personality: z.enum(PERSONALITIES) });
export const matchSchema = z.object({ mode: z.enum(['jev', 'demo']), layout: z.literal('championship'),
  providers: z.object({ red: z.enum(PROVIDERS), blue: z.enum(PROVIDERS) }),
  seed: z.number().int().min(0).max(2147483647), maxRounds: z.number().int().min(10).max(config.maxRounds), red: robot, blue: robot });
const gridSchema = z.object({
  mode: z.enum(['jev', 'demo']), models: z.array(z.enum(PROVIDERS)).min(1).max(4), personalities: z.array(z.enum(PERSONALITIES)).min(1),
  boutsPerPairing: z.number().int().min(2).max(GRID_LIMITS.maxBoutsPerPairing).refine(n => n % 2 === 0, 'Use an even number so each corner assignment is boxed equally.'),
  maxRounds: z.number().int().min(12).max(config.maxRounds), baseSeed: z.number().int().min(0).max(2147483647), includeMirror: z.boolean(), concurrency: z.number().int().min(1).max(6),
});
/** Watching a simulation: its speed (animation speed multiple), or null to fast-forward. */
const watchSchema = z.object({ speed: z.number().min(1).max(16).nullable() });
const keyReady = (provider: string) => provider === 'jev' ? hasApiKey() : provider === 'openai' ? hasOpenAiKey() : provider === 'claude' ? hasClaudeKey() : true;
export function createApp(manager = new MatchManager()) {
  const app = express(); app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const allowed = new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, 'http://127.0.0.1:5173', 'http://localhost:5173']);
    if (req.headers.origin && !allowed.has(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, jevConfigured: hasApiKey(), openaiConfigured: hasOpenAiKey(), claudeConfigured: hasClaudeKey(), model: config.model, maxRounds: config.maxRounds }));
  app.post('/api/fairness', (req, res) => res.json(auditFairness(matchSchema.parse(req.body))));
  app.get('/api/live/:id', (req, res) => res.json(manager.getLive(req.params.id, String(req.query.key ?? ''), Number(req.query.after ?? -1))));
  app.post('/api/live/:id/pace', (req, res) => res.json(manager.setPace(req.params.id, z.object({ speed: z.number().min(1).max(16).nullable() }).parse(req.body).speed)));
  app.post('/api/grid/estimate', (req, res) => res.json(estimateGrid(gridSchema.parse(req.body))));
  app.post('/api/grid', (req, res) => {
    const body = z.object({ setup: gridSchema, confirmPaid: z.boolean().default(false), watch: watchSchema.optional() }).parse(req.body), { setup } = body;
    const estimate = estimateGrid(setup), live = estimate.callsMax > 0;
    if (estimate.bouts < 1) throw new PublicError('A grid needs at least two contenders (or mirror matches switched on).', 400);
    if (estimate.bouts > GRID_LIMITS.maxBouts) throw new PublicError(`That grid is ${estimate.bouts} bouts; the limit is ${GRID_LIMITS.maxBouts}. Choose fewer models, personalities or bouts per pairing.`, 400);
    if (live) {
      if (!body.confirmPaid) throw new PublicError('Confirm the paid live grid before provider calls can start.', 400);
      if (estimate.callsMax > GRID_LIMITS.maxLiveCalls) throw new PublicError(`That grid could make up to ${estimate.callsMax} paid API calls; the limit is ${GRID_LIMITS.maxLiveCalls}.`, 400);
      const missing = buildContenders(setup).map(c => c.provider).filter((p, i, all) => all.indexOf(p) === i && !keyReady(p));
      if (missing.length) throw new PublicError(`Missing API key on the server for: ${missing.join(', ')}.`, 400);
    }
    res.status(202).json(manager.startGrid(setup, body.watch));
  });
  app.get('/api/grid/:id', (req, res) => res.json(manager.getGrid(req.params.id)));
  app.delete('/api/grid/:id', (req, res) => res.json(manager.cancelGrid(req.params.id)));
  app.post('/api/matches', (req, res) => res.status(201).json(manager.create(matchSchema.parse(req.body))));
  app.post('/api/tournaments', async (req, res) => {
    const body = z.object({ config: matchSchema, fights: z.number().int().min(1).max(100), confirmPaid: z.boolean().default(false), balanceCorners: z.boolean().default(true), watch: watchSchema.optional() }).parse(req.body);
    if (body.config.mode !== 'demo' && !body.confirmPaid) throw new PublicError('Confirm paid live tournament before provider calls can start.', 400);
    res.status(202).json(manager.startTournament(body.config, body.fights, body.balanceCorners, body.watch));
  });
  app.get('/api/tournaments/:id', (req, res) => res.json(manager.getTournament(req.params.id)));
  app.delete('/api/tournaments/:id', (req, res) => res.json(manager.cancelTournament(req.params.id)));
  app.get('/api/matches/:id/export', (req, res) => res.json(manager.export(req.params.id)));
  app.get('/api/matches/:id', (req, res) => res.json(manager.get(req.params.id)));
  app.post('/api/matches/:id/turn', async (req, res) => {
    const body = z.object({ round: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), step: z.boolean().default(false) }).parse(req.body);
    res.json(await manager.turn(req.params.id, body.round, body.generation, body.step));
  });
  app.post('/api/matches/:id/pause', async (req, res) => res.json(await manager.pause(req.params.id)));
  app.post('/api/matches/:id/resume', (req, res) => res.json(manager.resume(req.params.id)));
  app.post('/api/matches/:id/reset', async (req, res) => res.json(await manager.reset(req.params.id, matchSchema.parse(req.body))));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid match settings or request. Check names, providers, personalities, seed and round limit.' });
    // Never forward provider errors, request bodies, stack traces or credentials.
    res.status(error instanceof PublicError ? error.status : 500).json({ error: error instanceof PublicError ? error.message : 'Server error. Check configuration and retry.' });
  });
  return app;
}
