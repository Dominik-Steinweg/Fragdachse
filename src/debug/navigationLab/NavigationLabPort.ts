import type { WorldMetrics } from '../../world/WorldMetrics';
import type { ArenaPerformanceReport } from '../../scenes/arena/ArenaRuntimeProfiler';
import type { HostUpdatePerformanceMetrics } from '../../scenes/arena/HostUpdateCoordinator';
import type { LoadoutCommitSnapshot } from '../../types';
import type { EnemyIntent, MovementFeedback } from '../../systems/navigation/NavigationContracts';
import type { CombatDamageObservationPort } from '../../combat/CombatCapabilities';

export interface NavigationLabEnemy {
  readonly id: string;
  readonly kind: string;
  readonly faction: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly vx: number;
  readonly vy: number;
  readonly moving: boolean;
  readonly blocked: boolean;
  readonly attacking: boolean;
  readonly hp: number;
  readonly target: string | null;
  readonly bodyFree: boolean;
  readonly special: boolean;
  readonly intent?: EnemyIntent | null;
  readonly movement?: MovementFeedback | null;
}

/** Explicit scenario inputs and read models; no runtime owner escapes to the lab. */
export interface NavigationLabWorldPort {
  getAuthoredSpawnCases(): readonly NavigationSpawnCase[];
  spawnAuthoredCase(id: string): readonly string[];
  setNextRoundSeed(seed: number): void;
  isReady(): boolean;
  setScenarioActive(active: boolean): void;
  getMetrics(): WorldMetrics | null;
  getFreePositions(radius: number): readonly { x: number; y: number }[];
  getGeometryFingerprint(): string;
  getGeometry(): import('../../systems/navigation/NavigationGeometry').NavigationGeometrySnapshot | null;
  getNavigationMetrics(): Record<string, number>;
  observeCombatantDamage: CombatDamageObservationPort['addDamageDealtObserver'];
  setDensityEnabled(enabled: boolean): void;
  destroyScenarioRock(id: number): boolean;
  spawnEnemy(x: number, y: number, kind: string, allied: boolean): string | null;
  removeEnemies(): void;
  readEnemies(): readonly NavigationLabEnemy[];
  getPlayerPosition(): { x: number; y: number; alive: boolean } | null;
  placePlayer(x: number, y: number): void;
}

export interface NavigationSpawnCase {
  readonly id: string;
  readonly kind: string;
  readonly target: { x: number; y: number };
}

export interface NavigationLabPort extends NavigationLabWorldPort {
  start(mapId: string, seed: number, loadout: LoadoutCommitSnapshot): void;
  fireAt(x: number, y: number, sequence: number): void;
  startRecording(environment: Record<string, unknown>): void;
  stopRecording(): ArenaPerformanceReport | null;
  getPerformance(): HostUpdatePerformanceMetrics;
  getRenderCpuMs(): number;
}
