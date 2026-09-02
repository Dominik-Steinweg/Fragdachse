import { bridge } from '../../network/bridge';
import type {
  CoopMissionArmedConstructionView,
  CoopMissionArmedOutpostView,
} from '../../activity/CoopMissionHostUpdate';
import type { CoopMissionRuntimePorts } from '../../activity/CoopMissionRuntime';
import type { CoopMissionPresentationReadPort } from '../../activity/CoopMissionPresentationBinding';
import type { CoopMissionRuntime } from '../../activity/CoopMissionRuntime';
import { resolveCoopDefenseCarryPresentationSnapshot } from './CoopDefenseCarryPresentation';
import type { BaseManager } from '../../entities/BaseManager';
import type { EnemyManager } from '../../entities/EnemyManager';
import type { BurrowSystem } from '../../systems/BurrowSystem';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';
import type { WorldRuntime } from '../../world/WorldRuntime';
import type { ArenaContext } from './ArenaContext';

export interface ArenaCoopMissionPortsInput {
  readonly ctx: ArenaContext;
  readonly getWorldRuntime: () => WorldRuntime | null;
  readonly getBaseManager: () => BaseManager | null;
  readonly getEnemyManager: () => EnemyManager | null;
  readonly getBurrowSystem: () => BurrowSystem | null;
  readonly getPlayerCapabilities: (playerId: string) => PlayerCapabilities;
}

export function createArenaCoopMissionPresentationPort(
  input: Pick<ArenaCoopMissionPortsInput, 'getBaseManager' | 'getEnemyManager'> & {
    readonly getCoopMissionRuntime: () => CoopMissionRuntime | null;
    readonly getEnemyVulnerability: (enemyId: string, now: number) => boolean;
  },
): CoopMissionPresentationReadPort {
  return {
    getEncounterPresentationState: () => bridge.getCoopDefenseEncounterPresentationState(),
    getMapEventPresentationState: () => bridge.getCoopDefenseMapEventPresentationState(),
    getSecondaryObjectivePresentationState: () => bridge.getCoopDefenseSecondaryObjectivePresentationState(),
    getMissionProgressPresentationState: () => bridge.getCoopDefenseMissionProgressPresentationState(),
    getLocalRespawnBudgetState: () => bridge.getLocalCoopDefenseRespawnBudgetState(),
    getSynchronizedNow: () => bridge.getSynchronizedNow(),
    getArenaStartTime: () => bridge.getArenaStartTime(),
    getEnemyVulnerability: (enemyId, now) => input.getEnemyVulnerability(enemyId, now),
    getCarryPresentationItems: () => resolveCoopDefenseCarryPresentationSnapshot(
      bridge.isHost(),
      input.getCoopMissionRuntime()?.coopDefenseCarrySystem ?? null,
      [],
    ),
    getHostileBaseProgress: () => {
      const bases = input.getBaseManager()?.getMainBasesByFaction('hostile') ?? [];
      if (bases.length === 0) return null;
      return {
        currentHp: bases.reduce((sum, base) => sum + base.getHp(), 0),
        maxHp: bases.reduce((sum, base) => sum + base.getMaxHp(), 0),
        remaining: bases.filter((base) => !base.isDestroyed()).length,
        total: bases.length,
      };
    },
    getBossProgress: (enemyKind) => {
      const enemy = input.getEnemyManager()?.getAllEnemies().find((candidate) => (
        candidate.faction === 'hostile'
        && candidate.kind === enemyKind
        && candidate.sprite.active
        && candidate.getHp() > 0
      ));
      return enemy ? { currentHp: enemy.getHp(), maxHp: enemy.getMaxHp() } : null;
    },
  };
}

/**
 * Die Lesesicht der Coop-Mission auf Scene- und World-Zustand.
 *
 * Der Port beantwortet nur Fragen der laufenden Activity - wo ein Spieler steht, welche Bauten und
 * Aussenposten beschiessbar sind, was repliziert wird. Er trifft keine Lifecycle-Entscheidung und
 * bleibt deshalb ausserhalb des Transition-Flows; der Coordinator baut ihn einmal und reicht ihn
 * an die Activity-Runtime durch.
 */
