import type { TargetFootprint } from '../../systems/ReinforcementMatrixSystem';
import type { TargetStatusTarget } from '../../systems/TargetStatusSystem';
import type { CoopMissionRuntime } from '../../activity/CoopMissionRuntime';
import { CELL_SIZE } from '../../config';
import type { RockVisualHelper } from './RockVisualHelper';
import type { CombatSystem } from '../../systems/CombatSystem';
import type { PlacementSystem } from '../../systems/PlacementSystem';
import type { PlayerManager } from '../../entities/PlayerManager';
import type { WorldRuntime } from '../../world/WorldRuntime';

/**
 * Gemeinsame Weltabfragen der Arena-Composition.
 *
 * Sie beantworten Fragen ueber die aktuell gebaute World – Bodenfreiheit, Hindernisschaden und
 * Zielflaechen – und besitzen selbst keinen Zustand. Activity- und World-Composition stellen
 * dieselbe Frage; deshalb liegt die Antwort hier und nicht als weiterer privater Zweig im Flow.
 */

type EnemyNavigationFlowField = NonNullable<CoopMissionRuntime['enemyPlayerFlowFieldService']>;

/** Das Navigationsfeld, das Gegner-Sonderbewegungen fuer Bodenpruefungen lesen. */
function getEnemyNavigationFlowField(runtime: CoopMissionRuntime | null): EnemyNavigationFlowField | null {
  return runtime?.enemyPlayerFlowFieldService ?? runtime?.enemyFlowFieldService ?? null;
}

/** Physisch freie Bodenposition; Erreichbarkeit ist fuer reine Landepunktpruefungen optional. */
export function isFreeEnemyGroundAt(runtime: CoopMissionRuntime | null, x: number, y: number, radius: number): boolean {
  const flowFieldService = getEnemyNavigationFlowField(runtime);
  if (!flowFieldService) return true;
  return flowFieldService.isCircleGroundFreeAt(x, y, radius);
}

/** Sichere Auftauchposition: Koerperfreiheit und Flowfield-Erreichbarkeit zugleich. */
export function isSafeEnemyGroundAt(runtime: CoopMissionRuntime | null, x: number, y: number, radius: number): boolean {
  const flowFieldService = getEnemyNavigationFlowField(runtime);
  if (!flowFieldService) return true;
  return flowFieldService.isCirclePositionFreeAt(x, y, radius);
}

export function findSafeEnemyGroundPosition(
  runtime: CoopMissionRuntime | null,
  x: number,
  y: number,
  radius: number,
  maxRadiusCells: number,
): { x: number; y: number } | null {
  return getEnemyNavigationFlowField(runtime)?.findNearestSafeWorldPosition(x, y, radius, maxRadiusCells) ?? null;
}

export function hasWalkableEnemyCircleLine(
  runtime: CoopMissionRuntime | null,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
): boolean {
  return getEnemyNavigationFlowField(runtime)?.hasWalkableCircleLine(fromX, fromY, toX, toY, radius) ?? true;
}

/** Gemeinsamer externer Hindernisschaden fuer Projektile und Gegner-Spezialeffekte. */
export function resolveObstacleDamage(
  combatSystem: CombatSystem,
  placementSystem: PlacementSystem | null,
  index: number,
  damage: number,
  attackerId: string,
): number {
  const runtimeRock = placementSystem?.getRuntimeRock(index);
  return combatSystem.resolveExternalTargetDamage(
    {
      targetType: runtimeRock?.constructionId ? 'construction' : 'rock',
      targetId: String(index),
    },
    damage,
    attackerId,
  );
}

/** Liefert die reale Kollisions-/Darstellungsflaeche fuer Schutz- und Statusabfragen. */
export function resolveTargetFootprint(
  playerManager: PlayerManager,
  coopMissionRuntime: CoopMissionRuntime | null,
  worldRuntime: WorldRuntime | null,
  rockVisualHelper: RockVisualHelper,
  target: TargetStatusTarget,
): TargetFootprint | null {
  if (target.targetType === 'player') {
    const player = playerManager.getPlayer(target.targetId);
    if (!player?.active) return null;
    const bounds = player.getBounds();
    return { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height };
  }
  if (target.targetType === 'enemy') {
    const enemy = coopMissionRuntime?.enemyManager?.getEnemy(target.targetId);
    if (!enemy?.sprite.active) return null;
    const bounds = enemy.sprite.getBounds();
    return { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height };
  }
  if (target.targetType === 'base') {
    const base = worldRuntime?.materialization?.bases?.getBase(target.targetId);
    if (!base || (base.isInert?.() ?? false)) return null;
    const parts = base.getCellBodies().map((body) => {
      const bounds = body.getBounds();
      return {
        x: bounds.centerX,
        y: bounds.centerY,
        width: bounds.width,
        height: bounds.height,
      } satisfies TargetFootprint;
    });
    const bounds = parts.reduce<{ left: number; top: number; right: number; bottom: number } | null>((acc, next) => {
      if (!acc) {
        return {
          left: next.x - next.width / 2,
          top: next.y - next.height / 2,
          right: next.x + next.width / 2,
          bottom: next.y + next.height / 2,
        };
      }
      return {
        left: Math.min(acc.left, next.x - next.width / 2),
        top: Math.min(acc.top, next.y - next.height / 2),
        right: Math.max(acc.right, next.x + next.width / 2),
        bottom: Math.max(acc.bottom, next.y + next.height / 2),
      };
    }, null);
    if (!bounds || parts.length === 0) return null;
    return {
      x: (bounds.left + bounds.right) * 0.5,
      y: (bounds.top + bounds.bottom) * 0.5,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
      parts,
    };
  }

  const rockId = Number(target.targetId);
  if (!Number.isFinite(rockId)) return null;
  const runtimeRock = worldRuntime?.materialization?.placement?.getRuntimeRock(rockId);
  if (runtimeRock) {
    const world = rockVisualHelper.gridToWorld(runtimeRock.gridX, runtimeRock.gridY);
    return { x: world.x, y: world.y, width: CELL_SIZE, height: CELL_SIZE };
  }
  const rock = worldRuntime?.materialization?.arena?.rockPhysicsProxies[rockId];
  if (!rock?.active) return null;
  const bounds = rock.getBounds();
  return { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height };
}
