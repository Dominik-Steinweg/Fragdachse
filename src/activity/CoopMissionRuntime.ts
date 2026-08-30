import type { EnemyManager } from '../entities/EnemyManager';
import type { CoopDefenseBossSystem } from '../systems/CoopDefenseBossSystem';
import type { CoopDefenseEnemyAbilitySystem } from '../systems/CoopDefenseEnemyAbilitySystem';
import type { CoopDefenseEnemyAttackSystem } from '../systems/CoopDefenseEnemyAttackSystem';
import type { CoopDefenseEnemyBurrowSystem } from '../systems/CoopDefenseEnemyBurrowSystem';
import type { CoopDefenseEnemyCombatPositioningSystem } from '../systems/CoopDefenseEnemyCombatPositioningSystem';
import type { CoopDefenseEnemyDodgeSystem } from '../systems/CoopDefenseEnemyDodgeSystem';
import type { CoopDefenseEnemyTrainAwarenessSystem } from '../systems/CoopDefenseEnemyTrainAwarenessSystem';
import type { CoopDefenseMapDirector } from '../systems/CoopDefenseMapDirector';
import type { CoopDefenseMapEventDirector } from '../systems/CoopDefenseMapEventDirector';
import type { CoopDefensePersistentPressureSystem } from '../systems/CoopDefensePersistentPressureSystem';
import type { CoopDefenseSpawnExecutor } from '../systems/CoopDefenseSpawnExecutor';
import type { CoopDefenseTimebombSystem } from '../systems/CoopDefenseTimebombSystem';
import type { CoopDefenseVoidHunterSystem } from '../systems/CoopDefenseVoidHunterSystem';
import { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';
import type { EnemyAiTargetCatalog } from '../systems/EnemyAiTargetCatalog';
import type { EnemyStrategicTargetService } from '../systems/EnemyStrategicTargetService';
import { allyFlowFieldId, type FlowFieldCoordinator } from '../systems/flowfield/FlowFieldCoordinator';
import type { NecromancySystem } from '../systems/NecromancySystem';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';
import type { ActivityRuntime } from '../world/ActivityRuntimeHost';

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

export type CoopMissionRuntimeBindingsChanged = (runtime: CoopMissionRuntime | null) => void;

/** Gerichtete Bindung eines langlebigeren Systems an genau diese Activity. */
export interface CoopMissionScopedBinding {
  readonly attach: (runtime: CoopMissionRuntime) => void;
  readonly detach: () => void;
}

export type CoopMissionMaterializationStep = (runtime: CoopMissionRuntime) => void;

/**
 * Lokale Realisierung genau einer Coop-Mission.
 *
 * Der Owner bleibt absichtlich konkret: Er besitzt den heute realen Enemy-, Navigation-,
 * Encounter- und Boss-State dieser Activity und keine Registry fuer hypothetische Activities.
 * Die scene-langlebigen Combat-/Projectile-/Physics-/Fire-Systeme werden nur referenziert und
 * bleiben ausserhalb dieses Teardowns.
 */
export class CoopMissionRuntime implements ActivityRuntime {
  private enemyOwner: EnemyManager | null = null;
  private navigationOwner: CoopMissionNavigationRuntime | null = null;
  private encounterOwner: CoopMissionEncounterRuntime | null = null;
  private enemyBehaviourOwner: CoopMissionEnemyBehaviourRuntime | null = null;
  private enemySpecialOwner: CoopMissionEnemySpecialRuntime | null = null;
  private necromancyOwner: NecromancySystem | null = null;
  private mapEventOwner: CoopDefenseMapEventDirector | null = null;
  private scopedBindings: CoopMissionScopedBinding[] = [];
  private materializationSteps: CoopMissionMaterializationStep[] = [];
  private destroyed = false;

  /** Ally-Felder werden mit der Activity erzeugt und bei ihrem Ende vollstaendig verworfen. */
  readonly allyFlowFields = new Map<string, EnemyFlowFieldService>();

  constructor(
    readonly descriptor: ActivityDescriptor,
    private readonly bindingsChanged: CoopMissionRuntimeBindingsChanged = () => { /* noop */ },
  ) {
    if (descriptor.kind !== 'coop-mission') {
      throw new Error(
        `[CoopMissionRuntime] Activity ${descriptor.definitionId} is ${descriptor.kind}, not coop-mission`,
      );
    }
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

  /** Bindet einen laenger lebenden Consumer; Detach loest ihn vor allen Child-Ownern. */
  bind(binding: CoopMissionScopedBinding): void {
    this.claimEmptySlot('scoped binding', null);
    this.scopedBindings.push(binding);
    binding.attach(this);
  }

  /** Merkt den echten Aufbaupfad eines Child-Owners fuer Activity-Wechsel in derselben World. */
  addMaterializationStep(step: CoopMissionMaterializationStep): void {
    this.claimEmptySlot('materialization step', null);
    this.materializationSteps.push(step);
  }

  exportMaterialization(): readonly CoopMissionMaterializationStep[] {
    return [...this.materializationSteps];
  }

  materialize(steps: readonly CoopMissionMaterializationStep[]): void {
    this.claimEmptySlot('activity materialization', null);
    for (const step of steps) step(this);
    this.materializationSteps = [...steps];
  }

  ensureAllyFlowField(playerId: string): void {
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

  /**
   * Der Activity-Tick laeuft bereits ueber `ActivityRuntimeHost`. Phase 6 uebernimmt die heute
   * noch in Host-/Client-Coordinatoren liegende fachliche Update-Reihenfolge in diesen Owner.
   */
  update(_deltaMs: number): void {
    if (this.destroyed) return;
  }

  /** Vollstaendiger, idempotenter Teardown aller in Phase 5 uebernommenen Child-Owner. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const scopedBindings = this.scopedBindings;
    this.scopedBindings = [];
    this.materializationSteps = [];
    for (const binding of [...scopedBindings].reverse()) binding.detach();
    // Compatibility-Consumer sehen die Activity ab jetzt nicht mehr. Das geschieht vor dem
    // Entity-Teardown, damit kein Destroy-Callback ueber einen langlebigeren Service zurueckgreift.
    this.bindingsChanged(null);

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
    for (const flowField of this.allyFlowFields.values()) flowField.destroy();
    this.allyFlowFields.clear();
    this.navigationOwner?.releaseGridChanges();
    this.navigationOwner?.coordinator.destroy();

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
