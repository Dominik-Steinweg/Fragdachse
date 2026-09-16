import { ENEMY_FLOW_FIELD_IDS } from '../systems/flowfield/FlowFieldCoordinator';
import { goalCellsToIndexes } from '../systems/flowfield/FlowFieldSources';
import type { EnemyAiTargetCandidate } from '../systems/EnemyAiTargetCatalog';
import type { FireSystem } from '../effects/FireSystem';
import type { SmokePerceptionPort } from '../systems/SmokeRules';
import type {
  CoopDefenseEncounterPresentationState,
  CoopDefenseMapEventPresentationState,
  CoopDefenseSecondaryObjectivePresentationState,
} from '../types';
import type { CoopMissionRuntime } from './CoopMissionRuntime';

/** Eine Figur der laufenden World, so weit die Coop-Mission sie liest. */
export interface CoopMissionPlayerView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
}

/** Ein Koeder als Gegnerziel. Seine Lebenszeit gehoert der World, nicht der Mission. */
export interface CoopMissionDecoyView {
  readonly id: number;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Ein bewaffnetes Bauwerk der World als Gegnerziel. */
export interface CoopMissionArmedConstructionView {
  readonly representedPlayerIds?: readonly string[];
  readonly id: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly isTargetable: () => boolean;
}

/** Ein bewaffneter Aussenposten der World als Gegnerziel. */
export interface CoopMissionArmedOutpostView {
  readonly kind?: 'armed-outpost' | 'armed-base';
  readonly representedPlayerIds?: readonly string[];
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly cells: readonly { gridX: number; gridY: number }[];
  readonly resolveSurfacePoint: (fromX: number, fromY: number) => { x: number; y: number } | null;
  readonly isTargetable: () => boolean;
}

/**
 * Was die Coop-Mission ausserhalb ihrer eigenen Lifetime liest oder ausloest.
 *
 * Der Port traegt bewusst keine Systeme, sondern die fachlichen Fragen der Mission an World und
 * scene-langlebige Domain-Owner. Damit bleibt der Aufbau der Activity unabhaengig davon, wer
 * diese Antworten heute liefert.
 */
export interface CoopMissionHostUpdatePort {
  readonly isPlayerTargetable?: (playerId: string) => boolean;
  readonly getPlayers: () => readonly CoopMissionPlayerView[];
  readonly getPlayerPosition: (playerId: string) => { x: number; y: number } | null;
  readonly isPlayerAlive: (playerId: string) => boolean;
  readonly isPlayerBurrowed: (playerId: string) => boolean;
  readonly isPlayerStealthed: (playerId: string) => boolean;
  readonly canUseMissionActions: (playerId: string) => boolean;
  readonly getDecoyTargets: () => readonly CoopMissionDecoyView[];
  readonly getDecoyPosition: (decoyId: number) => { x: number; y: number } | null;
  readonly isDecoyTargetable: (decoyId: number) => boolean;
  readonly getArmedConstructions: () => readonly CoopMissionArmedConstructionView[];
  readonly getArmedOutposts: () => readonly CoopMissionArmedOutpostView[];
  /** Vorgebaute Missionsstrukturen der World uebernehmen den neuen Zielzustand. */
  readonly syncDormantBaseStates: () => void;
  readonly getActiveBurnSources: (enemyId: string, atMs: number) => ReadonlyArray<{ sourceKey: string }>;
  readonly getFireSystem: () => FireSystem | null;
  readonly getSmokeSystem: () => SmokePerceptionPort | null;
  readonly publishEncounterPresentation: (state: CoopDefenseEncounterPresentationState | null) => void;
  readonly publishMapEventPresentation: (state: CoopDefenseMapEventPresentationState | null) => void;
  readonly publishSecondaryObjectivePresentation: (
    state: CoopDefenseSecondaryObjectivePresentationState | null,
  ) => void;
}

/** Optionaler Messpunkt der Navigation; ohne Diagnose bleibt er ungenutzt. */
export interface CoopMissionNavigationMetrics {
  navIntentMs?: number;
  enemySpecialMs?: number;
  enemyPositioningMs?: number;
  enemyMovementMs?: number;
  enemyAlliesMs?: number;
  enemyAbilitiesMs?: number;
  enemyAttacksMs?: number;
  navFlowFieldMs: number;
  navWorkerComputeMs: number;
}

/**
 * Die activity-interne Update-Reihenfolge einer Coop-Mission.
 *
 * Sie gehoert der Activity und nicht dem Frame-Owner: Wer eine neue Coop-Mechanik ergaenzt,
 * ordnet sie hier ein und nicht in einem globalen Update-Zweig. Der Frame-Owner kennt nur noch
 * den Schritt als Ganzes.
 */
export class CoopMissionHostUpdate {
  private lastEncounterPresentationSignature: string | null = null;
  private lastMapEventPresentationState:
    | CoopDefenseMapEventPresentationState
    | null
    | undefined;
  private lastSecondaryObjectivePresentationSignature: string | null = null;

