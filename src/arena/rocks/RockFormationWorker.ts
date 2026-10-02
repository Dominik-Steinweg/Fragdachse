import type { RockRimGeometry } from './RockRimGeometry';
import { RockFormationField, type FormationRock, type RockFormationSource } from './RockFormationField';

export type FormationWorkerRequest =
  | { kind: 'init'; width: number; height: number; states: (FormationRock | undefined)[]; source: RockFormationSource }
  | { kind: 'rim'; rim: RockRimGeometry | null }
  | { kind: 'change'; states: FormationRock[] }
  | { kind: 'repair'; revision: number; chunks: { cx: number; cy: number; revision: number }[]; azimuth: number; horizons: boolean }
  | { kind: 'build'; cx: number; cy: number; revision: number; azimuth?: number; horizons?: boolean };
export interface FormationWorkerResult { cx: number; cy: number; revision: number; azimuth: number; data: Uint8Array; occlusion: Uint8Array; buildMs: number; shadedTexels?: number; cacheHit?: boolean }
export interface FormationWorkerRepair { kind: 'repair'; revision: number; results: FormationWorkerResult[]; buildMs: number }
export interface FormationWorkerInitialized { kind: 'initialized'; initMs: number; startedAt: number; finishedAt: number }
let field: RockFormationField;
let states: (FormationRock | undefined)[];
self.onmessage = (event: MessageEvent<FormationWorkerRequest>): void => {
  const message = event.data;
  if (message.kind === 'init') {
    const started = performance.now();
    states = message.states;
    field = new RockFormationField(message.width, message.height, states, message.source);
    const finished = performance.now();
    self.postMessage({ kind: 'initialized', initMs: finished - started,
      startedAt: performance.timeOrigin + started, finishedAt: performance.timeOrigin + finished } satisfies FormationWorkerInitialized);
  } else if (message.kind === 'rim') {
    field.setRimGeometry(message.rim);
  } else if (message.kind === 'change') {
    for (const state of message.states) states[state.id] = state;
    field.invalidate(message.states.map(s => s.id));
  } else if (message.kind === 'repair') {
    const started = performance.now();
    const results = message.chunks.map(chunk => build(chunk, message.azimuth, message.horizons));
    self.postMessage({ kind: 'repair', revision: message.revision, results, buildMs: performance.now()-started } satisfies FormationWorkerRepair,
      { transfer: results.flatMap(r => [r.data.buffer, r.occlusion.buffer]) });
  } else {
    const result = build(message, message.azimuth, message.horizons);
    self.postMessage(result, { transfer: [result.data.buffer, result.occlusion.buffer] });
  }
};

function build(chunk: {cx:number;cy:number;revision:number}, azimuth=135, horizons=true): FormationWorkerResult {
  const started = performance.now(), result = field.buildCached(chunk.cx,chunk.cy,azimuth,horizons);
  // Cache ownership stays in this worker. Transferring its buffers would detach the next rebuild's inputs.
  return {...chunk, azimuth, data:result.data.slice(), occlusion:result.occlusion.slice(),
    buildMs:performance.now()-started, ...field.lastBuild};
}
