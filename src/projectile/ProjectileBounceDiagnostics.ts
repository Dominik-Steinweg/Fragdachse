import type { ProjectilePathPoint } from './ProjectileFlightPath';

type Position = Readonly<{ x: number; y: number }>;
export interface RockSweepDiagnostic {
  projectileId?: number;
  capturedAt: number;
  start: Position;
  end: Position;
  halfWidth: number;
  halfHeight: number;
  indexed: boolean;
  candidates: Array<{ index: number; baseId?: string; left: number; top: number; right: number; bottom: number;
    enter?: number; exit?: number; rejected?: string }>;
  hit?: { rockIndex: number; x: number; y: number; normalX: number; normalY: number };
}
export interface BounceDiagnostic {
  projectileId: number;
  bounceSequence: number;
  capturedAt: number;
  incoming: ProjectilePathPoint;
  pivot: ProjectilePathPoint;
  correctedCenter: Position;
  contact?: Position;
  firstFollow?: ProjectilePathPoint;
}

/** Temporary local host capture. Copies only; never read by simulation or replication. */
export const tracerBounceDebug = {
  centerline: false,
  pinBounceWake: false,
  records: [] as BounceDiagnostic[],
  sweeps: [] as RockSweepDiagnostic[],
  steps: [] as Array<{ projectileId: number; capturedAt: number; stage: string;
    x: number; y: number; lastX: number; lastY: number; vx: number; vy: number;
    width: number; height: number; collisionMode?: string; sweepEnabled: boolean;
    pendingDestroy: boolean; bounceProcessed: boolean }>,
  clear(): void { this.records.length = 0; this.sweeps.length = 0; this.steps.length = 0; },
  exportShot(projectileId?: number) {
    const id = projectileId ?? this.steps[this.steps.length - 1]?.projectileId;
    return { projectileId: id, steps: this.steps.filter(record => record.projectileId === id),
      sweeps: this.sweeps.filter(record => record.projectileId === id),
      bounces: this.records.filter(record => record.projectileId === id) };
  },
};

export function beginRockSweepDiagnostic(input: Omit<RockSweepDiagnostic, 'capturedAt' | 'candidates'>): RockSweepDiagnostic | undefined {
  if (!tracerBounceDebug.centerline) return;
  const record = { ...input, capturedAt: performance.now(), candidates: [] };
  tracerBounceDebug.sweeps.push(record);
  if (tracerBounceDebug.sweeps.length > 512) tracerBounceDebug.sweeps.shift();
  return record;
}

export function captureFlightStep(input: Omit<typeof tracerBounceDebug.steps[number], 'capturedAt'>): void {
  tracerBounceDebug.steps.push({ ...input, capturedAt: performance.now() });
  if (tracerBounceDebug.steps.length > 2048) tracerBounceDebug.steps.shift();
}

export function captureBouncePivot(id: number, incoming: ProjectilePathPoint,
  pivot: ProjectilePathPoint, centerX: number, centerY: number): void {
  if (!tracerBounceDebug.centerline) return;
  tracerBounceDebug.records.push({ projectileId: id, bounceSequence: pivot.bounceSequence!,
    capturedAt: performance.now(), incoming: { ...incoming }, pivot: { ...pivot },
    correctedCenter: { x: centerX, y: centerY } });
  if (tracerBounceDebug.records.length > 32) tracerBounceDebug.records.shift();
}

export function captureBounceContact(id: number, sequence: number, x: number, y: number): void {
  if (!tracerBounceDebug.centerline) return;
  const record = findLatest(id);
  if (record?.bounceSequence === sequence) record.contact = { x, y };
}

export function captureBounceFollow(id: number, point: ProjectilePathPoint): void {
  if (!tracerBounceDebug.centerline) return;
  const record = findLatest(id);
  if (record && !record.firstFollow && !point.breakBefore && point.bounceSequence === undefined
    && point.sequence > record.pivot.sequence
    && (point.x !== record.pivot.x || point.y !== record.pivot.y)) record.firstFollow = { ...point };
}

function findLatest(id: number): BounceDiagnostic | undefined {
  for (let i = tracerBounceDebug.records.length - 1; i >= 0; i--) {
    if (tracerBounceDebug.records[i].projectileId === id) return tracerBounceDebug.records[i];
  }
  return undefined;
}