  constructor(
    private readonly runtime: CoopMissionRuntime,
    private readonly port: CoopMissionHostUpdatePort,
  ) {}

  /**
   * Ein Simulationsschritt der Mission.
   *
   * Reihenfolge mit fachlichem Grund: Erst steht der Missionsstand dieses Frames, dann richtet
   * sich die Navigation daran aus, danach bewegen und kaempfen die Gegner.
   */
  run(
    deltaMs: number,
    nowMs: number,
    countdownActive: boolean,
    weaponBalanceLabActive: boolean,
    metrics: CoopMissionNavigationMetrics | null = null,
  ): void {
    if (!this.runtime.analysisScenarioActive) {
      this.runProgressPhase(deltaMs, nowMs, countdownActive, weaponBalanceLabActive);
    }
    const navStartedAt = metrics ? performance.now() : 0;
    this.updateFlowFields(nowMs, deltaMs);
    if (metrics) {
      metrics.navFlowFieldMs = performance.now() - navStartedAt;
      metrics.navWorkerComputeMs = this.runtime.flowFieldCoordinator?.getDiagnostics().lastWorkerComputeMs ?? 0;
    }
    const intentStarted = metrics ? performance.now() : 0;
    this.runtime.coopDefenseDecoyTargetSystem?.updateLocks();
    this.runtime.enemyIntents?.update(this.runtime.enemyManager?.getAllEnemies() ?? [], nowMs);
    if (metrics) metrics.navIntentMs = performance.now() - intentStarted;
    this.runCombatPhase(deltaMs, nowMs, countdownActive, weaponBalanceLabActive, metrics);
  }

  /** Einmaliger synchroner Erstaufbau der Navigation im verborgenen Ladezustand. */
  prepareStartupCaches(nowMs: number): void {
    this.updateFlowFields(nowMs, 0, true);
  }

  /**
   * Letzter Schritt vor der Physik: Ein laufender Ausweichschritt ueberschreibt die
   * Wunschgeschwindigkeit aus Wegfindung und Angriffspause.
   */
  runPrePhysicsStep(nowMs: number): void {
    this.runtime.coopDefenseEnemyDodgeSystem?.hostUpdate(nowMs);
  }

  /** Missionsfortschritt, Ziele und der daraus folgende Druck. */
  private runProgressPhase(
    deltaMs: number,
    nowMs: number,
    countdownActive: boolean,
    weaponBalanceLabActive: boolean,
  ): void {
    this.runtime.coopDefenseBossSystem?.hostUpdate(deltaMs, countdownActive, nowMs);
    this.runtime.coopDefenseMissionProgressSystem?.hostUpdate(
      deltaMs,
      countdownActive || weaponBalanceLabActive,
      this.port.getPlayers().map((player) => ({
        playerId: player.id,
        x: player.x,
        y: player.y,
        eligible: this.port.canUseMissionActions(player.id) && this.port.isPlayerAlive(player.id),
      })),
    );
    this.runtime.coopDefenseMapDirector?.hostUpdate(deltaMs, countdownActive);
    this.runtime.coopDefenseMapEventDirector?.hostUpdate(deltaMs, countdownActive);
    this.runtime.coopDefenseSecondaryObjectiveSystem?.hostUpdate(deltaMs, countdownActive);
    this.publishEncounterPresentation();
    this.publishMapEventPresentation();
    this.publishSecondaryObjectivePresentation();
    // The objective snapshot is now current; activate prebuilt mission structures before
    // flow-field refresh and enemy movement in this same host frame.
    this.port.syncDormantBaseStates();
    // Reward-Ausführung nach dem Zustandswechsel und vor dem Basis-Snapshot dieses Frames.
    this.runtime.coopDefenseObjectiveRepairSystem?.hostUpdate(deltaMs, countdownActive);
    // Read active structure sources after the objective transition so pressure starts in the same
    // host frame in which its linked dormant base becomes active.
    this.runtime.coopDefensePersistentPressureSystem?.hostUpdate(deltaMs, countdownActive);
  }

