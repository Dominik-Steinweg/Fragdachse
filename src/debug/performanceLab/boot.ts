import type { ArenaDiagnosticsController } from '../../scenes/arena/ArenaDiagnosticsController';
import type { PerformanceLabGamePort, PerformanceWindow } from './contracts';

const markers: { name: string; atMs: number }[] = [];
let lobbyRevealedAt: number | null = null;
let lobbyStartedAt: number | null = null;
let loading = false;
let startRequested = false;
let controller: { update(now: number): void; cancel(reason: string): void } | null = null;
let createPort: (() => Promise<PerformanceLabGamePort>) | null = null;
let disposers: (() => void)[] = [];
let stopCapture: (() => void) | null = null;

export function labMarker(name: string): number {
  const atMs = performance.now();
  markers.push({ name, atMs });
  performance.mark(`FD:lab:${window.__FD_PERF_REQUEST__?.runId}:${name}`);
  return atMs;
}

export function failPerformanceLab(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (window.__FD_PERF__) {
    window.__FD_PERF__.state = 'failed';
    window.__FD_PERF__.error = message;
  }
  try { controller?.cancel(message); }
  catch (cleanupError) { if (window.__FD_PERF__) window.__FD_PERF__.error += `; Cleanup: ${String(cleanupError)}`; }
  finally {
    try { stopCapture?.(); } finally {
      stopCapture = null;
      for (const dispose of disposers.splice(0)) dispose();
    }
  }
}

export function beginPerformanceBoot(): void {
  if (!window.__FD_PERF_REQUEST__) return;
  window.__FD_PERF__ = { state: 'boot', cancel: failPerformanceLab, start: () => {
    if (window.__FD_PERF__?.state !== 'awaiting-audio') throw new Error('Lobby is not ready for the start command');
    startRequested = true;
  } };
  labMarker('boot-start');
}

export function startPerformanceCapture(diagnostics: ArenaDiagnosticsController): void {
  const request = window.__FD_PERF_REQUEST__;
  if (!request) return;
  diagnostics.startScenarioRecording({ runId: request.runId, participantId: 'local-host', role: 'host',
    captureProfile: request.captureProfile }, { maxFrames: 2_000_000, maxDurationMs: request.timeoutMs });
  stopCapture = () => { diagnostics.stopScenarioRecording(); };
  labMarker('profiler-ready');
}

export function attachPerformanceLab(factory: () => Promise<PerformanceLabGamePort>, audioState: () => string): void {
  createPort = factory;
  if (window.__FD_PERF__) window.__FD_PERF__.audioState = audioState;
}

export function performanceLobbyRevealed(): void {
  if (!window.__FD_PERF__) return;
  lobbyRevealedAt = labMarker('lobby-revealed');
  window.__FD_PERF__.state = 'awaiting-audio';
}

/** Invoked only in the lab build, after ordinary input and before host simulation. */
export function updatePerformanceLab(): void {
  const state = window.__FD_PERF__;
  const request = window.__FD_PERF_REQUEST__;
  if (!state || !request || state.state === 'failed' || state.state === 'complete') return;
  try {
    if (performance.now() > request.timeoutMs) throw new Error('Performance-Lab: Gesamt-Timeout');
    if (controller) { controller.update(performance.now()); return; }
    if (lobbyRevealedAt === null || !createPort || !startRequested || state.audioState?.() !== 'running') return;
    if (lobbyStartedAt === null) {
      if (innerWidth !== 1920 || innerHeight !== 1080 || devicePixelRatio !== 1) throw new Error('Lab requires 1920 × 1080, DPR 1');
      if (!document.hasFocus() || document.hidden) throw new Error('Lab window must be visible and focused');
      lobbyStartedAt = labMarker('lobby-start');
      state.state = 'lobby';
      const invalidate = () => failPerformanceLab('Messbedingung verändert: Fokus, Sichtbarkeit oder Auflösung');
      for (const [target, event] of [[window, 'blur'], [window, 'resize'], [document, 'visibilitychange']] as const) {
        target.addEventListener(event, invalidate);
        disposers.push(() => target.removeEventListener(event, invalidate));
      }
    }
    if (loading || performance.now() - lobbyStartedAt < 3000) return;
    loading = true;
    const windows: PerformanceWindow[] = [
      { id: 'startup', kind: 'startup', fromMs: 0, toMs: lobbyRevealedAt },
      { id: 'audio-unlock', kind: 'preparation', fromMs: lobbyRevealedAt, toMs: lobbyStartedAt },
      { id: 'lobby', kind: 'measurement', fromMs: lobbyStartedAt, toMs: labMarker('lobby-end') },
    ];
    state.state = 'loading-lab';
    const fromMs = labMarker('lab-load-start');
    void Promise.all([import('./PerformanceLabController'), createPort()]).then(([{ PerformanceLabController }, gamePort]) => {
      if (state.state === 'failed') return;
      windows.push({ id: 'lab-load', kind: 'preparation', fromMs, toMs: labMarker('lab-load-end') });
      controller = new PerformanceLabController(request, gamePort, windows, markers, labMarker, result => {
        for (const dispose of disposers.splice(0)) dispose();
        state.result = result;
        state.state = 'complete';
        stopCapture = null;
      });
    }).catch(failPerformanceLab);
  } catch (error) { failPerformanceLab(error); }
}
