import type { MatchConfig, MatchView, TournamentProgress } from '../../shared/types.js';
import type { FairnessReport } from '../../shared/fairness.js';
import type { GridEstimate, GridProgress, GridSetup } from '../../shared/grid.js';
import type { Battlefield } from '../../shared/types.js';
export type Watch = { speed: number | null } | undefined;
export interface LivePacket { key: string; label: string; index: number; total: number; states: Battlefield[]; done: boolean; speed: number | null }
export type { GridProgress };
export async function request<T>(path: string, body?: unknown, method?: 'DELETE'): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(70000),
  });
  const data = await res.json().catch(() => ({ error: 'Backend unavailable. Run npm run dev from the project root.' }));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
export const api = {
  create: (config: MatchConfig) => request<MatchView>('/matches', config),
  get: (id: string) => request<MatchView>(`/matches/${id}`),
  turn: (view: MatchView, step: boolean) => request<MatchView>(`/matches/${view.id}/turn`, { round: view.state.round, generation: view.generation, step }),
  pause: (id: string) => request<MatchView>(`/matches/${id}/pause`, {}),
  resume: (id: string) => request<MatchView>(`/matches/${id}/resume`, {}),
  reset: (id: string, config: MatchConfig) => request<MatchView>(`/matches/${id}/reset`, config),
  startTournament: (config: MatchConfig, fights: number, confirmPaid = false, balanceCorners = true, watch?: Watch) => request<TournamentProgress>('/tournaments', { config, fights, confirmPaid, balanceCorners, watch }),
  live: (id: string, key: string, after: number) => request<LivePacket>(`/live/${id}?key=${encodeURIComponent(key)}&after=${after}`),
  pace: (id: string, speed: number | null) => request<{ speed: number | null }>(`/live/${id}/pace`, { speed }),
  gridEstimate: (setup: GridSetup) => request<GridEstimate>('/grid/estimate', setup),
  gridStart: (setup: GridSetup, confirmPaid: boolean, watch?: Watch) => request<GridProgress>('/grid', { setup, confirmPaid, watch }),
  gridStatus: (id: string) => request<GridProgress>('/grid/' + id),
  gridCancel: (id: string) => request<GridProgress>('/grid/' + id, undefined, 'DELETE'),
  fairness: (config: MatchConfig) => request<FairnessReport>('/fairness', config),
  tournamentStatus: (id: string) => request<TournamentProgress>('/tournaments/' + id),
  cancelTournament: (id: string) => request<TournamentProgress>('/tournaments/' + id, undefined, 'DELETE'),
};
