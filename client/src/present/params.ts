import type { MatchConfig, Personality, Provider } from '../../../shared/types.js';
import { PERSONALITIES, PROVIDERS } from '../../../shared/types.js';
import type { CameraMode } from '../game/cameraModes.js';

/**
 * Presentation mode, configured from the address bar so a fight can be set up and filmed without touching the interface.
 * Example: /?present=1&mode=jev&red=jev&blue=claude&redStyle=TACTICIAN&blueStyle=TACTICIAN&seed=42&speed=1&autostart=1
 */
export interface PresentParams { present: boolean; overlay: boolean; mode?: 'jev' | 'demo'; red?: Provider; blue?: Provider; redStyle?: Personality; blueStyle?: Personality; seed?: number; rounds?: number; speed?: number; autostart: boolean; cam?: CameraMode; grid?: string }

const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined => allowed.includes(value as T) ? value as T : undefined;
const number = (value: string | null) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;

export const presentParams: PresentParams = {
  present: query.get('present') === '1', overlay: query.get('present') === '1' || query.get('vo') === '1',
  mode: pick(query.get('mode'), ['jev', 'demo'] as const), red: pick(query.get('red'), PROVIDERS), blue: pick(query.get('blue'), PROVIDERS),
  redStyle: pick(query.get('redStyle'), PERSONALITIES), blueStyle: pick(query.get('blueStyle'), PERSONALITIES),
  seed: number(query.get('seed')), rounds: number(query.get('rounds')), speed: number(query.get('speed')), autostart: query.get('autostart') === '1',
  cam: pick(query.get('cam'), ['broadcast', 'red', 'blue', 'orbit', 'hall', 'free'] as const), grid: query.get('grid') ?? undefined,
};

export function applyParams(base: MatchConfig): MatchConfig {
  const p = presentParams, next = structuredClone(base);
  if (p.mode) next.mode = p.mode;
  if (p.red) next.providers.red = p.red;
  if (p.blue) next.providers.blue = p.blue;
  if (p.redStyle) next.red.personality = p.redStyle;
  if (p.blueStyle) next.blue.personality = p.blueStyle;
  if (p.seed !== undefined) next.seed = p.seed;
  if (p.rounds !== undefined) next.maxRounds = p.rounds;
  return next;
}
