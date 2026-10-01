import type { RockRimGeometry } from './RockRimGeometry';
import { RockFormationField, type FormationRock, type RockFormationSource } from './RockFormationField';

export type FormationWorkerRequest =
  | { kind: 'init'; width: number; height: number; states: (FormationRock | undefined)[]; source: RockFormationSource }
  | { kind: 'rim'; rim: RockRimGeometry | null }
  | { kind: 'change'; states: FormationRock[] }
  | { kind: 'build'; cx: number; cy: number; revision: number; azimuth?: number; horizons?: boolean };
export interface FormationWorkerResult { cx: number; cy: number; revision: number; azimuth: number; data: Uint8Array; occlusion: Uint8Array; buildMs: number }
export interface FormationWorkerInitialized { kind: 'initialized'; initMs: number }
let field: RockFormationField;
let states: (FormationRock | undefined)[];
self.onmessage = (event: MessageEvent<FormationWorkerRequest>): void => {
  const message = event.data;
  if (message.kind === 'init') {
    const started = performance.now();
    states = message.states;
    field = new RockFormationField(message.width, message.height, states, message.source);
    self.postMessage({ kind: 'initialized', initMs: performance.now() - started } satisfies FormationWorkerInitialized);
  } else if (message.kind === 'rim') {
    field.setRimGeometry(message.rim);
  } else if (message.kind === 'change') {
    for (const state of message.states) states[state.id] = state;
    field.invalidate(message.states.map(s => s.id));
  } else {
    const started = performance.now(), result = field.build(message.cx, message.cy, message.azimuth, message.horizons);
    self.postMessage({ cx: message.cx, cy: message.cy, revision: message.revision, azimuth: message.azimuth ?? 135,
      data: result.data, occlusion: result.occlusion, buildMs: performance.now() - started } satisfies FormationWorkerResult,
    { transfer: [result.data.buffer, result.occlusion.buffer] });
  }
};
