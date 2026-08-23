/**
 * Ausfuehrungssubstrat des Coordinators.
 *
 * Diese Datei enthaelt bewusst KEIN `new Worker(...)`: Sie wird von Tests importiert, und Vitest
 * duerfte den Worker-Entry sonst transformieren. Die Worker-Variante steht in
 * `WorkerFlowFieldRunner.ts`, die Auswahl in `FlowFieldRunnerFactory.ts`.
 */
import { FlowFieldEngine } from './FlowFieldEngine';
import {
  type FlowFieldRequest,
  type FlowFieldResponse,
  type FlowFieldResultMessage,
} from './FlowFieldProtocol';

export type FlowFieldRunnerKind = 'worker' | 'inline';

export interface FlowFieldRunner {
  readonly kind: FlowFieldRunnerKind;
  post(request: FlowFieldRequest): void;
  onResult(listener: (result: FlowFieldResultMessage) => void): void;
  /** Meldet ein unbrauchbares Substrat (Worker-Fehler, Protokollbruch, Watchdog). */
  onFailure(listener: (reason: string) => void): void;
  terminate(): void;
}

/**
 * Rechnet im Main Thread. Zwei Aufgaben: Fallback, wenn kein Worker verfuegbar ist oder der
 * vorhandene ausfaellt, und deterministisches Substrat fuer Tests.
 *
 * Der Runner kopiert jeden Puffer, den ein echter Worker per Transfer neutralisiert haette. Damit
 * bleibt genau ein Codepfad: Wer nach dem Posten noch auf einen uebergebenen Puffer schreibt,
 * faellt hier deterministisch auf, statt erst in der Worker-Variante.
 */
export class InlineFlowFieldRunner implements FlowFieldRunner {
  readonly kind = 'inline' as const;
  private readonly engine = new FlowFieldEngine();
  private resultListener: ((result: FlowFieldResultMessage) => void) | null = null;
  private failureListener: ((reason: string) => void) | null = null;
  private readonly pending: FlowFieldResultMessage[] = [];
  private terminated = false;

  /** `false` haelt Ergebnisse zurueck, bis `flush()` gerufen wird - simuliert Worker-Latenz. */
  constructor(private autoFlush = true) {}

  post(request: FlowFieldRequest): void {
    if (this.terminated) return;
    const detached = detachRequest(request);
    if (detached.type === 'init') {
      this.engine.init(detached);
      return;
    }
    const result = this.engine.runJob(detached);
    this.pending.push(detachResult(result));
    if (this.autoFlush) this.flush();
  }

  onResult(listener: (result: FlowFieldResultMessage) => void): void {
    this.resultListener = listener;
  }

  onFailure(listener: (reason: string) => void): void {
    this.failureListener = listener;
  }

  terminate(): void {
    this.terminated = true;
    this.pending.length = 0;
    this.resultListener = null;
    this.failureListener = null;
  }

  // ---- Nur fuer Tests ----

  setAutoFlush(autoFlush: boolean): void {
    this.autoFlush = autoFlush;
    if (autoFlush) this.flush();
  }

  get pendingResults(): number {
    return this.pending.length;
  }

  /** Liefert die aeltesten `count` zurueckgehaltenen Ergebnisse aus. */
  flush(count = Number.POSITIVE_INFINITY): number {
    let delivered = 0;
    while (this.pending.length > 0 && delivered < count) {
      const result = this.pending.shift()!;
      delivered += 1;
      this.resultListener?.(result);
    }
    return delivered;
  }

  fail(reason: string): void {
    this.failureListener?.(reason);
  }
}

function copyOf<T extends Float32Array | Int32Array | Uint8Array>(view: T): T {
  return view.slice() as T;
}

/**
 * Bildet die Eigentumsuebergabe eines echten Transfers nach: Der Empfaenger bekommt eigene Puffer,
 * der Sender behaelt seine - schreibt er weiter hinein, wird das Ergebnis nicht mehr davon beruehrt.
 */
function detachRequest(request: FlowFieldRequest): FlowFieldRequest {
  if (request.type === 'init') {
    return {
      ...request,
      staticKind: copyOf(request.staticKind),
      rockOccupancy: copyOf(request.rockOccupancy),
      barrierOccupancy: copyOf(request.barrierOccupancy),
    };
  }
  return {
    ...request,
    patches: request.patches.map((patch) => (
      patch.t === 'rock-resync' ? { ...patch, rockOccupancy: copyOf(patch.rockOccupancy) }
        : patch.t === 'barrier-resync' ? { ...patch, barrierOccupancy: copyOf(patch.barrierOccupancy) }
          : patch
    )),
    fields: request.fields.map((field) => ({
      ...field,
      goals: copyOf(field.goals),
      integrationBuffer: field.integrationBuffer?.slice(0),
      vectorBuffer: field.vectorBuffer?.slice(0),
      goalSourceBuffer: field.goalSourceBuffer?.slice(0),
      traversableBuffer: field.traversableBuffer?.slice(0),
    })),
  };
}

function detachResult(result: FlowFieldResultMessage): FlowFieldResultMessage {
  return {
    ...result,
    fields: result.fields.map((field) => ({
      ...field,
      goalIndexes: copyOf(field.goalIndexes),
      integrationField: copyOf(field.integrationField),
      vectorField: copyOf(field.vectorField),
      goalSourceField: copyOf(field.goalSourceField),
      profileTraversable: field.profileTraversable ? copyOf(field.profileTraversable) : null,
    })),
  };
}

export type { FlowFieldRequest, FlowFieldResponse, FlowFieldResultMessage };
