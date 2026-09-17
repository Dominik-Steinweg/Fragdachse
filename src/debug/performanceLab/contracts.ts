import type { CombatDamageKind, LoadoutCommitSnapshot, LoadoutUseResult, WeaponSlot } from '../../types';
import type { ArenaPerformanceReport } from '../../scenes/arena/ArenaRuntimeProfiler';

export interface PerformanceRunRequest {
  schemaVersion: 1;
  runId: string;
  caseId: string;
  durationMs?: number;
  timeoutMs: number;
  captureProfile: 'standard' | 'reduced';
}
export interface PerformanceWindow {
  id: string;
  caseVersion?: number;
  kind: 'startup' | 'preparation' | 'measurement' | 'recovery';
  fromMs: number;
  toMs: number;
  load?: Record<string, number | string>;
}
export interface PerformanceLabResult {
  schemaVersion: 1;
  request: PerformanceRunRequest;
  scenarioVersion: string;
  windows: PerformanceWindow[];
  markers: { name: string; atMs: number }[];
  game: ArenaPerformanceReport;
  environment: Record<string, unknown>;
}
export interface PerformanceLabGamePort {
  start(mapId: string, seed: number, commit: LoadoutCommitSnapshot): void;
  isReady(): boolean;
  isLobbyReady(): boolean;
  prepareTargets(): void;
  prepareCase?(test: PerformanceCase, markPreparation?: (name: string) => void): boolean | void;
  updateCase?(test: PerformanceCase, elapsedMs: number, stage?: 'measure' | 'tail', durationMs?: number): void;
  isCaseComplete?(test: PerformanceCase, elapsedMs: number, durationMs: number): boolean;
  performAction?(test: PerformanceCase, sequence: number, inputStarted: boolean): LoadoutUseResult | null;
  finishCase?(test: PerformanceCase): void;
  verifyCase?(test: PerformanceCase, load: Record<string, number | string>): void;
  readSubphases?(): PerformanceWindow[];
  maintainTargets(): void;
  attack(slot: WeaponSlot, sequence: number, inputStarted: boolean): LoadoutUseResult | null;
  observeHits(listener: () => void): () => void;
  readLoad(): Record<string, number | string>;
  discard(): void;
  stopRecording(): ArenaPerformanceReport | null;
  environment(): Record<string, unknown>;
}
export interface PerformanceCase {
  id: string;
  version: number;
  durationMs: number;
  tailMs: number;
  actionIntervalMs: number;
  minimumActions: number;
  slot: WeaponSlot;
  commit: LoadoutCommitSnapshot;
  kind?: 'weapon' | 'utility' | 'pickup' | 'environment' | 'enemies' | 'construction' | 'combat' | 'recovery';
  itemId?: string;
  mapId?: string;
  targetDistance?: number;
  enemyCount?: number;
  requireHits?: boolean;
  requiredDamageKinds?: readonly CombatDamageKind[];
  continuous?: boolean;
  maximumActions?: number;
  timeOfDay?: number;
  buildSignature?: string;
}

declare global {
  interface Window {
    __FD_PERF_REQUEST__?: PerformanceRunRequest;
    __FD_PERF__?: {
      state: string;
      error?: string;
      detail?: Record<string, unknown>;
      result?: PerformanceLabResult;
      audioState?: () => string;
      start: () => void;
      cancel: (reason: string) => void;
    };
  }
}
