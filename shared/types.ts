export const SIDES = ['red', 'blue'] as const;
export type Side = typeof SIDES[number];
export const ACTIONS = ['JAB', 'CROSS', 'HOOK', 'UPPERCUT', 'GUARD', 'SLIP', 'COUNTER', 'STEP_IN', 'STEP_BACK', 'CLINCH'] as const;
export type Action = typeof ACTIONS[number];
export const PUNCH_ACTIONS = ['JAB', 'CROSS', 'HOOK', 'UPPERCUT', 'COUNTER'] as const;
export type PunchAction = typeof PUNCH_ACTIONS[number];
export const PERSONALITIES = ['BERSERKER', 'COUNTERPUNCHER', 'TACTICIAN', 'TRICKSTER', 'COWARD'] as const;
export type Personality = typeof PERSONALITIES[number];
export type Mode = 'jev' | 'demo';
export const PROVIDERS = ['jev', 'openai', 'claude', 'demo'] as const;
export type Provider = typeof PROVIDERS[number];
export type Layout = 'championship';
export interface Point { x: number; y: number }
export interface Obstacle extends Point { w: number; h: number }
export interface RobotStats { damage: number; punchesThrown: number; punchesLanded: number; cleanHits: number; blocks: number; dodges: number; counters: number; clinches: number; illegalMoves: number; knockdowns: number; actions: Partial<Record<Action, number>> }
export interface Robot { side: Side; name: string; color: string; personality: Personality; hp: number; stamina: number; position: Point; attackPower: number; defense: number; speed: number; specialAbility: string; cooldown: number; action: Action | 'IDLE'; vulnerability: number; knockdownsTaken: number; history: Action[]; combo: Action | null; clinchStreak: number; deduction: number; stats: RobotStats }
export interface MatchConfig { mode: Mode; providers: Record<Side, Provider>; layout: Layout; seed: number; maxRounds: number; red: { name: string; personality: Personality }; blue: { name: string; personality: Personality } }
export interface Decision { robot: Side; action: Action; source: Provider; round: number; probabilities?: Partial<Record<Action, number>>; selectedProbability?: number; latencyMs: number; model?: string; legalActions: Action[];
  /** Set when the model gave no usable move and the referee made this boxer guard instead. */
  fallback?: { reason: string; attempted: string } }
export interface BattleEvent { round: number; kind: 'hit' | 'block' | 'dodge' | 'miss' | 'move' | 'counter' | 'knockdown' | 'referee' | 'bell' | 'finish'; actor?: Side; target?: Side; amount?: number; combo?: boolean; message: string }
/** One judge's card for a completed boxing round (10-point-must style). */
export interface RoundCard { round: number; red: number; blue: number; note: string; judges: Array<{ red: number; blue: number }>; deductions: { red: number; blue: number } }
export interface Battlefield { round: number; config: MatchConfig; robots: Record<Side, Robot>; obstacles: Obstacle[]; status: 'ready' | 'active' | 'finished'; winner: Side | 'draw' | null; finishReason: string | null; idleRounds: number; overtimeTurns: number; boxingRound: number; roundBaseline: Record<Side, { score: number; knockdowns: number; judges: number[] }>; cards: RoundCard[]; events: BattleEvent[]; decisions: Decision[] }
export interface Usage { apiCalls: number; completedDecisions: number; failedDecisions: number; totalLatencyMs: number; illegalMoves?: number }
export interface MatchView { id: string; generation: number; state: Battlefield; usage: Usage; pending: boolean; paused: boolean; error: string | null }
export interface ContenderSummary { label: string; wins: number; winRate: number; ci95: [number, number]; illegalMoves?: number }
export interface BoutRecord { index: number; seed: number; aIsRed: boolean; winner: 'A' | 'B' | 'draw'; reason: string; exchanges: number; hp: { A: number; B: number }; apiCalls: number; illegal?: { A: number; B: number } }
export interface TournamentSummary { fights: number; redWins: number; blueWins: number; draws: number; knockouts: number; technicalKnockouts: number; judgesDecisions: number; averageExchanges: number; punchesThrown: number; punchesLanded: number; apiCalls: number;
  /** Contender A is the red-corner setup, B the blue-corner setup; with balanced corners they swap sides every other bout. */
  balancedCorners: boolean; testType: 'identical' | 'model-only' | 'personality-only' | 'model-and-personality'; contenderA: ContenderSummary; contenderB: ContenderSummary; bouts: BoutRecord[]; savedTo?: string }
export interface TournamentProgress { id: string; status: 'running' | 'finished' | 'failed' | 'cancelled'; completedFights: number; fights: number; summary?: TournamentSummary; error?: string }
export const opponent = (side: Side): Side => side === 'red' ? 'blue' : 'red';