  /** Gegner-Navigation, Bewegung und Kampf. */
  private runCombatPhase(
    deltaMs: number,
    nowMs: number,
    countdownActive: boolean,
    weaponBalanceLabActive: boolean,
    metrics: CoopMissionNavigationMetrics | null,
  ): void {
    let measuredAt = metrics ? performance.now() : 0;
    if (!countdownActive) this.runtime.coopDefenseTimebombSystem?.hostUpdate(nowMs);
    // Vor der Bewegung: Wer hat freien Boden erreicht bzw. seine maximale Grabzeit erschöpft?
    if (!countdownActive) this.runtime.coopDefenseEnemyBurrowSystem?.hostUpdate(nowMs);
    if (metrics) { metrics.enemySpecialMs = performance.now() - measuredAt; measuredAt = performance.now(); }
    // Gefechtsabstand vor der Bewegung bestimmen: das Ergebnis ersetzt für Fernkämpfer die
    // Wegfindung im selben Frame.
    if (!countdownActive) this.runtime.coopDefenseEnemyCombatPositioningSystem?.hostUpdate();
    if (metrics) { metrics.enemyPositioningMs = performance.now() - measuredAt; measuredAt = performance.now(); }
    this.runtime.enemyManager?.hostUpdateMovement(
      this.runtime.enemyFlowFieldService,
      this.runtime.enemyPlayerFlowFieldService,
      this.runtime.enemyStrategicFlowFieldService,
      this.runtime.enemyBossFlowFieldService,
      countdownActive || weaponBalanceLabActive,
      nowMs,
      deltaMs,
      this.port.getFireSystem(),
      (enemyId, at) => this.port.getActiveBurnSources(enemyId, at),
      this.runtime.coopDefenseEnemyTrainAwarenessSystem,
      this.runtime.coopDefenseEnemyBurrowSystem,
      this.runtime.coopDefenseEnemyCombatPositioningSystem,
      this.runtime.coopDefenseTimebombSystem,
      this.port.getSmokeSystem(),
      this.runtime.coopDefenseDecoyTargetSystem,
    );
    if (metrics) { metrics.enemyMovementMs = performance.now() - measuredAt; measuredAt = performance.now(); }
    if (!countdownActive) this.runtime.necromancySystem?.hostUpdate(nowMs, deltaMs);
    if (metrics) { metrics.enemyAlliesMs = performance.now() - measuredAt; measuredAt = performance.now(); }
    if (!countdownActive && !weaponBalanceLabActive) {
      this.runtime.coopDefenseVoidHunterSystem?.hostUpdate(nowMs);
      this.runtime.coopDefenseEnemyAbilitySystem?.hostUpdate(nowMs);
      if (metrics) { metrics.enemyAbilitiesMs = performance.now() - measuredAt; measuredAt = performance.now(); }
      this.runtime.coopDefenseEnemyAttackSystem?.hostUpdate(deltaMs, nowMs);
      if (metrics) metrics.enemyAttacksMs = performance.now() - measuredAt;
    }
  }

  private publishEncounterPresentation(): void {
    const state = this.runtime.coopDefenseMapDirector?.getPresentationState() ?? null;
    const signature = state
      ? [
        state.encounterId,
        state.sequenceIndex,
        state.sequenceCount,
        state.phase,
        state.phaseStartedAtMs,
        state.phaseEndsAtMs ?? 'open',
        state.spawnComplete ?? 'unknown',
        state.encounterFronts.join(','),
        state.fronts.join(','),
        // Jeder erledigte Gegner ist ein echter Anzeigewechsel und muss repliziert werden.
        state.enemiesDefeated ?? 'none',
        state.enemiesTotal ?? 'none',
      ].join('|')
      : null;
    if (signature === this.lastEncounterPresentationSignature) return;
    this.lastEncounterPresentationSignature = signature;
    this.port.publishEncounterPresentation(state);
  }

