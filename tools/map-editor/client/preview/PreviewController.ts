import { projectArenaGenerationRevision } from '../../../../src/arena/ArenaGenerationRevision';
import type { ArenaGenerationMapConfig } from '../../../../src/arena/ArenaGenerator';
import { stable, type JsonObject } from '../../shared/json';
import type { PreviewResult } from './generate';

export function geometryRevision(draft: JsonObject): string {
  return stable({ generation: projectArenaGenerationRevision(draft as unknown as ArenaGenerationMapConfig), waterAreas: draft.waterAreas });
}
export interface VariantResult { seed: number; result?: PreviewResult; error?: string }
export class PreviewController {
  private worker: Worker | null = null;
  private reject: ((error: Error) => void) | null = null;
  private ticket = 0;
  busy = false;
  cancel(): void {
    this.ticket++; this.worker?.terminate(); this.worker = null;
    this.reject?.(new Error('Vorschau abgebrochen.')); this.reject = null; this.busy = false;
  }
  async run(draft: JsonObject, seed: number, count: number, progress: (result: VariantResult, index: number) => void): Promise<void> {
    this.cancel(); const ticket = this.ticket; this.busy = true;
    const snapshot = structuredClone(draft);
    try {
      for (let i = 0; i < count && ticket === this.ticket; i++) {
        const variantSeed = (seed + Math.imul(i, 0x9e3779b9)) >>> 0;
        let variant: VariantResult;
        try { variant = { seed: variantSeed, result: await this.generate(snapshot, variantSeed) }; }
        catch (error) { variant = { seed: variantSeed, error: error instanceof Error ? error.message : String(error) }; }
        if (ticket === this.ticket) progress(variant, i);
      }
    } finally { if (ticket === this.ticket) this.busy = false; }
  }
  private generate(draft: JsonObject, seed: number): Promise<PreviewResult> {
    return new Promise((resolve, reject) => {
      const worker = this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const cleanup = () => { clearTimeout(timeout); worker.terminate(); if (this.worker === worker) { this.worker = null; this.reject = null; } };
      const fail = (error: Error) => { cleanup(); reject(error); };
      this.reject = fail;
      const timeout = setTimeout(() => fail(new Error('Generierung nach 120 Sekunden abgebrochen.')), 120_000);
      worker.onerror = event => fail(new Error(event.message || 'Generator-Worker konnte nicht gestartet werden.'));
      worker.onmessage = (event: MessageEvent<{ result?: PreviewResult; error?: string }>) => {
        if (event.data.error) fail(new Error(event.data.error)); else { cleanup(); resolve(event.data.result!); }
      };
      worker.postMessage({ draft, seed });
    });
  }
}