export function createArenaCoopMissionPorts(input: ArenaCoopMissionPortsInput): CoopMissionRuntimePorts {
  const { ctx, getWorldRuntime, getBurrowSystem, getPlayerCapabilities } = input;

  return {
    hostUpdate: {
      getPlayers: () => ctx.playerManager.getAllPlayers(),
      getPlayerPosition: (playerId) => {
        const player = ctx.playerManager.getPlayer(playerId);
        return player ? { x: player.x, y: player.y } : null;
      },
      isPlayerAlive: (playerId) => ctx.combatSystem.isAlive(playerId),
      isPlayerBurrowed: (playerId) => getBurrowSystem()?.isBurrowed(playerId) ?? false,
      isPlayerStealthed: (playerId) => ctx.decoySystem.isStealthed(playerId),
      canUseMissionActions: (playerId) => getPlayerCapabilities(playerId).canUseMissionActions,
      getDecoyTargets: () => ctx.decoySystem.getHostTargets().map((decoy) => ({
        id: decoy.id,
        ownerId: decoy.ownerId,
        x: decoy.sprite.x,
        y: decoy.sprite.y,
        radius: Math.max(decoy.sprite.displayWidth, decoy.sprite.displayHeight) * 0.5,
      })),
      getDecoyPosition: (decoyId) => {
        const decoy = ctx.decoySystem.getHostTarget(decoyId);
        return decoy ? { x: decoy.sprite.x, y: decoy.sprite.y } : null;
      },
      isDecoyTargetable: (decoyId) => ctx.decoySystem.getHostTarget(decoyId) !== null,
      getArmedConstructions: () => {
        const constructions: CoopMissionArmedConstructionView[] = [];
        for (const construction of getWorldRuntime()?.materialization?.placement?.getAllRuntimeRocks() ?? []) {
          if (construction.hp <= 0 || construction.kind !== 'turret') continue;
          constructions.push({
            id: String(construction.id),
            gridX: construction.gridX,
            gridY: construction.gridY,
            isTargetable: () => construction.hp > 0,
          });
        }
        return constructions;
      },
      getArmedOutposts: () => {
        const outposts: CoopMissionArmedOutpostView[] = [];
        for (const base of getWorldRuntime()?.materialization?.bases?.getBasesByFaction('friendly') ?? []) {
          if (base.role !== 'outpost'
            || base.isInert?.() === true
            || base.getHp() <= 0
            || base.getTurrets().length === 0) continue;
          const turret = base.getTurrets()[0];
          outposts.push({
            id: base.id,
            x: turret.x,
            y: turret.y,
            cells: base.getSpec().cells,
            resolveSurfacePoint: (fromX, fromY) => {
              const surface = base.getNearestSurfacePoint(fromX, fromY);
              return surface ? { x: surface.x, y: surface.y } : null;
            },
            isTargetable: () => (
              base.isInert?.() !== true && base.getHp() > 0 && base.getTurrets().length > 0
            ),
          });
        }
        return outposts;
      },
      syncDormantBaseStates: () => { getWorldRuntime()?.materialization?.bases?.syncDormantStates(); },
      getActiveBurnSources: (enemyId, atMs) => ctx.combatSystem.getActiveBurnSources(enemyId, atMs),
      getFireSystem: () => ctx.fireSystem,
      getSmokeSystem: () => ctx.smokeSystem,
      publishEncounterPresentation: (state) => {
        bridge.publishCoopDefenseEncounterPresentationState(state);
      },
      publishMapEventPresentation: (state) => {
        bridge.publishCoopDefenseMapEventPresentationState(state);
      },
      publishSecondaryObjectivePresentation: (state) => {
        bridge.publishCoopDefenseSecondaryObjectivePresentationState(state);
      },
    },
    clientPresentation: {
      getMissionProgressPresentationState: () => bridge.getCoopDefenseMissionProgressPresentationState(),
    },
  };
}
