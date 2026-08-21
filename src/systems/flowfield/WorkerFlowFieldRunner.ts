/**
 * Einzige Datei im Projekt mit `new Worker(...)`. Diese Modulgrenze ist der Grund, warum Tests
 * und der Inline-Fallback den Worker-Entry nie laden.
 */
import {
  FLOW_FIELD_PROTOCOL_VERSION,
  collectRequestTransferables,
  type FlowFieldRequest,
  type FlowFieldResponse,
  type FlowFieldResultMessage,
} from './FlowFieldProtocol';
import type { FlowFieldRunner } from './FlowFieldRunner';

export class WorkerFlowFieldRunner implements FlowFieldRunner {
  readonly kind = 'worker' as const;
  private readonly worker: Worker;
  private resultListener: ((result: FlowFieldResultMessage) => void) | null = null;
  private failureListener: ((reason: string) => void) | null = null;
  private terminated = false;

  constructor() {
    this.worker = new Worker(new URL('./FlowFieldWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FlowFieldResponse>): void => {
      const response = event.data;
      if (response.type === 'error') {
        this.reportFailure(response.message);
        return;
      }
      if (response.protocolVersion !== FLOW_FIELD_PROTOCOL_VERSION) {
        this.reportFailure(`protocol mismatch: worker ${response.protocolVersion}`);
        return;
      }
      this.resultListener?.(response);
    };
    this.worker.onerror = (event: ErrorEvent): void => {
      this.reportFailure(event.message || 'worker error');
    };
    this.worker.onmessageerror = (): void => {
      this.reportFailure('worker message could not be deserialized');
    };
  }

  post(request: FlowFieldRequest): void {
    if (this.terminated) return;
    this.worker.postMessage(request, collectRequestTransferables(request));
  }

  onResult(listener: (result: FlowFieldResultMessage) => void): void {
    this.resultListener = listener;
  }

  onFailure(listener: (reason: string) => void): void {
    this.failureListener = listener;
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
  }

  private reportFailure(reason: string): void {
    if (this.terminated) return;
    const listener = this.failureListener;
    this.terminate();
    listener?.(reason);
  }
}