  private publishMapEventPresentation(): void {
    const state = this.runtime.coopDefenseMapEventDirector?.getPresentationState() ?? null;
    // Der Director cached den immutable-looking Presentation-State bis zum echten
    // Lifecycle-Wechsel. Referenzvergleich verhindert sowohl JSON-Serialisierung als auch
    // eine neue reliable Publikation pro Renderframe.
    if (state === this.lastMapEventPresentationState) return;
    this.lastMapEventPresentationState = state;
    this.port.publishMapEventPresentation(state);
  }

  private publishSecondaryObjectivePresentation(): void {
    const state = this.runtime.coopDefenseSecondaryObjectiveSystem?.getPresentationState() ?? null;
    const signature = state ? JSON.stringify(state) : null;
    if (signature === this.lastSecondaryObjectivePresentationSignature) return;
    this.lastSecondaryObjectivePresentationSignature = signature;
    this.port.publishSecondaryObjectivePresentation(state);
  }

  /**
   * Ziel-Katalog und Flowfields dieser Mission.
   *
   * Die Navigation entsteht ausschliesslich fuer die Coop-Activity und faellt mit ihr; deshalb
   * steht ihr Takt hier und nicht im Weltanteil des Frames.
   */
  private updateFlowFields(nowMs: number, deltaMs: number, force = false): void {
    const flowFieldCoordinator = this.runtime.flowFieldCoordinator;
    const playerFlowFieldService = this.runtime.enemyPlayerFlowFieldService;
    const bossFlowFieldService = this.runtime.enemyBossFlowFieldService;
    const strategicFlowFieldService = this.runtime.enemyStrategicFlowFieldService;
    const strategicTargetService = this.runtime.enemyStrategicTargetService;

    const targetCatalog = this.runtime.enemyAiTargetCatalog;
    const strategicGrid = strategicFlowFieldService ?? playerFlowFieldService;
    if (targetCatalog) {
      const candidates: EnemyAiTargetCandidate[] = [];
      for (const player of this.port.getPlayers()) {
        const goal = strategicGrid?.worldToGrid(player.x, player.y);
        candidates.push({
          kind: 'player',
          id: player.id,
          x: player.x,
          y: player.y,
          goalCells: goal ? [goal] : [],
          resolvePosition: () => this.port.getPlayerPosition(player.id),
          isTargetable: () => (
            player.active
            && this.port.isPlayerAlive(player.id)
            && !this.port.isPlayerBurrowed(player.id)
            && !this.port.isPlayerStealthed(player.id)
            && (this.port.isPlayerTargetable?.(player.id) ?? true)
          ),
        });
      }

      for (const decoy of this.port.getDecoyTargets()) {
        const goal = strategicGrid?.worldToGrid(decoy.x, decoy.y);
        candidates.push({
          kind: 'decoy',
          id: String(decoy.id),
          ownerId: decoy.ownerId,
          x: decoy.x,
          y: decoy.y,
          radius: decoy.radius,
          goalCells: goal ? [goal] : [],
          resolvePosition: () => this.port.getDecoyPosition(decoy.id),
          isTargetable: () => this.port.isDecoyTargetable(decoy.id),
        });
      }

      if (strategicGrid) {
        for (const construction of this.port.getArmedConstructions()) {
          const metrics = flowFieldCoordinator?.metrics;
          const world = metrics ? { x: metrics.arenaOffsetX + (construction.gridX + 0.5) * 32,
            y: metrics.arenaOffsetY + (construction.gridY + 0.5) * 32 } : null;
          if (!world) continue;
          candidates.push({
            kind: 'armed-construct',
            representedPlayerIds: construction.representedPlayerIds,
            skipRockIndex: Number(construction.id),
            id: construction.id,
            x: world.x,
            y: world.y,
            goalCells: buildAdjacentGoalCells([
              { gridX: construction.gridX, gridY: construction.gridY },
            ], strategicGrid),
            isTargetable: construction.isTargetable,
          });
        }

        for (const outpost of this.port.getArmedOutposts()) {
          candidates.push({
            kind: outpost.kind ?? 'armed-outpost',
            representedPlayerIds: outpost.representedPlayerIds,
            id: outpost.id,
            x: outpost.x,
            y: outpost.y,
            goalCells: buildAdjacentGoalCells(outpost.cells, strategicGrid),
            resolvePosition: (fromX, fromY) => outpost.resolveSurfacePoint(fromX, fromY),
            isTargetable: outpost.isTargetable,
          });
        }
      }
      targetCatalog.updateTargets(candidates);
      if (!this.runtime.enemyIntents && strategicFlowFieldService && strategicTargetService && flowFieldCoordinator) {
        // Zielzuordnung und Zielmenge reisen als ein Paket: Der Coordinator uebernimmt die
        // Zuordnung erst in dem Moment, in dem er das daraus gerechnete Feld aktiviert.
        const prepared = strategicTargetService.prepareTargets(targetCatalog.getStrategicCandidates().filter(target => target.kind !== 'decoy'));
        flowFieldCoordinator.setGoalCells(
          ENEMY_FLOW_FIELD_IDS.strategic,
          goalCellsToIndexes(prepared.goalCells, flowFieldCoordinator.metrics),
          prepared,
        );
      }
    }

    if (!flowFieldCoordinator) return;
    if (!playerFlowFieldService) {
      advanceFlowFields(flowFieldCoordinator, deltaMs, force);
      return;
    }

    const playerGoalCells: { gridX: number; gridY: number }[] = [];
    if (targetCatalog) {
      targetCatalog.forEachTarget('player-threats', (target) => {
        if (target.kind !== 'player' && target.goalCells?.length) { playerGoalCells.push(...target.goalCells); return; }
        const position = target.resolvePosition?.(0, 0) ?? { x: target.x, y: target.y };
        const goalCell = playerFlowFieldService.worldToGrid(position.x, position.y);
        if (!goalCell) return;
        playerGoalCells.push(goalCell);
      });
    } else {
      for (const player of this.port.getPlayers()) {
        if (!player.active) continue;
        if (!this.port.isPlayerAlive(player.id)) continue;
        if (this.port.isPlayerBurrowed(player.id)) continue;
        if (this.port.isPlayerStealthed(player.id)) continue;
        const goalCell = playerFlowFieldService.worldToGrid(player.x, player.y);
        if (!goalCell) continue;
        playerGoalCells.push(goalCell);
      }
    }

    const playerGoalIndexes = goalCellsToIndexes(playerGoalCells, flowFieldCoordinator.metrics);
    flowFieldCoordinator.setGoalCells(ENEMY_FLOW_FIELD_IDS.player, playerGoalIndexes);
    if (bossFlowFieldService) {
      flowFieldCoordinator.setGoalCells(ENEMY_FLOW_FIELD_IDS.boss, playerGoalIndexes);
    }

    if (targetCatalog) this.runtime.coopDefenseDecoyTargetSystem?.prepareOrdinaryGoals(targetCatalog.getCandidates('player-threats'));
    this.runtime.coopDefenseDecoyTargetSystem?.prepareNavigation();

    // Die Nekromantie setzt ihr gemeinsames Besitzer-Flowfield selbst auf den
    // aktuellen Gegner oder, beim Leash-Rueckzug, auf den Besitzer. Ein zweites
    // Ziel-Update hier wuerde das Angriffsziel jeden Frame wieder ueberschreiben.

    advanceFlowFields(flowFieldCoordinator, deltaMs, force);
  }
}

function advanceFlowFields(
  flowFieldCoordinator: NonNullable<CoopMissionRuntime['flowFieldCoordinator']>,
  deltaMs: number,
  force: boolean,
): void {
  // Der Erstaufbau laeuft im verborgenen Ladezustand einmalig synchron durch denselben Kernel.
  if (force) flowFieldCoordinator.prepareNow();
  else flowFieldCoordinator.advance(deltaMs);
}

function buildAdjacentGoalCells(
  occupiedCells: readonly { gridX: number; gridY: number }[],
  field: import('../systems/EnemyFlowFieldService').EnemyFlowFieldService,
): { gridX: number; gridY: number }[] {
  const result: { gridX: number; gridY: number }[] = [];
  for (const cell of occupiedCells) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const origin = field.gridToWorld(0, 0);
        if (!origin) continue;
        const offset = field.getCellSize() === 16 ? 0 : 16;
        const goal = field.worldToGrid(origin.x - offset + (cell.gridX + dx + 0.5) * 32,
          origin.y - offset + (cell.gridY + dy + 0.5) * 32);
        if (goal) result.push(goal);
      }
    }
  }
  return result;
}
