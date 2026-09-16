import type { NavigationPoint } from './NavigationGeometry';
import type { EnemyAiTargetRef } from '../EnemyAiTargetCatalog';

export interface NavigationVersion { readonly generation: number; readonly topology: number; readonly goal: number; readonly profile: string }
export type NavigationResult = (NavigationVersion & (
  | { readonly status: 'ready'; readonly waypoint: NavigationPoint; readonly cost: number; readonly region: number }
  | { readonly status: 'unreachable'; readonly region: number }
  | { readonly status: 'pending'; readonly continuation?: NavigationPoint; readonly directGoalConnection?: boolean }
  | { readonly status: 'invalid-start' | 'invalid-goal' }
));
export interface EnemyIntent {
  readonly target: EnemyAiTargetRef | { readonly kind: 'base'; readonly id: string } | { readonly kind: 'ally'; readonly id: string } | null;
  readonly point: NavigationPoint | null;
  readonly reason: 'player' | 'siege' | 'strategic' | 'decoy' | 'fallback-base' | 'memory' | 'follow' | 'wait';
  readonly attackContext: 'primary' | 'breach' | 'none';
  readonly selectedAt: number;
  readonly navigation: NavigationResult;
}
export interface LocomotionRequest {
  readonly id: string; readonly x: number; readonly y: number; readonly radius: number;
  readonly speed: number; readonly waypoint: NavigationPoint | null;
  readonly priority: 'ordinary' | 'attack' | 'exclusive';
  readonly previousVx: number; readonly previousVy: number;
  readonly routeCost?: number;
}
export interface MovementFeedback {
  readonly vx: number; readonly vy: number;
  readonly progress: number;
  readonly waitReason: 'none' | 'arrival' | 'attack' | 'crowd' | 'geometry' | 'route-pending' | 'exclusive' | 'recovery';
  readonly neighborsVisited: number;
}
export interface BreachPlan {
  readonly version: NavigationVersion;
  readonly status: 'pending' | 'ready' | 'no-solution' | 'invalid';
  readonly startRegion: number;
  readonly openedObjects: readonly string[];
  readonly nextBlocker: string | null;
  readonly approach: NavigationPoint | null;
  readonly costSeconds: number;
}
