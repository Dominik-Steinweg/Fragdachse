/**
 * Nachrichtenvertrag zwischen `FlowFieldCoordinator` (Main Thread) und `FlowFieldEngine` (Worker).
 *
 * Teil des Worker-Graphen: importiert ausschliesslich den Kernel. Alles, was hier steht, muss
 * strukturklonbar sein - keine Closures, keine Klasseninstanzen, keine Phaser-Objekte.
 */
import type {
  FlowFieldBaseDescriptor,
  FlowFieldMetrics,
  FlowFieldTuning,
} from './FlowFieldKernel';

export const FLOW_FIELD_PROTOCOL_VERSION = 1;

export type FlowFieldGoalMode = 'bases' | 'dynamic' | 'dynamic-fallback-bases';

export interface FlowFieldProfileDescriptor {
  readonly profileId: string;
  readonly clearanceCells: number;
}

export interface FlowFieldFieldDescriptor {
  readonly fieldId: string;
  readonly profileId: string;
  readonly goalMode: FlowFieldGoalMode;
}

export interface FlowFieldInitMessage {
  readonly type: 'init';
  readonly protocolVersion: number;
  readonly generationId: number;
  readonly metrics: FlowFieldMetrics;
  readonly tuning: FlowFieldTuning;
  readonly staticKind: Uint8Array;
  readonly rockOccupancy: Uint8Array;
  readonly bases: readonly FlowFieldBaseDescriptor[];
  readonly activeBaseIds: readonly string[];
  readonly profiles: readonly FlowFieldProfileDescriptor[];
  readonly fields: readonly FlowFieldFieldDescriptor[];
}

/**
 * Topologieaenderungen. `cell` ist der haeufige Fall (Fels zerstoert, Konstruktion gebaut/entfernt)
 * und aktualisiert nur eine Rasterzelle; die beiden anderen erzwingen eine Neuklassifikation.
 */
export type FlowFieldPatch =
  | { readonly t: 'cell'; readonly index: number; readonly occupied: 0 | 1 }
  | { readonly t: 'rock-resync'; readonly rockOccupancy: Uint8Array }
  | { readonly t: 'active-bases'; readonly ids: readonly string[] }
  | { readonly t: 'field-add'; readonly field: FlowFieldFieldDescriptor }
  | { readonly t: 'field-remove'; readonly fieldId: string };

export interface FlowFieldJobField {
  readonly fieldId: string;
  readonly goalVersion: number;
  /** Rohe, unnormalisierte Zielindizes; der Worker filtert je Profil gegen dessen Begehbarkeit. */
  readonly goals: Int32Array;
  /** Recycelte Puffer. Fehlen sie, allokiert der Worker selbst - der Main Thread merkt das nicht. */
  readonly integrationBuffer?: ArrayBuffer;
  readonly vectorBuffer?: ArrayBuffer;
  readonly goalSourceBuffer?: ArrayBuffer;
  readonly traversableBuffer?: ArrayBuffer;
}

export interface FlowFieldJobMessage {
  readonly type: 'job';
  readonly generationId: number;
  readonly jobId: number;
  readonly inputTick: number;
  /** Topologieversion NACH Anwendung der enthaltenen Patches. */
  readonly topologyVersion: number;
  readonly patches: readonly FlowFieldPatch[];
  readonly fields: readonly FlowFieldJobField[];
}

export type FlowFieldRequest = FlowFieldInitMessage | FlowFieldJobMessage;

export interface FlowFieldResultField {
  readonly fieldId: string;
  readonly goalVersion: number;
  readonly goalIndexes: Int32Array;
  readonly integrationField: Float32Array;
  readonly vectorField: Float32Array;
  readonly goalSourceField: Int32Array;
  /**
   * Nur fuer Clearance-Profile gesetzt: deren eigenes, erodiertes `traversable`. Das Standardprofil
   * spiegelt der Main Thread selbst und braucht hier nichts.
   */
  readonly profileTraversable: Uint8Array | null;
}

export interface FlowFieldResultMessage {
  readonly type: 'result';
  readonly protocolVersion: number;
  readonly generationId: number;
  readonly jobId: number;
  readonly inputTick: number;
  readonly topologyVersion: number;
  /** Im Worker gemessene reine Rechenzeit - trennt "verlagert" von "faellt aus". */
  readonly computeMs: number;
  readonly fields: readonly FlowFieldResultField[];
}

export interface FlowFieldErrorMessage {
  readonly type: 'error';
  readonly protocolVersion: number;
  readonly message: string;
}

export type FlowFieldResponse = FlowFieldResultMessage | FlowFieldErrorMessage;

/** Sammelt alle uebertragbaren Puffer einer Antwort fuer die `transfer`-Liste. */
export function collectResultTransferables(result: FlowFieldResultMessage): ArrayBuffer[] {
  const transfer: ArrayBuffer[] = [];
  for (const field of result.fields) {
    transfer.push(field.integrationField.buffer as ArrayBuffer);
    transfer.push(field.vectorField.buffer as ArrayBuffer);
    transfer.push(field.goalSourceField.buffer as ArrayBuffer);
    transfer.push(field.goalIndexes.buffer as ArrayBuffer);
    if (field.profileTraversable) transfer.push(field.profileTraversable.buffer as ArrayBuffer);
  }
  return transfer;
}

/** Sammelt alle uebertragbaren Puffer einer Anfrage fuer die `transfer`-Liste. */
export function collectRequestTransferables(request: FlowFieldRequest): ArrayBuffer[] {
  if (request.type === 'init') {
    return [request.staticKind.buffer as ArrayBuffer, request.rockOccupancy.buffer as ArrayBuffer];
  }
  const transfer: ArrayBuffer[] = [];
  for (const patch of request.patches) {
    if (patch.t === 'rock-resync') transfer.push(patch.rockOccupancy.buffer as ArrayBuffer);
  }
  for (const field of request.fields) {
    transfer.push(field.goals.buffer as ArrayBuffer);
    if (field.integrationBuffer) transfer.push(field.integrationBuffer);
    if (field.vectorBuffer) transfer.push(field.vectorBuffer);
    if (field.goalSourceBuffer) transfer.push(field.goalSourceBuffer);
    if (field.traversableBuffer) transfer.push(field.traversableBuffer);
  }
  return transfer;
}
