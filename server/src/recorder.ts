import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Writes finished matches and tournaments to local JSON files so a run can be analysed afterwards. */
export interface Recorder { save(kind: 'match' | 'tournament', id: string, data: unknown): Promise<string | undefined> }

export function createRecorder(directory = process.env.RESULTS_DIR || 'results'): Recorder {
  return {
    async save(kind, id, data) {
      if (process.env.JEV_RECORD === '0') return undefined;
      try {
        await mkdir(directory, { recursive: true });
        const file = join(directory, `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}.json`);
        await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
        return file;
      } catch { return undefined; } // Recording is best effort; it must never break a fight.
    },
  };
}
