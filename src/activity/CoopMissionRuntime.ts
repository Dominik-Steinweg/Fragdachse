import type { EnemyManager } from '../entities/EnemyManager';
import type { CoopDefenseBossSystem } from '../systems/CoopDefenseBossSystem';
import type { CoopDefenseEnemyAbilitySystem } from '../systems/CoopDefenseEnemyAbilitySystem';
import type { CoopDefenseEnemyAttackSystem } from '../systems/CoopDefenseEnemyAttackSystem';
import type { CoopDefenseEnemyBurrowSystem } from '../systems/CoopDefenseEnemyBurrowSystem';
import type { CoopDefenseEnemyCombatPositioningSystem } from '../systems/CoopDefenseEnemyCombatPositioningSystem';
import type { CoopDefenseEnemyDodgeSystem } from '../systems/CoopDefenseEnemyDodgeSystem';
import type { CoopDefenseEnemyTrainAwarenessSystem } from '../systems/CoopDefenseEnemyTrainAwarenessSystem';
import type { CoopDefenseCarrySystem } from '../systems/CoopDefenseCarrySystem';
import type { CoopDefenseMapDirector } from '../systems/CoopDefenseMapDirector';
import type { CoopDefenseMapEventDirector } from '../systems/CoopDefenseMapEventDirector';
import type { CoopDefenseMissionBarrierManager } from '../systems/CoopDefenseMissionBarrierManager';
import type { CoopDefenseMissionProgressSystem } from '../systems/CoopDefenseMissionProgressSystem';
import type { CoopDefenseObjectivePlacementRewardSystem } from '../systems/CoopDefenseObjectivePlacementRewardSystem';
import type { CoopDefenseObjectiveRepairSystem } from '../systems/CoopDefenseObjectiveRepairSystem';
import type { CoopDefenseRoundStateSystem } from '../systems/CoopDefenseRoundStateSystem';
import type { CoopDefenseSecondaryObjectiveSystem } from '../systems/CoopDefenseSecondaryObjectiveSystem';
import type { CoopDefenseTeamBuffSystem } from '../systems/CoopDefenseTeamBuffSystem';
import type { CoopDefensePersistentPressureSystem } from '../systems/CoopDefensePersistentPressureSystem';
import type { CoopDefenseSpawnExecutor } from '../systems/CoopDefenseSpawnExecutor';
import type { CoopDefenseTimebombSystem } from '../systems/CoopDefenseTimebombSystem';
import type { CoopDefenseVoidHunterSystem } from '../systems/CoopDefenseVoidHunterSystem';
import { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';
import type { EnemyAiTargetCatalog } from '../systems/EnemyAiTargetCatalog';
import type { EnemyStrategicTargetService } from '../systems/EnemyStrategicTargetService';
import { allyFlowFieldId, type FlowFieldCoordinator } from '../systems/flowfield/FlowFieldCoordinator';
import type { NecromancySystem } from '../systems/NecromancySystem';
import type { CoopMissionPlayerRuntime } from './CoopMissionPlayerRuntime';
import type {
  CoopDefenseMissionProgressPresentationState,
  SyncedCoopDefenseCarryItem,
  SyncedCoopDefenseCarryState,
  SyncedEnemySnapshot,
} from '../types';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../config/coopDefenseMaps';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';
import type { ActivityRuntime } from '../world/ActivityRuntimeHost';
import {
  CoopMissionHostUpdate,
  type CoopMissionHostUpdatePort,
  type CoopMissionNavigationMetrics,
} from './CoopMissionHostUpdate';

export interface CoopMissionNavigationRuntime {
  readonly coordinator: FlowFieldCoordinator;
  readonly enemy: EnemyFlowFieldService;
  readonly player: EnemyFlowFieldService;
  readonly strategic: EnemyFlowFieldService;
  readonly boss: EnemyFlowFieldService | null;
  readonly targetCatalog: EnemyAiTargetCatalog;
  readonly strategicTarget: EnemyStrategicTargetService;
  readonly releaseGridChanges: () => void;
}

export interface CoopMissionEncounterRuntime {
  readonly spawnExecutor: CoopDefenseSpawnExecutor;
  readonly persistentPressure: CoopDefensePersistentPressureSystem | null;
  readonly boss: CoopDefenseBossSystem | null;
  readonly director: CoopDefenseMapDirector | null;
}

export interface CoopMissionEnemyBehaviourRuntime {
  readonly trainAwareness: CoopDefenseEnemyTrainAwarenessSystem;
  readonly burrow: CoopDefenseEnemyBurrowSystem;
  readonly dodge: CoopDefenseEnemyDodgeSystem;
  readonly combatPositioning: CoopDefenseEnemyCombatPositioningSystem;
  readonly ability: CoopDefenseEnemyAbilitySystem;
  readonly attack: CoopDefenseEnemyAttackSystem;
}

export interface CoopMissionEnemySpecialRuntime {
  readonly timebomb: CoopDefenseTimebombSystem | null;
  readonly voidHunter: CoopDefenseVoidHunterSystem | null;
}

/**
 * Das fachliche Ergebnis einer Coop-Mission.
 *
 * Die Activity ermittelt es und wendet es nicht an; welche Folgen es hat, entscheidet ein
 * nachgelagerter Owner. Deshalb steht der Begriff hier und nicht am Transport.
 */
export type CoopMissionOutcome = 'victory' | 'defeat';

/**
 * Ziele, Fortschritt und Abschluss genau dieser Mission.
 *
 * Sie stehen zusammen, weil sie dieselbe Lifetime und dieselbe fachliche Frage teilen: Was ist in
 * dieser Mission zu tun, wie weit ist es getan und wann ist sie vorbei. Der Abschluss selbst
 * bleibt ein reines Ergebnis; was daraus folgt, entscheidet ein nachgelagerter Owner.
 */
export interface CoopMissionObjectiveRuntime {
  readonly secondaryObjectives: CoopDefenseSecondaryObjectiveSystem | null;
  readonly missionProgress: CoopDefenseMissionProgressSystem | null;
  /** Lokale Darstellung und Kollision der Fortschrittsbarrieren dieser Mission. */
  readonly barriers: CoopDefenseMissionBarrierManager | null;
  readonly carry: CoopDefenseCarrySystem | null;
  readonly repair: CoopDefenseObjectiveRepairSystem | null;
  readonly placementReward: CoopDefenseObjectivePlacementRewardSystem | null;
  /** Host-autoritative Ermittlung von Sieg und Niederlage dieser Mission. */
  readonly roundState: CoopDefenseRoundStateSystem | null;
  /** Round-local team reward buff; it must not survive an Activity change. */
  readonly teamBuff: CoopDefenseTeamBuffSystem | null;
}

/** Was dieser Peer aus dem replizierten Missionsstand lokal darstellt. */
export interface CoopMissionClientPresentationPort {
  readonly getMissionProgressPresentationState: () => CoopDefenseMissionProgressPresentationState | null;
}

/** Die unveraenderlichen Client-Eingaben fuer genau einen Activity-Presentation-Step. */
export interface CoopMissionClientPresentationFrame {
  readonly stateAvailable: boolean;
  readonly newSnapshot: boolean;
  readonly enemySnapshot: SyncedEnemySnapshot | null;
  readonly carryItems: readonly SyncedCoopDefenseCarryItem[];
  readonly interpolationFactor: number;
}

/**
 * Die Aussenanschluesse der Mission.
 *
 * Sie werden mit der Runtime uebergeben und nicht nachtraeglich gesetzt: Ein Activity-Wechsel in
 * derselben World materialisiert die Mission neu, ihre Fragen an World und Scene bleiben dabei
 * dieselben.
 */
export interface CoopMissionRuntimePorts {
  readonly hostUpdate: CoopMissionHostUpdatePort;
  readonly clientPresentation: CoopMissionClientPresentationPort;
}

/**
 * Der Missionsanteil eines Frames, so weit ein Frame-Owner ihn kennt.
 *
 * Bewusst nur benannte Schritte: Welche Systeme dahinter laufen und in welcher Reihenfolge,
 * entscheidet die Activity. Eine neue Coop-Mechanik braucht deshalb keinen neuen globalen
 * Update-Zweig.
 */
export interface CoopMissionActivityStep {
  readonly hostPrepareStartupCaches: (nowMs: number) => void;
  readonly hostSimulationStep: (
    deltaMs: number,
    nowMs: number,
    countdownActive: boolean,
    weaponBalanceLabActive: boolean,
    metrics?: CoopMissionNavigationMetrics | null,
  ) => void;
  readonly hostPrePhysicsStep: (nowMs: number) => void;
  readonly hostCarrySnapshot: (interactionsEnabled: boolean) => SyncedCoopDefenseCarryState;
  readonly hostResolveCompletion: () => CoopMissionOutcome | null;
  readonly hostApplyDebugBaseDamage: (amount: number) => void;
  readonly clientPresentationStep: (frame?: CoopMissionClientPresentationFrame) => void;
}

export type CoopMissionRuntimeBindingsChanged = (runtime: CoopMissionRuntime | null) => void;

/** Gerichtete Bindung eines langlebigeren Systems an genau diese Activity. */
export interface CoopMissionScopedBinding {
  readonly attach: (runtime: CoopMissionRuntime) => void;
  readonly detach: () => void;
  /** Optionaler Anteil des bereits kanonischen clientseitigen Activity-Steps. */
  readonly clientPresentationStep?: (frame: CoopMissionClientPresentationFrame) => void;
}

/**
 * Lokale Realisierung genau einer Coop-Mission.
 *
 * Der Owner bleibt absichtlich konkret: Er besitzt den heute realen Enemy-, Navigation-,
 * Encounter- und Boss-State dieser Activity und keine Registry fuer hypothetische Activities.
 * Die scene-langlebigen Combat-/Projectile-/Physics-/Fire-Systeme werden nur referenziert und
 * bleiben ausserhalb dieses Teardowns.
 */
export class CoopMissionRuntime implements ActivityRuntime, CoopMissionActivityStep {
  private enemyOwner: EnemyManager | null = null;
  private navigationOwner: CoopMissionNavigationRuntime | null = null;
  private encounterOwner: CoopMissionEncounterRuntime | null = null;
  private enemyBehaviourOwner: CoopMissionEnemyBehaviourRuntime | null = null;
  private enemySpecialOwner: CoopMissionEnemySpecialRuntime | null = null;
  private necromancyOwner: NecromancySystem | null = null;
  private mapEventOwner: CoopDefenseMapEventDirector | null = null;
  private objectiveOwner: CoopMissionObjectiveRuntime | null = null;
  private playerActivityOwner: CoopMissionPlayerRuntime | null = null;
  private scopedBindings: CoopMissionScopedBinding[] = [];
  private destroyed = false;
  /** Die activity-interne Host-Reihenfolge; ohne Ports laeuft diese Mission nicht als Host. */
  private readonly hostUpdateOwner: CoopMissionHostUpdate | null;

  /** Ally-Felder werden mit der Activity erzeugt und bei ihrem Ende vollstaendig verworfen. */
  readonly allyFlowFields = new Map<string, EnemyFlowFieldService>();
  private secondaryObjectiveConfigsValue: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[] = [];

  constructor(
    readonly descriptor: ActivityDescriptor,
    private readonly bindingsChanged: CoopMissionRuntimeBindingsChanged = () => { /* noop */ },
    private readonly ports: CoopMissionRuntimePorts | null = null,
  ) {
    if (descriptor.kind !== 'coop-mission') {
      throw new Error(
        `[CoopMissionRuntime] Activity ${descriptor.definitionId} is ${descriptor.kind}, not coop-mission`,
      );
    }
    this.hostUpdateOwner = ports ? new CoopMissionHostUpdate(this, ports.hostUpdate) : null;
  }

  get enemyManager(): EnemyManager | null { return this.enemyOwner; }
  get flowFieldCoordinator(): FlowFieldCoordinator | null { return this.navigationOwner?.coordinator ?? null; }
  get enemyFlowFieldService(): EnemyFlowFieldService | null { return this.navigationOwner?.enemy ?? null; }
  get enemyPlayerFlowFieldService(): EnemyFlowFieldService | null { return this.navigationOwner?.player ?? null; }
  get enemyStrategicFlowFieldService(): EnemyFlowFieldService | null { return this.navigationOwner?.strategic ?? null; }
  get enemyBossFlowFieldService(): EnemyFlowFieldService | null { return this.navigationOwner?.boss ?? null; }
  get enemyAiTargetCatalog(): EnemyAiTargetCatalog | null { return this.navigationOwner?.targetCatalog ?? null; }
  get enemyStrategicTargetService(): EnemyStrategicTargetService | null {
    return this.navigationOwner?.strategicTarget ?? null;
  }
  get coopDefenseSpawnExecutor(): CoopDefenseSpawnExecutor | null {
    return this.encounterOwner?.spawnExecutor ?? null;
  }
  get coopDefensePersistentPressureSystem(): CoopDefensePersistentPressureSystem | null {
    return this.encounterOwner?.persistentPressure ?? null;
  }
  get coopDefenseBossSystem(): CoopDefenseBossSystem | null { return this.encounterOwner?.boss ?? null; }
  get coopDefenseMapDirector(): CoopDefenseMapDirector | null { return this.encounterOwner?.director ?? null; }
  get coopDefenseMapEventDirector(): CoopDefenseMapEventDirector | null { return this.mapEventOwner; }
  get coopDefenseEnemyTrainAwarenessSystem(): CoopDefenseEnemyTrainAwarenessSystem | null {
    return this.enemyBehaviourOwner?.trainAwareness ?? null;
  }
  get coopDefenseEnemyBurrowSystem(): CoopDefenseEnemyBurrowSystem | null {
    return this.enemyBehaviourOwner?.burrow ?? null;
  }
  get coopDefenseEnemyDodgeSystem(): CoopDefenseEnemyDodgeSystem | null {
    return this.enemyBehaviourOwner?.dodge ?? null;
  }
  get coopDefenseEnemyCombatPositioningSystem(): CoopDefenseEnemyCombatPositioningSystem | null {
    return this.enemyBehaviourOwner?.combatPositioning ?? null;
  }
  get coopDefenseEnemyAbilitySystem(): CoopDefenseEnemyAbilitySystem | null {
    return this.enemyBehaviourOwner?.ability ?? null;
  }
  get coopDefenseEnemyAttackSystem(): CoopDefenseEnemyAttackSystem | null {
    return this.enemyBehaviourOwner?.attack ?? null;
  }
  get coopDefenseTimebombSystem(): CoopDefenseTimebombSystem | null {
    return this.enemySpecialOwner?.timebomb ?? null;
  }
  get coopDefenseVoidHunterSystem(): CoopDefenseVoidHunterSystem | null {
    return this.enemySpecialOwner?.voidHunter ?? null;
  }
  get necromancySystem(): NecromancySystem | null { return this.necromancyOwner; }
  get coopDefenseSecondaryObjectiveSystem(): CoopDefenseSecondaryObjectiveSystem | null {
    return this.objectiveOwner?.secondaryObjectives ?? null;
  }
  get coopDefenseMissionProgressSystem(): CoopDefenseMissionProgressSystem | null {
    return this.objectiveOwner?.missionProgress ?? null;
  }
  get coopDefenseMissionBarrierManager(): CoopDefenseMissionBarrierManager | null {
    return this.objectiveOwner?.barriers ?? null;
  }
  get coopDefenseCarrySystem(): CoopDefenseCarrySystem | null {
    return this.objectiveOwner?.carry ?? null;
  }
  get coopDefenseObjectiveRepairSystem(): CoopDefenseObjectiveRepairSystem | null {
    return this.objectiveOwner?.repair ?? null;
  }
  get coopDefenseObjectivePlacementRewardSystem(): CoopDefenseObjectivePlacementRewardSystem | null {
    return this.objectiveOwner?.placementReward ?? null;
  }
  get coopDefenseTeamBuffSystem(): CoopDefenseTeamBuffSystem | null {
    return this.objectiveOwner?.teamBuff ?? null;
  }
  /**
   * Der activity-spezifische Spielerzustand dieser Mission.
   *
   * Er existiert nur, solange sie laeuft: Ein Activity-Wechsel in derselben World zerstoert ihn
   * und materialisiert ihn fuer die neue Mission neu, waehrend die `PlayerWorldRuntime` steht.
   */
  get playerActivity(): CoopMissionPlayerRuntime | null { return this.playerActivityOwner; }

  get secondaryObjectiveConfigs(): readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[] {
    return this.secondaryObjectiveConfigsValue;
  }

  setSecondaryObjectiveConfigs(
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
  ): void {
    this.secondaryObjectiveConfigsValue = configs;
  }

  setEnemyManager(manager: EnemyManager): void {
    this.claimEmptySlot('enemy manager', this.enemyOwner);
    this.enemyOwner = manager;
    this.publishBindings();
  }

  setNavigation(runtime: CoopMissionNavigationRuntime): void {
    this.claimEmptySlot('navigation runtime', this.navigationOwner);
    this.navigationOwner = runtime;
    this.publishBindings();
  }

  setEncounter(runtime: CoopMissionEncounterRuntime): void {
    this.claimEmptySlot('encounter runtime', this.encounterOwner);
    this.encounterOwner = runtime;
    this.publishBindings();
  }

  setEnemyBehaviour(runtime: CoopMissionEnemyBehaviourRuntime): void {
    this.claimEmptySlot('enemy behaviour runtime', this.enemyBehaviourOwner);
    this.enemyBehaviourOwner = runtime;
    this.publishBindings();
  }

  setEnemySpecials(runtime: CoopMissionEnemySpecialRuntime): void {
    this.claimEmptySlot('enemy special runtime', this.enemySpecialOwner);
    this.enemySpecialOwner = runtime;
    this.publishBindings();
  }

  setNecromancy(system: NecromancySystem): void {
    this.claimEmptySlot('necromancy runtime', this.necromancyOwner);
    this.necromancyOwner = system;
    this.publishBindings();
  }

  setMapEventDirector(director: CoopDefenseMapEventDirector): void {
    this.claimEmptySlot('map event director', this.mapEventOwner);
    this.mapEventOwner = director;
    this.publishBindings();
  }

  setObjectives(runtime: CoopMissionObjectiveRuntime): void {
    this.claimEmptySlot('objective runtime', this.objectiveOwner);
    this.objectiveOwner = runtime;
    this.publishBindings();
  }

  setPlayerActivity(runtime: CoopMissionPlayerRuntime): void {
    this.claimEmptySlot('player activity runtime', this.playerActivityOwner);
    this.playerActivityOwner = runtime;
    this.publishBindings();
  }

  /** Bindet einen laenger lebenden Consumer; Detach loest ihn vor allen Child-Ownern. */
  bind(binding: CoopMissionScopedBinding): void {
    this.claimEmptySlot('scoped binding', null);
    this.scopedBindings.push(binding);
    binding.attach(this);
  }

  ensureAllyFlowField(playerId: string): void {
    if (this.destroyed) return;
    const coordinator = this.navigationOwner?.coordinator;
    if (!coordinator || this.allyFlowFields.has(playerId)) return;
    this.allyFlowFields.set(
      playerId,
      EnemyFlowFieldService.fromView(
        coordinator.registerField(allyFlowFieldId(playerId), { goalMode: 'dynamic-fallback-bases' }),
      ),
    );
    this.publishBindings();
  }

  /** Entfernt ein persoenliches Ally-Feld aus Map und Coordinator; wiederholt wirkungslos. */
  removeAllyFlowField(playerId: string): void {
    const flowField = this.allyFlowFields.get(playerId);
    if (!flowField) return;
    this.allyFlowFields.delete(playerId);
    this.navigationOwner?.coordinator.unregisterField(allyFlowFieldId(playerId));
    flowField.destroy();
    // Beim Activity-Destroy ist der Runtime-Slot bereits geloest. Ein erneutes Publish wuerde
    // den sterbenden Runtime-Owner sonst ueber langlebige Bindings wieder sichtbar machen.
    if (!this.destroyed) this.publishBindings();
  }

  /**
   * Lifecycle-Tick ueber den `ActivityRuntimeHost`.
   *
   * Der fachliche Simulationsschritt der Mission haengt an der Rolle und an einer festen Stelle
   * des Frames; er laeuft ueber {@link hostSimulationStep} und {@link clientPresentationStep}.
   * Beide Reihenfolgen gehoeren dieser Runtime - der Aufrufer kennt nur den Schritt.
   */
  update(_deltaMs: number): void {
    if (this.destroyed) return;
  }

  /** Einmaliger synchroner Navigationsaufbau im verborgenen Ladezustand. */
  hostPrepareStartupCaches(nowMs: number): void {
    if (this.destroyed) return;
    this.hostUpdateOwner?.prepareStartupCaches(nowMs);
  }

  /** Ein vollstaendiger Simulationsschritt der Mission: Fortschritt, Navigation, Gegner. */
  hostSimulationStep(
    deltaMs: number,
    nowMs: number,
    countdownActive: boolean,
    weaponBalanceLabActive: boolean,
    metrics: CoopMissionNavigationMetrics | null = null,
  ): void {
    if (this.destroyed) return;
    this.hostUpdateOwner?.run(deltaMs, nowMs, countdownActive, weaponBalanceLabActive, metrics);
  }

  /** Missionsanteil unmittelbar vor der Physik dieses Frames. */
  hostPrePhysicsStep(nowMs: number): void {
    if (this.destroyed) return;
    this.hostUpdateOwner?.runPrePhysicsStep(nowMs);
  }

  /** Getragene Missionsziele fuer den Snapshot dieses Frames. */
  hostCarrySnapshot(interactionsEnabled: boolean): SyncedCoopDefenseCarryState {
    if (this.destroyed) return [];
    return this.objectiveOwner?.carry?.hostUpdate(interactionsEnabled) ?? [];
  }

  /**
   * Das fachliche Ergebnis dieser Mission, sobald es feststeht.
   *
   * Die Runtime ermittelt es und wendet es nicht an: Was daraus folgt, entscheidet der Owner der
   * Uebergaenge.
   */
  hostResolveCompletion(): CoopMissionOutcome | null {
    if (this.destroyed) return null;
    return this.objectiveOwner?.roundState?.update() ?? null;
  }

  /** Diagnoseweg auf den Missionsabschluss; ohne laufende Mission wirkungslos. */
  hostApplyDebugBaseDamage(amount: number): void {
    if (this.destroyed) return;
    this.objectiveOwner?.roundState?.applyDebugBaseDamage(amount);
  }

  /** Lokale Darstellung des replizierten Missionsstands auf einem Client. */
  clientPresentationStep(frame?: CoopMissionClientPresentationFrame): void {
    if (this.destroyed) return;
    if (this.ports) {
      this.objectiveOwner?.barriers?.syncPresentationState(
        this.ports.clientPresentation.getMissionProgressPresentationState(),
      );
    }
    const clientFrame = frame ?? {
      stateAvailable: false,
      newSnapshot: false,
      enemySnapshot: null,
      carryItems: [],
      interpolationFactor: 0,
    } satisfies CoopMissionClientPresentationFrame;
    for (const binding of this.scopedBindings) {
      binding.clientPresentationStep?.(clientFrame);
    }
  }

  /** Vollstaendiger, idempotenter Teardown aller Child-Owner dieser Mission. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.secondaryObjectiveConfigsValue = [];

    const scopedBindings = this.scopedBindings;
    this.scopedBindings = [];
    for (const binding of [...scopedBindings].reverse()) binding.detach();
    // Langlebige Consumer sehen die Activity ab jetzt nicht mehr. Das geschieht vor dem Entity-
    // Teardown, damit kein Destroy-Callback ueber einen langlebigeren Service zurueckgreift.
    this.bindingsChanged(null);

    // Der Missionsanteil der Spieler faellt zuerst: Sein Abbau gibt gehaltene Ziele frei und
    // entfernt dabei die persoenlichen Ally-Felder, solange Navigation noch lebt.
    this.playerActivityOwner?.destroy();
    // Defensive Restbereinigung fuer Felder, die ohne Player-Ledger materialisiert wurden. Auch
    // dieser Pfad deregistriert jedes Feld einzeln, bevor der Coordinator faellt.
    for (const playerId of [...this.allyFlowFields.keys()]) this.removeAllyFlowField(playerId);

    // Ziele und Fortschritt folgen: Sie steuern Directors und Druck, nicht umgekehrt.
    this.objectiveOwner?.carry?.destroy();
    this.objectiveOwner?.placementReward?.reset();
    this.objectiveOwner?.repair?.reset();
    this.objectiveOwner?.secondaryObjectives?.reset();
    this.objectiveOwner?.missionProgress?.reset();
    this.objectiveOwner?.teamBuff?.reset();
    this.objectiveOwner?.barriers?.destroy();

    // Abhaengige Directors und Behaviour-Systeme fallen vor Gegnern und Navigation.
    this.mapEventOwner?.reset();
    this.encounterOwner?.director?.reset();
    this.encounterOwner?.persistentPressure?.reset();
    this.encounterOwner?.boss?.reset();

    this.enemySpecialOwner?.voidHunter?.clear();
    this.enemySpecialOwner?.timebomb?.clear();
    this.enemyBehaviourOwner?.ability.clear();
    this.enemyBehaviourOwner?.burrow.clear();
    this.enemyBehaviourOwner?.dodge.clear();
    this.enemyBehaviourOwner?.combatPositioning.clear();
    this.enemyBehaviourOwner?.trainAwareness.clear();

    this.necromancyOwner?.setCorpseSink(null);
    this.necromancyOwner?.clear();
    this.enemyOwner?.setLethalDamageGuard(null);
    this.enemyOwner?.setEnemySpawnedCallback(null);
    this.enemyOwner?.destroy();
    this.enemyOwner?.setVisualSink(null);

    this.navigationOwner?.strategicTarget.clear();
    this.navigationOwner?.targetCatalog.clear();
    this.navigationOwner?.enemy.destroy();
    this.navigationOwner?.player.destroy();
    this.navigationOwner?.strategic.destroy();
    this.navigationOwner?.boss?.destroy();
    this.navigationOwner?.releaseGridChanges();
    this.navigationOwner?.coordinator.destroy();

    this.playerActivityOwner = null;
    this.objectiveOwner = null;
    this.mapEventOwner = null;
    this.necromancyOwner = null;
    this.enemySpecialOwner = null;
    this.enemyBehaviourOwner = null;
    this.encounterOwner = null;
    this.navigationOwner = null;
    this.enemyOwner = null;
  }

  private claimEmptySlot(name: string, current: object | null): void {
    if (this.destroyed) {
      throw new Error(`[CoopMissionRuntime] Cannot attach ${name} after destroy`);
    }
    if (current) {
      throw new Error(`[CoopMissionRuntime] ${name} is already attached`);
    }
  }

  private publishBindings(): void {
    this.bindingsChanged(this);
    for (const binding of this.scopedBindings) binding.attach(this);
  }
}
