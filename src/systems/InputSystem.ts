import * as Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { BurrowPhase, ConstructionId, LoadoutToolRef, LoadoutUseResult, PlacementPreviewNetState, PlayerInput, LoadoutSlot, LoadoutUseParams, TemporaryUtilityInstanceDescriptor, UltimateChargePreviewState, UtilityChargePreviewState, UtilityPlacementPreviewState, UtilityTargetingPreviewState } from '../types';
import {
  DASH_T1_S, DASH_T2_S,
  clampPointToArena,
  COLORS,
} from '../config';
import { COOP_DEFENSE_CONSTRUCTION_CAPACITY, getConstructionIdForUtility, getUtilityIdForConstruction, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { quantizeAngle } from '../utils/angle';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { RadialActionMenu } from '../ui/RadialActionMenu';
import {
  cloneRadialActionRef,
  isSameRadialActionRef,
  radialActionKey,
  radialActionRefFromTool,
  resolveRadialActions,
  type RadialActionRef,
  type RadialActionState,
  type RadialManagementAction,
} from './RadialActionModel';
import type { CameraFeedbackController } from '../effects/camera/CameraFeedbackController';
import { chargeRumble } from '../effects/camera/cameraFeedbackPresets';
import { getUnshakenPointerWorldPoint } from '../graphics/cameraBaseScroll';
import { maySendWorldInput } from '../world/WorldParticipation';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';

const DASH_CYCLE_MS = (DASH_T1_S + DASH_T2_S) * 1000; // 600ms Gesamtzyklusdauer
import type {
  AirstrikeUltimateConfig,
  ChargedThrowUtilityActivationConfig,
  ChargedGateUtilityActivationConfig,
  GaussUltimateConfig,
  PlacementModeUtilityActivationConfig,
  ScopeModeConfig,
  TargetedClickUtilityActivationConfig,
  TunnelUltimateConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from '../loadout/LoadoutConfig';
import { getUtilityConfigForMode } from '../loadout/LoadoutConfig';

/** Gemeinsamer Nenner für alle aufladbaren Utility-Aktivierungen. */
type ChargeableActivation = ChargedThrowUtilityActivationConfig | ChargedGateUtilityActivationConfig;
type ChargeableUtilityConfig = UtilityConfig & { activation: ChargeableActivation };
type TargetedActivation = TargetedClickUtilityActivationConfig;
type PlacementActivation = PlacementModeUtilityActivationConfig;

type DebugHotkeyType = 'flowfield_bases' | 'flowfield_players';

const PRIMARY_POINTER_BUTTON = 1;
const SECONDARY_POINTER_BUTTON = 2;

/**
 * Filtert Pointerbuttons, die bereits die UI-Aktion des aktuellen Press/Release-Zyklus
 * ausgeloest haben. Erst ihr Release entfernt sie aus der Consume-Maske; ein spaeterer neuer
 * Press ist wieder Gameplay-Input.
 */
export function resolvePointerButtonHandoff(
  heldButtons: number,
  consumedButtons: number,
): { readonly gameplayButtons: number; readonly consumedButtons: number } {
  const stillConsumed = consumedButtons & heldButtons;
  return {
    gameplayButtons: heldButtons & ~stillConsumed,
    consumedButtons: stillConsumed,
  };
}

export class InputSystem {
  private scene:           Phaser.Scene;
  private bridge:          NetworkBridge;
  private getLocalSprite:  () => Phaser.GameObjects.Image | undefined;

  private keyW!:     Phaser.Input.Keyboard.Key;
  private keyA!:     Phaser.Input.Keyboard.Key;
  private keyS!:     Phaser.Input.Keyboard.Key;
  private keyD!:     Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyShift!: Phaser.Input.Keyboard.Key;
  private keyE!:     Phaser.Input.Keyboard.Key;
  private keyQ!:     Phaser.Input.Keyboard.Key;
  private keyR!:     Phaser.Input.Keyboard.Key;
  private keyB!:     Phaser.Input.Keyboard.Key;
  private keyN!:     Phaser.Input.Keyboard.Key;

  // Lokaler Dash-Cooldown (nur für HUD-Visualisierung, kein Gameplay-Impact)
  private dashCooldownUntil = 0;  // ms-Timestamp

  // Debug Hotkey Callback
  private onDebugHotkey: ((type: DebugHotkeyType) => void) | null = null;

  // Loadout-Callback (gesetzt von ArenaScene)
  private onLoadoutUse: ((slot: LoadoutSlot, angle: number, targetX: number, targetY: number, params?: LoadoutUseParams) => void) | null = null;
  private getLocalUtilityConfig: (() => UtilityConfig | undefined) | null = null;
  private getLocalUtilityCooldownUntil: (() => number) | null = null;
  private getLocalUltimateConfig: (() => UltimateConfig | undefined) | null = null;
  private getLocalRage: (() => number) | null = null;
  /** Optimistic cooldowns keyed by the same stable identity used by the radial action model. */
  private readonly predictedUtilityCooldownUntil = new Map<string, number>();
  public onUtilityPressedDuringCooldown: (() => void) | null = null;
  public onUltimatePressedWithoutRage: (() => void) | null = null;
  private utilityHoldActive = false;
  private utilityChargeEligibleAt: number | null = null;
  private utilityChargeStartedAt: number | null = null;
  private utilityChargeAction: RadialActionRef | null = null;
  private utilityChargeConfig: ChargeableUtilityConfig | null = null;
  private utilityChargeParams: LoadoutUseParams | undefined;
  private utilityTargetingActive = false;
  private utilityPlacementActive = false;
  private ultimatePlacementActive = false;
  private ultimateHoldActive = false;
  private ultimateChargeStartedAt: number | null = null;
  private ultimateTargetingActive = false;   // Zielmodus für Airstrike-Ultimate
  private getUtilityPlacementPreviewProvider: (() => UtilityPlacementPreviewState | undefined) | null = null;
  private getUltimatePlacementPreviewProvider: (() => UtilityPlacementPreviewState | undefined) | null = null;
  private placementPreviewState: PlacementPreviewNetState | null = null;
  private tunnelPlacementAnchor: { x: number; y: number; gridX: number; gridY: number } | null = null;
  private prevLeftPointerDown = false;
  private prevRightPointerDown = false;
  private consumedPointerButtons = 0;
  /** RMB pressed while LMB had priority; consume it only once Waffe 2 gets the turn. */
  private pendingRightInputStarted = false;
  private suppressWeapon1UntilLeftRelease = false;
  private getConstructionPlacementPreviewProvider: ((
    constructionId: ConstructionId,
  ) => UtilityPlacementPreviewState | undefined) | null = null;
  private radialGetTools: (() => readonly LoadoutToolRef[]) | null = null;
  private radialGetSelectedTool: (() => LoadoutToolRef | null) | null = null;
  private radialSetSelectedTool: ((tool: LoadoutToolRef) => void) | null = null;
  private inspectorModeProvider: (() => boolean) | null = null;
  private radialGetTemporaryUtilities: (() => readonly TemporaryUtilityInstanceDescriptor[]) | null = null;
  private radialActionMenu: RadialActionMenu | null = null;
  private selectedRadialAction: RadialActionRef | null = null;
  private readonly knownTemporaryUtilityIds = new Set<string>();
  private readonly radialSelectionHistory: RadialActionRef[] = [];
  private radialCancelAwaitingRelease = false;
  private constructionPlacementActive = false;
  private dismantlePlacementActive = false;
  private globalDismantleHoldStartedAt: number | null = null;
  private activeHeldActionId: string | null = null;
  private heldActionSequence = 0;
  /** Liefert Verbrauch und persoenliches Maximum als Paar, damit beide nie auseinanderlaufen. */
  private radialGetCapacity: (() => { used: number; max: number }) | null = null;
  private radialGetCooldownUntil: ((ref: RadialActionRef) => number) | null = null;
  private radialGetCapabilities: (() => {
    canUseUtility: boolean;
    canPlace: boolean;
    canManage: boolean;
  }) | null = null;
  private radialGetManagementActions: (() => readonly RadialManagementAction[]) | null = null;
  private getDismantlePreviewProvider: (() => UtilityPlacementPreviewState | undefined) | null = null;
  private getPersistentRewardIdsProvider: (() => readonly PersistentBaseRewardId[]) | null = null;
  private getPersistentRewardPlacementPreviewProvider: ((
    rewardId: PersistentBaseRewardId,
  ) => UtilityPlacementPreviewState | undefined) | null = null;
  private placePersistentRewardProvider: ((
    rewardId: PersistentBaseRewardId,
    preview: UtilityPlacementPreviewState,
  ) => Promise<LoadoutUseResult>) | null = null;
  private persistentRewardPlacementActive = false;

  // Audio
  private audioSystem: GameAudioSystem | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;
  private chargeLoopHandle: string | null = null;

  // Scope-Mechanik (für Waffen mit scopeConfig, z.B. AWP)
  private scopeStartedAt: number | null = null;  // Timestamp des RMB-Press
  private scopeProgress = 0;                     // 0–1, aktueller Scope-Fortschritt
  private scopeChargeProgress = 0;               // 0–1, separater Schadens-Ladefortschritt
  private getWeapon2Config: (() => WeaponConfig | undefined) | null = null;
  private canStartScope: (() => boolean) | null = null;

  // Aktueller Aim-Winkel (Radiant, für Rotation-Sync)
  private currentAimAngle = 0;

  // Lokaler Zustand vom Host empfangen
  private localIsStunned  = false;
  private localIsBurrowed = false;
  private localBurrowPhase: BurrowPhase = 'idle';
  private inputEnabled    = true;
  private radialEnabled = false;
  private aimEnabled      = true;

  constructor(
    scene:          Phaser.Scene,
    bridge:         NetworkBridge,
    getLocalSprite: () => Phaser.GameObjects.Image | undefined,
  ) {
    this.scene          = scene;
    this.bridge         = bridge;
    this.getLocalSprite = getLocalSprite;
  }

  setup(): void {
    const kb = this.scene.input.keyboard!;
    this.keyW     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W, false);
    this.keyA     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A, false);
    this.keyS     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S, false);
    this.keyD     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D, false);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyShift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyE     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E, false);
    this.keyQ     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q, false);
    this.keyR     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R, false);
    this.keyB     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.B, false);
    this.keyN     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.N, false);
    // Kontextmenü deaktivieren damit Rechtsklick im Spiel registriert wird
    this.scene.input.mouse?.disableContextMenu();
    this.radialActionMenu = new RadialActionMenu(this.scene);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.radialActionMenu?.destroy();
      this.radialActionMenu = null;
    });
  }

  setupRadialActionProviders(
    getTools: () => readonly LoadoutToolRef[],
    getSelected: () => LoadoutToolRef | null,
    setSelected: (tool: LoadoutToolRef) => void,
    isInspectorMode?: () => boolean,
    getCapacity?: () => { used: number; max: number },
    getDismantlePreview?: () => UtilityPlacementPreviewState | undefined,
    getCooldownUntil?: (ref: RadialActionRef) => number,
    getCapabilities?: () => { canUseUtility: boolean; canPlace: boolean; canManage: boolean },
    getManagementActions?: () => readonly RadialManagementAction[],
  ): void {
    this.radialGetTools = getTools;
    this.radialGetSelectedTool = getSelected;
    this.radialSetSelectedTool = setSelected;
    this.inspectorModeProvider = isInspectorMode ?? null;
    this.radialGetCapacity = getCapacity ?? null;
    this.getDismantlePreviewProvider = getDismantlePreview ?? null;
    this.radialGetCooldownUntil = getCooldownUntil ?? null;
    this.radialGetCapabilities = getCapabilities ?? null;
    this.radialGetManagementActions = getManagementActions ?? null;
  }

  setupTemporaryUtilityProvider(
    getInstances: () => readonly TemporaryUtilityInstanceDescriptor[],
  ): void {
    this.radialGetTemporaryUtilities = getInstances;
  }

  setupPersistentRewardActionProvider(
    getRewardIds: () => readonly PersistentBaseRewardId[],
    getPreview: (rewardId: PersistentBaseRewardId) => UtilityPlacementPreviewState | undefined,
    place: (
      rewardId: PersistentBaseRewardId,
      preview: UtilityPlacementPreviewState,
    ) => Promise<LoadoutUseResult>,
  ): void {
    this.getPersistentRewardIdsProvider = getRewardIds;
    this.getPersistentRewardPlacementPreviewProvider = getPreview;
    this.placePersistentRewardProvider = place;
  }

  setupConstructionPlacementPreviewProvider(
    getPreview: (constructionId: ConstructionId) => UtilityPlacementPreviewState | undefined,
  ): void {
    this.getConstructionPlacementPreviewProvider = getPreview;
  }

  private getRadialTools(): readonly LoadoutToolRef[] {
    return this.radialGetTools?.() ?? [];
  }

  private getConstructionToolRefs(): readonly LoadoutToolRef[] {
    const result: LoadoutToolRef[] = [];
    const seen = new Set<ConstructionId>();
    for (const tool of this.getRadialTools()) {
      const constructionId = normalizeConstructionId(tool.id);
      if (!constructionId || seen.has(constructionId)) continue;
      seen.add(constructionId);
      result.push({ kind: 'construction', id: constructionId });
    }
    return result;
  }

  private getPersistentRewardIds(): readonly PersistentBaseRewardId[] {
    return this.getPersistentRewardIdsProvider?.() ?? [];
  }

  private getSelectedPersistentRewardId(): PersistentBaseRewardId | null {
    const selected = this.selectedRadialAction;
    if (selected?.kind !== 'persistent-reward') return null;
    if (this.getPersistentRewardIds().includes(selected.rewardId)) return selected.rewardId;
    this.selectedRadialAction = null;
    this.persistentRewardPlacementActive = false;
    return null;
  }

  private hasActiveConstructionTools(): boolean {
    return this.getConstructionToolRefs().length > 0;
  }

  private getSelectedConstructionToolRef(): LoadoutToolRef | null {
    const selected = this.selectedRadialAction;
    return selected?.kind === 'construction'
      ? { kind: 'construction', id: selected.constructionId }
      : null;
  }

  private getSelectedToolRef(): LoadoutToolRef | null {
    const selected = this.selectedRadialAction;
    if (selected?.kind === 'construction') {
      return { kind: 'construction', id: selected.constructionId };
    }
    if (selected?.kind === 'utility') return { kind: 'utility', id: selected.utilityId };
    return null;
  }

  getSelectedRadialActionForHud(): RadialActionRef | null {
    const actions = this.getRadialActionStates();
    this.ensureSelectedRadialAction(actions);
    return this.selectedRadialAction ? cloneRadialActionRef(this.selectedRadialAction) : null;
  }

  /**
   * Resolves the held-item projection from the canonical radial selection. `undefined` means
   * that no radial action is selected and the host's use/animation state may be used as a
   * fallback; `null` deliberately hides the item for actions without a hand-held visual.
   */
  getSelectedHeldItemIdForPresentation(): string | null | undefined {
    const selected = this.getSelectedRadialActionForHud();
    if (!selected) return undefined;
    switch (selected.kind) {
      case 'utility':
        return selected.utilityId;
      case 'temporary-utility':
        return selected.utilityId;
      case 'construction':
        return getUtilityIdForConstruction(selected.constructionId);
      case 'management':
      case 'persistent-reward':
        return null;
    }
  }

  /** Prediction-only view used by HUD projections; authoritative cooldown remains in the bridge. */
  getPredictedUtilityCooldownUntil(ref: RadialActionRef): number {
    return this.predictedUtilityCooldownUntil.get(radialActionKey(ref)) ?? 0;
  }

  getSelectedUtilityCooldownUntil(): number {
    return this.getSelectedRadialActionState(Date.now())?.cooldownUntil ?? 0;
  }

  private getSelectedRadialActionState(now = Date.now()): RadialActionState | null {
    const actions = this.getRadialActionStates(now);
    this.ensureSelectedRadialAction(actions);
    return actions.find((entry) => isSameRadialActionRef(entry.ref, this.selectedRadialAction)) ?? null;
  }

  private getRadialActionStates(now = Date.now()): RadialActionState[] {
    const capacity = this.radialGetCapacity?.();
    const capabilities = this.radialGetCapabilities?.() ?? {
      canUseUtility: this.inputEnabled,
      canPlace: this.inputEnabled,
      canManage: this.inputEnabled,
    };
    const actions = resolveRadialActions({
      gameMode: this.bridge.getActiveGameMode(),
      tools: this.getRadialTools(),
      temporaryUtilities: this.radialGetTemporaryUtilities?.() ?? [],
      persistentRewardIds: this.getPersistentRewardIds(),
      usedCapacity: capacity?.used ?? 0,
      capacityMax: capacity?.max ?? COOP_DEFENSE_CONSTRUCTION_CAPACITY,
      now,
      ...capabilities,
      managementActions: this.radialGetManagementActions?.() ?? [],
      getCooldownUntil: (ref) => this.radialGetCooldownUntil?.(ref) ?? 0,
    });
    this.reconcilePredictedUtilityCooldowns(actions, now);
    this.reconcileTemporaryUtilitySelection(actions);
    return this.applyPredictedUtilityCooldowns(actions, now);
  }

  private reconcilePredictedUtilityCooldowns(
    actions: readonly RadialActionState[],
    now: number,
  ): void {
    const authoritativeReadyAt = new Map(
      actions.map((entry) => [radialActionKey(entry.ref), entry.cooldownUntil]),
    );
    for (const [key, readyAt] of this.predictedUtilityCooldownUntil) {
      const current = authoritativeReadyAt.get(key);
      if (current === undefined || readyAt <= now || current >= readyAt) {
        this.predictedUtilityCooldownUntil.delete(key);
      }
    }
  }

  private applyPredictedUtilityCooldowns(
    actions: readonly RadialActionState[],
    now: number,
  ): RadialActionState[] {
    return actions.map((entry) => {
      const predicted = this.predictedUtilityCooldownUntil.get(radialActionKey(entry.ref)) ?? 0;
      if (predicted <= now || predicted <= entry.cooldownUntil
        || (!entry.available && entry.disabledReason !== 'cooldown')) return entry;
      return {
        ...entry,
        available: false,
        disabledReason: 'cooldown',
        cooldownUntil: predicted,
      };
    });
  }

  private ensureSelectedRadialAction(actions: readonly RadialActionState[]): void {
    if (this.selectedRadialAction && actions.some((entry) => (
      isSameRadialActionRef(entry.ref, this.selectedRadialAction)
    ))) return;
    const lostTemporarySelection = this.selectedRadialAction?.kind === 'temporary-utility';
    while (this.radialSelectionHistory.length > 0) {
      const candidate = this.radialSelectionHistory.pop() ?? null;
      if (candidate && actions.some((entry) => isSameRadialActionRef(entry.ref, candidate))) {
        this.selectedRadialAction = cloneRadialActionRef(candidate);
        return;
      }
    }
    const persistedTool = this.isInspectorMode() ? this.radialGetSelectedTool?.() ?? null : null;
    const persistedRef = persistedTool ? radialActionRefFromTool(persistedTool) : null;
    const fallback = !lostTemporarySelection && persistedRef
      ? actions.find((entry) => isSameRadialActionRef(entry.ref, persistedRef))
      : undefined;
    const ordinaryUtility = actions.find((entry) => entry.ref.kind === 'utility');
    this.selectedRadialAction = fallback?.ref
      ? cloneRadialActionRef(fallback.ref)
      : ordinaryUtility?.ref
        ? cloneRadialActionRef(ordinaryUtility.ref)
        : actions[0]?.ref
          ? cloneRadialActionRef(actions[0].ref)
        : null;
    if (!this.selectedRadialAction || this.selectedRadialAction.kind !== 'persistent-reward') {
      this.persistentRewardPlacementActive = false;
    }
  }

  private applyRadialSelection(selection: RadialActionRef): void {
    this.selectedRadialAction = cloneRadialActionRef(selection);
    this.radialSelectionHistory.length = 0;
    if (!this.isInspectorMode()) return;
    if (selection.kind === 'construction') {
      this.radialSetSelectedTool?.({ kind: 'construction', id: selection.constructionId });
    } else if (selection.kind === 'utility') {
      this.radialSetSelectedTool?.({ kind: 'utility', id: selection.utilityId });
    }
  }

  private reconcileTemporaryUtilitySelection(actions: readonly RadialActionState[]): void {
    const temporary = actions
      .filter((entry): entry is RadialActionState & {
        readonly ref: Extract<RadialActionRef, { kind: 'temporary-utility' }>;
      } => entry.ref.kind === 'temporary-utility')
      .sort((left, right) => {
        const leftInstance = this.radialGetTemporaryUtilities?.().find((entry) => entry.instanceId === left.ref.instanceId);
        const rightInstance = this.radialGetTemporaryUtilities?.().find((entry) => entry.instanceId === right.ref.instanceId);
        return (leftInstance?.acquisitionOrder ?? 0) - (rightInstance?.acquisitionOrder ?? 0);
      });
    for (const entry of temporary) {
      if (this.knownTemporaryUtilityIds.has(entry.ref.instanceId)) continue;
      if (this.selectedRadialAction) {
        this.radialSelectionHistory.push(cloneRadialActionRef(this.selectedRadialAction));
      }
      this.selectedRadialAction = cloneRadialActionRef(entry.ref);
    }
    this.knownTemporaryUtilityIds.clear();
    for (const entry of temporary) this.knownTemporaryUtilityIds.add(entry.ref.instanceId);
  }

  /**
   * Verarbeitet das gemeinsame Action-Rad vor dem Gameplay-Input-Gate. Damit bleibt es im
   * Countdown bedienbar, ohne dass dadurch Bewegung, Waffen oder Bauaktionen frei werden.
   */
  private updateRadialActionMenu(): boolean {
    if (!this.radialEnabled) {
      this.radialActionMenu?.close();
      this.radialCancelAwaitingRelease = false;
      return false;
    }

    const pointer = this.scene.input.activePointer;
    if (this.radialCancelAwaitingRelease) {
      if (this.keyR.isDown) return true;
      this.radialCancelAwaitingRelease = false;
      return false;
    }

    const interactionActive = this.utilityPlacementActive
      || this.utilityTargetingActive
      || this.utilityHoldActive
      || this.globalDismantleHoldStartedAt !== null
      || this.constructionPlacementActive
      || this.dismantlePlacementActive
      || this.persistentRewardPlacementActive;
    if (Phaser.Input.Keyboard.JustDown(this.keyR) && !this.radialActionMenu?.isOpen) {
      if (interactionActive) {
        this.cancelUtilityInteraction();
        this.radialCancelAwaitingRelease = true;
        return true;
      }
      const actions = this.getRadialActionStates();
      this.ensureSelectedRadialAction(actions);
      this.radialActionMenu?.open(pointer.x, pointer.y, actions, this.selectedRadialAction);
    }

    if (!this.radialActionMenu?.isOpen) return false;
    if (this.keyR.isDown) {
      this.radialActionMenu.update(pointer.x, pointer.y);
    } else {
      const candidate = this.radialActionMenu.close(pointer.x, pointer.y);
      if (candidate) {
        // The menu owns only an open-time snapshot. Re-resolve against the current collection
        // before changing the canonical selection so a removed temporary instance cannot be
        // selected for one frame after the host update.
        const currentActions = this.getRadialActionStates();
        const current = currentActions.find((entry) => isSameRadialActionRef(entry.ref, candidate));
        if (current) this.applyRadialSelection(current.ref);
        else this.ensureSelectedRadialAction(currentActions);
      }
    }
    return true;
  }

  private getSelectedUtilityParams(): LoadoutUseParams | undefined {
    if (this.selectedRadialAction?.kind === 'temporary-utility') {
      return { temporaryUtilityInstanceId: this.selectedRadialAction.instanceId };
    }
    const tool = this.getSelectedToolRef();
    const activeConfig = this.getLocalUtilityConfig?.();
    const resolvedToolConfig = tool?.kind === 'utility'
      ? getUtilityConfigForMode(
        tool.id,
        this.bridge.getActiveGameMode(),
      )
      : undefined;
    const activeConstructionId = getConstructionIdForUtility(activeConfig?.id);
    if (tool?.kind === 'construction' && activeConstructionId === tool.id) {
      return { toolRef: tool };
    }
    return this.isInspectorMode() && tool?.kind === 'utility'
      // Coop commits the concrete `*_COOP` variant while the Inspector keeps
      // the user-facing base ID. Treat both IDs as the same tool, but keep
      && (!activeConfig || activeConfig.id === resolvedToolConfig?.id)
      ? { toolRef: tool }
      : undefined;
  }

  private isInspectorMode(): boolean {
    return this.inspectorModeProvider?.() ?? false;
  }

  isConstructionPlacementActive(): boolean {
    return this.hasActiveConstructionTools()
      && this.constructionPlacementActive;
  }

  isDismantlePlacementActive(): boolean {
    return this.dismantlePlacementActive;
  }

  isPersistentRewardPlacementActive(): boolean {
    return this.getSelectedPersistentRewardId() !== null
      && this.persistentRewardPlacementActive;
  }

  getConstructionPlacementPreviewState(): UtilityPlacementPreviewState | undefined {
    const rewardId = this.getSelectedPersistentRewardId();
    if (this.isPersistentRewardPlacementActive() && rewardId) {
      return this.getPersistentRewardPlacementPreviewProvider?.(rewardId);
    }
    if (this.isDismantlePlacementActive()) return this.getDismantlePreviewProvider?.();
    if (!this.isConstructionPlacementActive()) return undefined;
    const constructionTool = this.getSelectedConstructionToolRef();
    if (constructionTool?.kind === 'construction') {
      return this.getConstructionPlacementPreviewProvider?.(constructionTool.id);
    }
    return undefined;
  }

  /**
   * Register callback for debug hotkeys (e.g., B/N for flow field debug overlays).
   */
  setupDebugHotkeys(cb: (type: DebugHotkeyType) => void): void {
    this.onDebugHotkey = cb;
    console.log('[InputSystem] Debug hotkeys registered');
  }

  /**
   * Loadout-Callback registrieren.
   * Wird aufgerufen wenn der Spieler eine Aktion ausführt (Waffe, Utility, Ultimate).
   */
  setupLoadoutListener(
    cb: (slot: LoadoutSlot, angle: number, targetX: number, targetY: number, params?: LoadoutUseParams) => void,
  ): void {
    this.onLoadoutUse = cb;
  }

  setupUtilityConfigProvider(cb: () => UtilityConfig | undefined): void {
    this.getLocalUtilityConfig = cb;
  }

  setupUtilityCooldownProvider(cb: () => number): void {
    this.getLocalUtilityCooldownUntil = cb;
  }

  setupUltimateConfigProvider(cb: () => UltimateConfig | undefined): void {
    this.getLocalUltimateConfig = cb;
  }

  setupLocalRageProvider(cb: () => number): void {
    this.getLocalRage = cb;
  }

  setupWeapon2ConfigProvider(cb: () => WeaponConfig | undefined): void {
    this.getWeapon2Config = cb;
  }

  /** Callback: gibt true zurück wenn Cooldown und Adrenalin für weapon2 ausreichen. */
  setupCanStartScopeCheck(cb: () => boolean): void {
    this.canStartScope = cb;
  }

  /** Aktueller Scope-Fortschritt (0–1) für ScopeOverlay und AimSystem. */
  getScopeProgress(): number {
    return this.scopeProgress;
  }

  getScopeChargeProgress(): number {
    return this.scopeChargeProgress;
  }

  /**
   * True solange die rechte Maustaste eine Scope-Waffe anvisiert – schon im
   * allerersten Frame, in dem scopeProgress noch 0 ist.
   */
  isScoping(): boolean {
    return this.scopeStartedAt !== null;
  }

  /** Gibt die ScopeModeConfig der aktuellen weapon2 zurück, oder undefined. */
  getWeapon2ScopeConfig(): ScopeModeConfig | undefined {
    return this.getWeapon2Config?.()?.scopeConfig;
  }

  /**
   * Callback: gibt true zurück wenn der Translocator-Puck aktiv ist und E
   * sofort (ohne Aufladen) den Teleport auslösen soll.
   */
  private isTranslocatorRecallReady: (() => boolean) | null = null;

  setupTranslocatorRecallCheck(cb: () => boolean): void {
    this.isTranslocatorRecallReady = cb;
  }

  /**
   * Wird von ArenaScene jeden Frame mit dem aktuellen Spieler-Netzwerkstatus gesetzt,
   * damit Stun und Burrow-Zustand für Input-Gating berücksichtigt werden.
   */
  setLocalState(isStunned: boolean, isBurrowed: boolean, burrowPhase: BurrowPhase): void {
    this.localIsStunned  = isStunned;
    this.localIsBurrowed = isBurrowed;
    this.localBurrowPhase = burrowPhase;
    if (isStunned || burrowPhase === 'windup' || burrowPhase === 'underground' || burrowPhase === 'trapped') {
      this.cancelUtilityInteraction();
      this.cancelUltimateCharge();
      this.cancelUltimatePlacement();
      this.ultimateTargetingActive = false;
    }
  }

  /**
   * Blickrichtung getrennt vom übrigen Input schalten. Das Drehen ist ein echtes
   * Obermenge-Recht: Es darf aktiv bleiben, während {@link setInputEnabled} sperrt
   * (Arena-Countdown), aber niemals umgekehrt. Bei gesperrtem Aim friert der zuletzt
   * gesendete Winkel ein, damit der Spieler etwa im Optionsmenü nicht der Maus folgt.
   */
  setAimEnabled(enabled: boolean): void {
    this.aimEnabled = enabled;
  }

  /**
   * Schaltet Gameplay-Input; das Action-Rad kann im Arena-Countdown als einzige
   * Aktion trotzdem aktiv bleiben, damit die Auswahl vor Rundenbeginn vorbereitet wird.
   */
  setInputEnabled(enabled: boolean, allowRadial = enabled): void {
    const wasEnabled = this.inputEnabled;
    this.inputEnabled = enabled;
    this.radialEnabled = allowRadial;
    if (enabled && !wasEnabled) {
      // Der Gesture, der die UI verlassen und Gameplay aktiviert hat, gehoert weiterhin der UI.
      // Das gilt fuer alle aktuell gehaltenen Pointerbuttons, nicht nur fuer Waffe 1.
      this.consumedPointerButtons = this.scene.input.activePointer?.buttons ?? 0;
    }
    if (!enabled) {
      this.predictedUtilityCooldownUntil.clear();
      this.cancelUtilityInteraction();
      this.cancelUltimateCharge();
      this.cancelUltimatePlacement();
      this.ultimateTargetingActive = false;
      this.scopeStartedAt = null;
      this.scopeProgress = 0;
      this.scopeChargeProgress = 0;
      this.tunnelPlacementAnchor = null;
      this.placementPreviewState = null;
      this.constructionPlacementActive = false;
      this.dismantlePlacementActive = false;
      this.persistentRewardPlacementActive = false;
      if (!allowRadial) this.radialActionMenu?.close();
      this.suppressWeapon1UntilLeftRelease = false;
      this.prevLeftPointerDown = false;
      this.prevRightPointerDown = false;
      this.pendingRightInputStarted = false;
    }
  }

  /**
   * Dash-Cooldown als Fraktion 0 (bereit) – 1 (gerade benutzt) für das HUD.
   */
  getDashCooldownFrac(): number {
    const remaining = this.dashCooldownUntil - Date.now();
    if (remaining <= 0) return 0;
    return Math.min(1, remaining / DASH_CYCLE_MS);
  }

  /** Aktueller Aim-Winkel in Radiant (für Sprite-Rotation). */
  getAimAngle(): number { return this.currentAimAngle; }

  isUtilityPreviewActive(): boolean {
    return this.utilityHoldActive || this.globalDismantleHoldStartedAt !== null;
  }

  isUtilityHudDisplayActive(): boolean {
    if (!this.inputEnabled) return false;
    return !!this.keyE?.isDown
      || this.utilityHoldActive
      || this.utilityTargetingActive
      || this.utilityPlacementActive
      || this.globalDismantleHoldStartedAt !== null
      || this.constructionPlacementActive
      || this.dismantlePlacementActive
      || this.persistentRewardPlacementActive;
  }

  isUtilityChargePreviewActive(): boolean {
    return this.utilityHoldActive || this.globalDismantleHoldStartedAt !== null;
  }

  isUtilityTargetingActive(): boolean {
    return this.utilityTargetingActive;
  }

  isUtilityPlacementActive(): boolean {
    return this.utilityPlacementActive;
  }

  isUltimateTargetingActive(): boolean {
    return this.ultimateTargetingActive;
  }

  isUltimatePlacementActive(): boolean {
    return this.ultimatePlacementActive;
  }

  cancelLocalUltimateChargePreview(): void {
    this.cancelUltimateCharge();
    this.cancelUltimatePlacement();
    this.ultimateTargetingActive = false;
  }

  getUtilityPlacementPreviewState(): UtilityPlacementPreviewState | undefined {
    if (!this.utilityPlacementActive) return undefined;
    return this.getUtilityPlacementPreviewProvider?.();
  }

  setupUtilityPlacementPreviewProvider(cb: () => UtilityPlacementPreviewState | undefined): void {
    this.getUtilityPlacementPreviewProvider = cb;
  }

  getUltimatePlacementPreviewState(): UtilityPlacementPreviewState | undefined {
    if (!this.ultimatePlacementActive) return undefined;
    return this.getUltimatePlacementPreviewProvider?.();
  }

  getUltimatePlacementAnchor(): { x: number; y: number; gridX: number; gridY: number } | null {
    return this.tunnelPlacementAnchor;
  }

  setupUltimatePlacementPreviewProvider(cb: () => UtilityPlacementPreviewState | undefined): void {
    this.getUltimatePlacementPreviewProvider = cb;
  }

  getUltimateChargePreviewState(): UltimateChargePreviewState | undefined {
    if (!this.ultimateHoldActive) return undefined;
    const sprite = this.getLocalSprite();
    const cfg = this.getGaussUltimateConfig();
    if (!sprite || !cfg) return undefined;

    const pointer = this.scene.input.activePointer;
    const pointerWorld = this.getPointerWorldPoint(pointer);
    const clampedTarget = clampPointToArena(pointerWorld.x, pointerWorld.y);
    const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, clampedTarget.x, clampedTarget.y);
    const chargeFraction = this.ultimateChargeStartedAt === null
      ? 0
      : this.computeGaussChargeFraction(this.ultimateChargeStartedAt, cfg, Date.now());

    return {
      angle,
      chargeFraction,
      cooldownFrac: 0,
      isBlocked: (this.getLocalRage?.() ?? 0) < cfg.rageRequired,
      minThrowSpeed: 0,
      maxThrowSpeed: cfg.projectileSpeed,
      colorOverride: cfg.chargeColor,
      range: cfg.range,
      reticleStyle: 'gauss',
    };
  }

  getUtilityChargePreviewState(): UtilityChargePreviewState | undefined {
    if (this.globalDismantleHoldStartedAt !== null) {
      const sprite = this.getLocalSprite();
      if (!sprite) return undefined;
      const pointer = this.scene.input.activePointer;
      const pointerWorld = this.getPointerWorldPoint(pointer);
      const clampedTarget = clampPointToArena(pointerWorld.x, pointerWorld.y);
      return {
        angle: Phaser.Math.Angle.Between(sprite.x, sprite.y, clampedTarget.x, clampedTarget.y),
        chargeFraction: Math.min(1, Math.max(0, (Date.now() - this.globalDismantleHoldStartedAt) / 1_000)),
        cooldownFrac: 0,
        isBlocked: false,
        minThrowSpeed: 0,
        maxThrowSpeed: 0,
        isGateCharge: true,
        colorOverride: COLORS.GOLD_2,
      };
    }
    if (!this.utilityHoldActive) return undefined;
    const sprite = this.getLocalSprite();
    const cfg = this.utilityChargeConfig ?? this.getChargeableUtilityConfig();
    if (!sprite || !cfg) return undefined;

    const now = Date.now();
    const startedAt = this.utilityChargeStartedAt;
    const isGate = cfg.activation.type === 'charged_gate';

    const pointer = this.scene.input.activePointer;
    const pointerWorld = this.getPointerWorldPoint(pointer);
    const clampedTarget = clampPointToArena(pointerWorld.x, pointerWorld.y);
    const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, clampedTarget.x, clampedTarget.y);
    return {
      angle,
      chargeFraction: startedAt === null
        ? 0
        : this.computeUtilityChargeFraction(startedAt, cfg.activation, now),
      cooldownFrac: this.isUtilityBlocked(now) ? 1 : 0,
      isBlocked: this.isUtilityBlocked(now),
      minThrowSpeed: isGate ? 0 : (cfg.activation as ChargedThrowUtilityActivationConfig).minThrowSpeed,
      maxThrowSpeed: isGate ? 0 : cfg.projectileSpeed,
      isGateCharge: isGate,
    };
  }

  getUtilityTargetingPreviewState(): UtilityTargetingPreviewState | undefined {
    if (!this.utilityTargetingActive) return undefined;
    const sprite = this.getLocalSprite();
    const cfg = this.getTargetedUtilityConfig();
    if (!sprite || !cfg) return undefined;

    const pointer = this.scene.input.activePointer;
    const pointerWorld = this.getPointerWorldPoint(pointer);
    const target = clampPointToArena(pointerWorld.x, pointerWorld.y);
    return {
      angle: Phaser.Math.Angle.Between(sprite.x, sprite.y, target.x, target.y),
      targetX: target.x,
      targetY: target.y,
    };
  }

  /** Gibt den Zielmodus-Vorschau-Zustand für das Airstrike-Ultimate zurück. */
  getAirstrikeTargetingPreviewState(): UtilityTargetingPreviewState | undefined {
    if (!this.ultimateTargetingActive) return undefined;
    const sprite = this.getLocalSprite();
    if (!sprite) return undefined;
    const cfg = this.getAirstrikeUltimateConfig();
    if (!cfg) return undefined;

    const pointer = this.scene.input.activePointer;
    const pointerWorld = this.getPointerWorldPoint(pointer);
    const target = clampPointToArena(pointerWorld.x, pointerWorld.y);
    return {
      angle: Phaser.Math.Angle.Between(sprite.x, sprite.y, target.x, target.y),
      targetX: target.x,
      targetY: target.y,
    };
  }

  /**
   * Handle debug hotkeys (B/N for flow field debug).
   * This is called from update() each frame.
   */
  private updateDebugHotkeys(): void {
    if (!this.onDebugHotkey) return;

    // B key: show base flow field vectors
    if (this.keyB.isDown) {
      console.log('[InputSystem] B key pressed - triggering flowfield_bases');
      this.onDebugHotkey('flowfield_bases');
      this.keyB.isDown = false; // Reset to avoid repeated triggers
    }

    // N key: show player flow field vectors
    if (this.keyN.isDown) {
      console.log('[InputSystem] N key pressed - triggering flowfield_players');
      this.onDebugHotkey('flowfield_players');
      this.keyN.isDown = false; // Reset to avoid repeated triggers
    }
  }

  /** Jeden Frame: WASD + Dash + Burrow + Loadout lesen, RPCs senden. */
  update(): void {
    try {
    // Die Scene schaltet den lokalen Input zusaetzlich ab; dieser Rollencheck verhindert, dass
    // bereits gedrueckte Tasten oder Debug-/Placement-Hotkeys beim Spectator noch Aktionen
    // erzeugen, bevor der naechste Snapshot die Entity entfernt.
    if (this.bridge.getWorldDescriptor() && !maySendWorldInput(this.bridge.getLocalWorldParticipation())) {
      this.placementPreviewState = null;
      this.bridge.sendLocalInput({
        dx: 0,
        dy: 0,
        aim: quantizeAngle(this.currentAimAngle),
        dashHeld: false,
      });
      return;
    }

    // Process debug hotkeys first (regardless of input enabled state)
    this.updateDebugHotkeys();

    // ── 1. Blickrichtung (auch bei gesperrter Eingabe) ─────────────────────
    // Drehen bleibt während des Arena-Countdowns erlaubt und wird über den
    // Input-Kanal repliziert; Bewegung und Aktionen bleiben gesperrt.
    const aimTarget = this.updateAimFromPointer();
    const constructionPreview = (this.isPersistentRewardPlacementActive()
      || this.isConstructionPlacementActive()
      || this.isDismantlePlacementActive())
      ? this.getConstructionPlacementPreviewState()
      : undefined;
    if (constructionPreview) this.syncPlacementPreviewState(constructionPreview);

    // ── 2. Bewegungs-Input (immer gesendet) ────────────────────────────────
    let dx = 0, dy = 0;
    if (this.inputEnabled) {
      if (this.keyA.isDown) dx -= 1;
      if (this.keyD.isDown) dx += 1;
      if (this.keyW.isDown) dy -= 1;
      if (this.keyS.isDown) dy += 1;
    }

    const input: PlayerInput = {
      dx,
      dy,
      aim: quantizeAngle(this.currentAimAngle),
      dashHeld: this.inputEnabled && this.keySpace.isDown,
    };
    this.bridge.sendLocalInput(input);

    const radialHandled = this.updateRadialActionMenu();
    if (!this.inputEnabled || radialHandled) return;

    // ── 3. Stun: keine weiteren Aktionen ───────────────────────────────────
    if (this.localIsStunned) {
      this.cancelUtilityInteraction();
      this.cancelUltimateCharge();
      this.ultimateTargetingActive = false;
      return;
    }

    // ── 4. Dash (Flanke, einmalig auslösen) ────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      const now = Date.now();
      if (now >= this.dashCooldownUntil) {
        this.bridge.sendDash(dx, dy);
        this.dashCooldownUntil = now + DASH_CYCLE_MS;
      }
    }

    // ── 5. Burrow-Toggle (Flanke) ───────────────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.keyShift)) {
      if (this.localBurrowPhase === 'idle') {
        this.bridge.sendBurrowRequest(true);
      } else if (this.localBurrowPhase === 'underground' || this.localBurrowPhase === 'trapped') {
        this.bridge.sendBurrowRequest(false);
      }
    }

    // ── 6. Loadout-Aktionen ────────────────────────────────────────────────
    if (!this.onLoadoutUse) return;

    const pointer = this.scene.input.activePointer;
    const now     = Date.now();

    // Ohne aimTarget gibt es keinen lokalen Sprite – dann auch keine Loadout-Aktionen.
    if (!aimTarget) {
      this.cancelUtilityInteraction();
      this.placementPreviewState = null;
      return;
    }

    const physicalLeftPointerDown = pointer.leftButtonDown();
    const physicalRightPointerDown = pointer.rightButtonDown();
    const heldPointerButtons = typeof pointer.buttons === 'number'
      ? pointer.buttons
      : (physicalLeftPointerDown ? PRIMARY_POINTER_BUTTON : 0)
        | (physicalRightPointerDown ? SECONDARY_POINTER_BUTTON : 0);
    const handoff = resolvePointerButtonHandoff(heldPointerButtons, this.consumedPointerButtons);
    this.consumedPointerButtons = handoff.consumedButtons;
    const leftPointerDown = physicalLeftPointerDown
      && (handoff.gameplayButtons & PRIMARY_POINTER_BUTTON) !== 0;
    const rightPointerDown = physicalRightPointerDown
      && (handoff.gameplayButtons & SECONDARY_POINTER_BUTTON) !== 0;
    const leftInputStarted = leftPointerDown && !this.prevLeftPointerDown;
    const rightInputStarted = rightPointerDown && !this.prevRightPointerDown;
    this.prevLeftPointerDown = leftPointerDown;
    this.prevRightPointerDown = rightPointerDown;
    if (rightInputStarted && leftPointerDown) this.pendingRightInputStarted = true;
    if (!rightPointerDown) this.pendingRightInputStarted = false;
    const rightInputStartedForUse = rightInputStarted || this.pendingRightInputStarted;
    if (!leftPointerDown) {
      this.suppressWeapon1UntilLeftRelease = false;
    }
    // LMB is the deliberate switch to weapon 1. A scope started by an earlier RMB press must
    // not survive until a later RMB release and fire after weapon 1 has already been used.
    if (leftInputStarted && this.scopeStartedAt !== null) {
      this.cancelScopeAim();
    }
    // Zielpunkt und Winkel stammen aus Schritt 1 und sind bereits auf die Arena geclampt.
    const clampedTarget = aimTarget;
    const angle = this.currentAimAngle;
    const ultimateCharging = this.ultimateHoldActive;
    const weaponsBlocked = this.localBurrowPhase !== 'idle' || ultimateCharging || this.utilityPlacementActive || this.ultimatePlacementActive;
    const primaryWeaponSuppressed = this.suppressWeapon1UntilLeftRelease && leftPointerDown;
    const utilityBlocked = this.localBurrowPhase === 'windup'
      || this.localBurrowPhase === 'underground'
      || this.localBurrowPhase === 'trapped'
      || ultimateCharging
      || this.ultimatePlacementActive;
    const ultimateCfg = this.getLocalUltimateConfig?.();

    // RMB cancels every E-action interaction before weapon 2 sees the gesture. The button stays
    // consumed until release, so the same physical click cannot both cancel and fire.
    const radialInteractionActive = this.utilityPlacementActive
      || this.utilityTargetingActive
      || this.utilityHoldActive
      || this.globalDismantleHoldStartedAt !== null
      || this.constructionPlacementActive
      || this.dismantlePlacementActive
      || this.persistentRewardPlacementActive;
    if (rightInputStarted && radialInteractionActive) {
      this.consumeRightClickForModeCancellation();
      this.cancelUtilityInteraction();
      this.prevRightPointerDown = false;
      this.suppressWeapon1UntilLeftRelease = false;
      return;
    }

    if (this.dismantlePlacementActive) {
      const preview = constructionPreview;
      this.syncPlacementPreviewState(preview);
      if (!preview) {
        this.cancelRadialPlacement();
        return;
      }
      if (leftInputStarted || Phaser.Input.Keyboard.JustDown(this.keyE)) {
        if (leftInputStarted) this.consumeLeftClickForModeConfirmation();
        if (preview.isValid) {
          this.onLoadoutUse('utility', preview.angle, preview.targetX, preview.targetY, {
            inputStarted: true,
            dismantle: true,
          });
        }
        this.cancelRadialPlacement();
        return;
      }
      return;
    }

    if (this.isPersistentRewardPlacementActive()) {
      const preview = constructionPreview;
      this.syncPlacementPreviewState(preview);
      if (!preview) {
        this.cancelRadialPlacement();
        return;
      }
      if (leftInputStarted || Phaser.Input.Keyboard.JustDown(this.keyE)) {
        if (leftInputStarted) this.consumeLeftClickForModeConfirmation();
        const rewardId = this.getSelectedPersistentRewardId();
        if (rewardId && preview.isValid && this.placePersistentRewardProvider) {
          void this.placePersistentRewardProvider(rewardId, preview).then((result) => {
            if (result.ok
              && this.selectedRadialAction?.kind === 'persistent-reward'
              && this.selectedRadialAction.rewardId === rewardId) {
              this.selectedRadialAction = null;
            }
          }).catch(() => undefined);
        }
        this.cancelRadialPlacement();
        return;
      }
      return;
    }

    if (this.hasActiveConstructionTools() && this.constructionPlacementActive) {
      const preview = constructionPreview;
      this.syncPlacementPreviewState(preview);
      if (!preview) {
        this.cancelRadialPlacement();
        return;
      }
      if (leftInputStarted || Phaser.Input.Keyboard.JustDown(this.keyE)) {
        if (leftInputStarted) this.consumeLeftClickForModeConfirmation();
        if (preview.isValid) {
          const tool = this.getSelectedConstructionToolRef();
          if (tool?.kind === 'construction') {
            this.onLoadoutUse('utility', preview.angle, preview.targetX, preview.targetY, {
              inputStarted: true,
              constructionId: tool.id,
              toolRef: tool,
            });
          }
        }
        this.cancelRadialPlacement();
        return;
      }
      return;
    }

    if (this.utilityTargetingActive) {
      const targetedCfg = this.getTargetedUtilityConfig();
      if (!targetedCfg) {
        this.cancelUtilityTargeting();
      } else {
        const target = clampedTarget;
        const targetAngle = angle;

        if (rightPointerDown || Phaser.Input.Keyboard.JustDown(this.keyE)) {
          this.cancelUtilityTargeting();
          return;
        }

        if (leftInputStarted) {
          this.consumeLeftClickForModeConfirmation();
          this.predictSelectedUtilityCooldown(now + targetedCfg.cooldown);
          this.onLoadoutUse('utility', targetAngle, target.x, target.y, this.getSelectedUtilityParams());
          this.cancelUtilityTargeting();
          return;
        }

        return;
      }
    }

    // ── Airstrike-Ultimate Zielmodus ───────────────────────────────────────
    if (this.ultimateTargetingActive) {
      const asCfg = this.getAirstrikeUltimateConfig();
      if (!asCfg) {
        this.ultimateTargetingActive = false;
      } else {
        const target = clampedTarget;
        const targetAngle = angle;

        // Rage prüfen: bei zu wenig Rage automatisch verlassen
        const rage = this.getLocalRage?.() ?? 0;
        if (rage < asCfg.rageCost) {
          this.ultimateTargetingActive = false;
          return;
        }

        if (rightPointerDown || Phaser.Input.Keyboard.JustDown(this.keyQ)) {
          this.ultimateTargetingActive = false;
          return;
        }

        if (leftInputStarted) {
          this.consumeLeftClickForModeConfirmation();
          this.onLoadoutUse?.('ultimate', targetAngle, target.x, target.y, { inputStarted: true });
          // Nach dem Schuss im Zielmodus bleiben: Rage-Check erfolgt nächsten Frame
          return;
        }

        return;
      }
    }

    if (this.utilityPlacementActive) {
      const preview = this.getUtilityPlacementPreviewState();
      this.syncPlacementPreviewState(preview);

      if (!preview) {
        this.cancelUtilityPlacement();
        return;
      }

      if (rightPointerDown) {
        this.cancelUtilityPlacement();
        return;
      }

      if (Phaser.Input.Keyboard.JustDown(this.keyE) || leftInputStarted) {
        if (leftInputStarted) {
          this.consumeLeftClickForModeConfirmation();
        }
        if (preview.isValid) {
          this.onLoadoutUse('utility', preview.angle, preview.targetX, preview.targetY, this.getSelectedUtilityParams());
        }
        this.cancelUtilityPlacement();
        return;
      }

      return;
    }

    if (this.ultimatePlacementActive) {
      const preview = this.getUltimatePlacementPreviewState();
      this.syncPlacementPreviewState(preview);

      if (!preview) {
        this.cancelUltimatePlacement();
        return;
      }

      if (rightPointerDown || Phaser.Input.Keyboard.JustDown(this.keyQ)) {
        this.cancelUltimatePlacement();
        return;
      }

      if (Phaser.Input.Keyboard.JustDown(this.keyE) || leftInputStarted) {
        if (leftInputStarted) {
          this.consumeLeftClickForModeConfirmation();
        }
        if (preview.isValid) {
          if (!this.tunnelPlacementAnchor) {
            this.tunnelPlacementAnchor = {
              x: preview.targetX,
              y: preview.targetY,
              gridX: preview.gridX,
              gridY: preview.gridY,
            };
            this.syncPlacementPreviewState(this.getUltimatePlacementPreviewState());
            return;
          }

          this.onLoadoutUse?.('ultimate', preview.angle, preview.targetX, preview.targetY, {
            inputStarted: true,
            tunnelAction: 'commit',
            tunnelStartX: this.tunnelPlacementAnchor.x,
            tunnelStartY: this.tunnelPlacementAnchor.y,
            tunnelStartGridX: this.tunnelPlacementAnchor.gridX,
            tunnelStartGridY: this.tunnelPlacementAnchor.gridY,
          });
        }
        this.cancelUltimatePlacement();
        return;
      }

      return;
    }

    // LMB gedrückt halten → weapon1 (Dauerfeuer, kein Client-Throttle)
    // Korrekte Host-Authority: RPCs jeden Frame senden, Host entscheidet über Cooldown.
    // Client-seitiger Cooldown würde bei variabler RPC-Latenz zu Schuss-Lücken führen.
    if (!weaponsBlocked && !primaryWeaponSuppressed && leftPointerDown) {
      this.onLoadoutUse('weapon1', angle, clampedTarget.x, clampedTarget.y, { inputStarted: leftInputStarted });
    } else if (!weaponsBlocked) {
      if (rightInputStartedForUse) this.pendingRightInputStarted = false;
      // RMB → weapon2: Scope-Waffen (z.B. AWP) nutzen fire-on-release Mechanik,
      // andere Waffen feuern weiterhin per Dauerfeuer.
      // Auch beim Inspector gehoert RMB der Waffe 2 (Adrenalinfaehigkeit); ein laufender
      // Bau- oder Rueckbaumodus faengt den Rechtsklick bereits weiter oben ab.
      const scopeCfg = this.getWeapon2Config?.()?.scopeConfig;
      if (scopeCfg) {
        if (rightPointerDown) {
          // Scope-In: Fortschritt berechnen, nur holdSpeedFactor aktiv halten (kein Schuss)
          if (rightInputStartedForUse) {
            // Neuen Scope nur starten wenn Cooldown und Adrenalin es erlauben
            if (this.canStartScope && !this.canStartScope()) return;
            this.scopeStartedAt = now;
          }
          const elapsed = this.scopeStartedAt !== null ? now - this.scopeStartedAt : 0;
          this.scopeProgress = Math.min(1, elapsed / scopeCfg.scopeInMs);
          const chargeDurationMs = this.getWeapon2Config?.()?.awpCharge?.durationMs ?? scopeCfg.scopeInMs;
          this.scopeChargeProgress = Math.min(1, elapsed / Math.max(1, chargeDurationMs));
          this.onLoadoutUse('weapon2', angle, clampedTarget.x, clampedTarget.y, { scopeHolding: true });
        } else if (this.scopeStartedAt !== null) {
          // RMB losgelassen → Schuss auslösen mit berechnetem Scope-Fortschritt
          const elapsed = now - this.scopeStartedAt;
          const progress = Math.min(1, elapsed / scopeCfg.scopeInMs);
          const chargeDurationMs = this.getWeapon2Config?.()?.awpCharge?.durationMs ?? scopeCfg.scopeInMs;
          const chargeProgress = Math.min(1, elapsed / Math.max(1, chargeDurationMs));
          this.onLoadoutUse('weapon2', angle, clampedTarget.x, clampedTarget.y, {
            scopeProgress: progress,
            scopeChargeProgress: chargeProgress,
          });
          this.scopeStartedAt = null;
          this.scopeProgress = 0;
          this.scopeChargeProgress = 0;
        }
      } else if (rightPointerDown) {
        // Normales Dauerfeuer für Nicht-Scope-Waffen
        this.onLoadoutUse('weapon2', angle, clampedTarget.x, clampedTarget.y, { inputStarted: rightInputStartedForUse });
      }
    }

    // Scope abbrechen wenn Waffen geblockt (z.B. Burrow, Ultimate)
    if (weaponsBlocked && this.scopeStartedAt !== null) {
      this.scopeStartedAt = null;
      this.scopeProgress = 0;
      this.scopeChargeProgress = 0;
    }

    if (this.globalDismantleHoldStartedAt !== null) {
      if (this.keyE.isDown) return;
      const startedAt = this.globalDismantleHoldStartedAt;
      const actionId = this.activeHeldActionId;
      this.globalDismantleHoldStartedAt = null;
      this.activeHeldActionId = null;
      if (actionId && now - startedAt >= 1_000) {
        this.onLoadoutUse('utility', angle, clampedTarget.x, clampedTarget.y, {
          inputStarted: true,
          globalDismantle: true,
          heldActionId: actionId,
        });
      } else if (actionId) {
        this.bridge.sendHeldActionCancel(actionId);
      }
      return;
    }

    if (!utilityBlocked && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      const selectedAction = this.getSelectedRadialActionState(now);
      if (!selectedAction) return;
      if (selectedAction && !selectedAction.available) {
        if (selectedAction.disabledReason === 'cooldown') this.onUtilityPressedDuringCooldown?.();
        return;
      }
      if (selectedAction?.ref.kind === 'management'
        && selectedAction.ref.action === 'dismantle-own-all') {
        this.cancelUtilityInteraction();
        const actionId = this.createHeldActionId('global-dismantle');
        this.activeHeldActionId = actionId;
        this.globalDismantleHoldStartedAt = now;
        this.bridge.sendHeldActionStart(actionId, 'global_dismantle', 1_000);
        return;
      }
      if (selectedAction?.ref.kind === 'management'
        && selectedAction.ref.action === 'dismantle') {
        this.cancelUtilityInteraction();
        this.dismantlePlacementActive = true;
        this.syncPlacementPreviewState(this.getConstructionPlacementPreviewState());
        return;
      }
      if (selectedAction?.ref.kind === 'management') return;
      const persistentRewardId = this.getSelectedPersistentRewardId();
      if (persistentRewardId) {
        this.cancelUtilityInteraction();
        this.persistentRewardPlacementActive = true;
        this.bridge.sendDecoyStealthBreakRequest();
        this.syncPlacementPreviewState(this.getConstructionPlacementPreviewState());
        return;
      }
      const constructionTool = this.getSelectedConstructionToolRef();
      if (constructionTool?.kind === 'construction') {
        this.cancelUtilityInteraction();
        this.constructionPlacementActive = true;
        this.bridge.sendDecoyStealthBreakRequest();
        this.syncPlacementPreviewState(this.getConstructionPlacementPreviewState());
        return;
      }
      if (this.getEffectiveUtilityCooldownUntil() > now) {
        this.onUtilityPressedDuringCooldown?.();
        return;
      }
      // Translocator-Recall: Puck aktiv → sofort beamen (kein Aufladen)
      if (this.isTranslocatorRecallReady?.()) {
        this.predictCurrentUtilityCooldown(now);
        this.onLoadoutUse('utility', angle, clampedTarget.x, clampedTarget.y, this.getSelectedUtilityParams());
        return;
      }
      if (this.beginPlacementUtilityAim(now)) {
        this.syncPlacementPreviewState(this.getUtilityPlacementPreviewState());
        return;
      }
      if (this.beginTargetedUtilityAim(now)) {
        return;
      }
      if (!this.beginChargedUtilityHold(now)) {
        this.predictCurrentUtilityCooldown(now);
        this.onLoadoutUse('utility', angle, clampedTarget.x, clampedTarget.y, this.getSelectedUtilityParams());
      }
    }

    if (this.utilityHoldActive && this.utilityChargeStartedAt === null && this.keyE.isDown) {
      this.maybeStartHeldUtilityCharge(now);
    }

    // Screenshake während Gate-Charge (BFG Auflade-Feedback)
    if (this.utilityHoldActive && this.utilityChargeStartedAt !== null) {
      const chargeCfg = this.utilityChargeConfig ?? this.getChargeableUtilityConfig();
      if (chargeCfg?.activation.type === 'charged_gate') {
        this.cameraFeedback?.request(chargeRumble('utility', 0.003));
      }
    }

    const releasedUtility = Phaser.Input.Keyboard.JustUp(this.keyE);
    if (releasedUtility && this.utilityChargeStartedAt !== null) {
      this.releaseChargedUtility(angle, clampedTarget.x, clampedTarget.y, now);
    } else if (releasedUtility) {
      this.cancelUtilityCharge();
    } else if (this.utilityHoldActive && !this.keyE.isDown) {
      this.cancelUtilityCharge();
    }

    if (!constructionPreview) this.syncPlacementPreviewState(undefined);

    const gaussCfg     = ultimateCfg?.type === 'gauss'     ? ultimateCfg as GaussUltimateConfig     : undefined;
    const airstrikeCfg = ultimateCfg?.type === 'airstrike' ? ultimateCfg as AirstrikeUltimateConfig : undefined;
    const tunnelCfg    = ultimateCfg?.type === 'tunnel'    ? ultimateCfg as TunnelUltimateConfig    : undefined;
    if (!utilityBlocked && gaussCfg && Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.beginUltimateCharge(now, gaussCfg, angle, clampedTarget.x, clampedTarget.y);
    } else if (!utilityBlocked && airstrikeCfg && Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      const rage = this.getLocalRage?.() ?? 0;
      if (rage >= airstrikeCfg.rageCost) {
        this.cancelUtilityInteraction();
        this.ultimateTargetingActive = true;
        this.bridge.sendDecoyStealthBreakRequest();
      } else {
        this.notifyUltimatePressedWithoutRage();
        // Keine Rage: Feedback an Host senden (zeigt "zu wenig Rage"-Meldung)
        this.onLoadoutUse?.('ultimate', angle, clampedTarget.x, clampedTarget.y, { inputStarted: true });
      }
    } else if (!utilityBlocked && tunnelCfg && Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      const rage = this.getLocalRage?.() ?? 0;
      if (rage >= tunnelCfg.rageRequired) {
        this.cancelUtilityInteraction();
        this.cancelUltimateCharge();
        this.ultimateTargetingActive = false;
        this.ultimatePlacementActive = true;
        this.tunnelPlacementAnchor = null;
        this.bridge.sendDecoyStealthBreakRequest();
        this.syncPlacementPreviewState(this.getUltimatePlacementPreviewState());
      } else {
        this.notifyUltimatePressedWithoutRage();
        this.onLoadoutUse?.('ultimate', angle, clampedTarget.x, clampedTarget.y, { inputStarted: true });
      }
    } else if (!utilityBlocked && !gaussCfg && !airstrikeCfg && Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      const rage = this.getLocalRage?.() ?? 0;
      if (ultimateCfg && rage < ultimateCfg.rageRequired) {
        this.notifyUltimatePressedWithoutRage();
      } else if (ultimateCfg && ultimateCfg.type === 'buff') {
        this.audioSystem?.playLocalSound('sfx_honey_badger_rage');
      }
      this.onLoadoutUse('ultimate', angle, clampedTarget.x, clampedTarget.y, { inputStarted: true });
    }

    if (this.ultimateHoldActive && this.ultimateChargeStartedAt !== null && gaussCfg) {
      const chargeFraction = this.computeGaussChargeFraction(this.ultimateChargeStartedAt, gaussCfg, now);
      if (chargeFraction >= 1.0) {
        this.autoFireAndMaybeRechargeGauss(angle, clampedTarget.x, clampedTarget.y, now, gaussCfg);
      } else if (this.keyQ.isDown) {
        this.cameraFeedback?.request(chargeRumble('ultimate', 0.0022));
      }
    }

    if (Phaser.Input.Keyboard.JustUp(this.keyQ) && gaussCfg) {
      this.cancelUltimateCharge();
    } else if (this.ultimateHoldActive && !this.keyQ.isDown) {
      this.cancelUltimateCharge();
    }
    } finally {
      this.bridge.sendLocalPlacementPreview?.(this.placementPreviewState);
    }
  }

  private getGaussUltimateConfig(): GaussUltimateConfig | undefined {
    const cfg = this.getLocalUltimateConfig?.();
    return cfg?.type === 'gauss' ? cfg : undefined;
  }

  private getAirstrikeUltimateConfig(): AirstrikeUltimateConfig | undefined {
    const cfg = this.getLocalUltimateConfig?.();
    return cfg?.type === 'airstrike' ? cfg : undefined;
  }

  private getTunnelUltimateConfig(): TunnelUltimateConfig | undefined {
    const cfg = this.getLocalUltimateConfig?.();
    return cfg?.type === 'tunnel' ? cfg : undefined;
  }

  private getChargeableUtilityConfig(): ChargeableUtilityConfig | undefined {
    const cfg = this.getLocalUtilityConfig?.();
    if (!cfg || (cfg.activation.type !== 'charged_throw' && cfg.activation.type !== 'charged_gate')) return undefined;
    return cfg as UtilityConfig & { activation: ChargeableActivation };
  }

  private getTargetedUtilityConfig(): (UtilityConfig & { activation: TargetedActivation }) | undefined {
    const cfg = this.getLocalUtilityConfig?.();
    if (!cfg || cfg.activation.type !== 'targeted_click') return undefined;
    return cfg as UtilityConfig & { activation: TargetedActivation };
  }

  private getPlacementUtilityConfig(): (UtilityConfig & { activation: PlacementActivation }) | undefined {
    const cfg = this.getLocalUtilityConfig?.();
    if (!cfg || cfg.activation.type !== 'placement_mode') return undefined;
    return cfg as UtilityConfig & { activation: PlacementActivation };
  }

  private beginPlacementUtilityAim(now: number): boolean {
    const cfg = this.getPlacementUtilityConfig();
    if (!cfg) return false;
    if (now < this.getEffectiveUtilityCooldownUntil()) return true;
    this.cancelUtilityCharge();
    this.cancelUtilityTargeting();
    this.utilityPlacementActive = true;
    this.bridge.sendDecoyStealthBreakRequest();
    return true;
  }

  private getPointerWorldPoint(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    return getUnshakenPointerWorldPoint(this.scene, pointer);
  }

  /**
   * Setzt {@link currentAimAngle} aus Zeiger- und Spielerposition und liefert das auf
   * die Arena geclampte Ziel. Läuft bewusst vor jedem Input-Gate: Die Blickrichtung ist
   * der einzige Input, der auch bei gesperrter Eingabe (Arena-Countdown) weiterläuft und
   * repliziert wird. Ohne lokalen Sprite oder Aim-Recht bleibt der letzte Winkel stehen.
   */
  private updateAimFromPointer(): { x: number; y: number } | undefined {
    if (!this.aimEnabled) return undefined;

    const sprite = this.getLocalSprite();
    if (!sprite) return undefined;

    const pointerWorld = this.getPointerWorldPoint(this.scene.input.activePointer);
    const target = clampPointToArena(pointerWorld.x, pointerWorld.y);
    this.currentAimAngle = Phaser.Math.Angle.Between(sprite.x, sprite.y, target.x, target.y);
    return target;
  }

  private beginTargetedUtilityAim(now: number): boolean {
    const cfg = this.getTargetedUtilityConfig();
    if (!cfg) return false;

    if (now < this.getEffectiveUtilityCooldownUntil()) return true;

    this.cancelUtilityCharge();
    this.utilityTargetingActive = true;
    this.bridge.sendDecoyStealthBreakRequest();
    return true;
  }

  private beginChargedUtilityHold(now: number): boolean {
    const cfg = this.getChargeableUtilityConfig();
    if (!cfg) return false;

    const selected = this.getSelectedRadialActionState(now);
    if (!selected) return false;

    const cooldownUntil = this.getEffectiveUtilityCooldownUntil();
    this.utilityHoldActive = true;
    this.utilityChargeEligibleAt = now < cooldownUntil ? cooldownUntil : now;
    this.utilityChargeStartedAt = null;
    this.utilityChargeAction = cloneRadialActionRef(selected.ref);
    this.utilityChargeConfig = cfg;
    this.utilityChargeParams = this.getSelectedUtilityParams();
    this.maybeStartHeldUtilityCharge(now);
    this.bridge.sendDecoyStealthBreakRequest();
    return true;
  }

  private maybeStartHeldUtilityCharge(now: number): void {
    if (!this.utilityHoldActive || this.utilityChargeStartedAt !== null) return;

    const eligibleAt = this.utilityChargeEligibleAt ?? now;
    if (now < eligibleAt) return;

    // Die Host-Aktion beginnt erst mit diesem Request. Auch die lokale Prediction startet
    // deshalb am aktuellen Frame und nicht rueckwirkend am bereits verstrichenen Cooldown-Ende.
    this.utilityChargeStartedAt = now;
    this.utilityChargeEligibleAt = null;

    // BFG charge sound (charged_gate utilities)
    const utCfg = this.utilityChargeConfig ?? this.getChargeableUtilityConfig();
    const utilityParams = this.utilityChargeParams;
    const inspectorTool = utilityParams?.toolRef;
    if (utCfg) {
      const actionId = this.createHeldActionId(utCfg.activation.type);
      this.activeHeldActionId = actionId;
      this.bridge.sendHeldActionStart(
        actionId,
        utCfg.activation.type,
        utCfg.activation.fullChargeDuration,
        inspectorTool,
        utilityParams?.temporaryUtilityInstanceId,
      );
    }
    if (utCfg?.activation.type === 'charged_gate') {
      this.chargeLoopHandle = this.audioSystem?.startLoop('sfx_bfg_charge') ?? null;
    }
  }

  private releaseChargedUtility(angle: number, targetX: number, targetY: number, now: number): void {
    const cfg = this.utilityChargeConfig ?? this.getChargeableUtilityConfig();
    const startedAt = this.utilityChargeStartedAt;
    const actionId = this.activeHeldActionId;
    const chargeAction = this.utilityChargeAction;
    const chargeParams = this.utilityChargeParams;
    this.cancelUtilityCharge(false);
    if (!cfg || startedAt === null || !actionId) {
      if (actionId) this.bridge.sendHeldActionCancel(actionId);
      return;
    }

    const chargeFraction = this.computeUtilityChargeFraction(startedAt, cfg.activation, now);

    // Gate-Charge: nur feuern wenn voll aufgeladen (fraction >= 1.0)
    if (cfg.activation.type === 'charged_gate' && chargeFraction < 1.0) {
      this.bridge.sendHeldActionCancel(actionId);
      return;
    }

    this.predictUtilityCooldown(chargeAction, now + cfg.cooldown);

    this.onLoadoutUse?.('utility', angle, targetX, targetY, {
      ...chargeParams,
      utilityChargeFraction: chargeFraction,
      heldActionId: actionId,
    });
  }

  private computeUtilityChargeFraction(
    startedAt: number,
    activation: ChargeableActivation,
    now: number,
  ): number {
    if (activation.fullChargeDuration <= 0) return 1;
    const elapsed = now - startedAt;
    return Math.max(0, Math.min(1, elapsed / activation.fullChargeDuration));
  }

  private getEffectiveUtilityCooldownUntil(): number {
    const authoritative = this.getLocalUtilityCooldownUntil?.() ?? 0;
    const now = Date.now();
    const key = this.getUtilityPredictionKey();
    const predicted = this.predictedUtilityCooldownUntil.get(key) ?? 0;
    // An older snapshot may still say ready (cooldownUntil=0) while the use request is in
    // flight. Keep the newer local prediction for this action until it expires or the host
    // confirms an equal/later readyAt. A different action has a different key and is unaffected.
    if (authoritative >= predicted && predicted > 0) {
      this.predictedUtilityCooldownUntil.delete(key);
      return authoritative;
    }
    if (now >= predicted) {
      this.predictedUtilityCooldownUntil.delete(key);
      return authoritative;
    }
    return Math.max(authoritative, predicted);
  }

  private getUtilityPredictionKey(): string {
    if (this.selectedRadialAction) return radialActionKey(this.selectedRadialAction);
    return `utility:${this.getLocalUtilityConfig?.()?.id ?? '__default__'}`;
  }

  private predictSelectedUtilityCooldown(readyAt: number): void {
    this.predictUtilityCooldown(this.selectedRadialAction, readyAt);
  }

  private predictCurrentUtilityCooldown(now: number): void {
    const cooldown = this.getLocalUtilityConfig?.()?.cooldown ?? 0;
    if (cooldown > 0) this.predictSelectedUtilityCooldown(now + cooldown);
  }

  private predictUtilityCooldown(action: RadialActionRef | null, readyAt: number): void {
    if (!Number.isFinite(readyAt) || readyAt <= 0) return;
    const key = action ? radialActionKey(action) : this.getUtilityPredictionKey();
    const current = this.predictedUtilityCooldownUntil.get(key) ?? 0;
    this.predictedUtilityCooldownUntil.set(key, Math.max(current, readyAt));
  }

  private isUtilityBlocked(now: number): boolean {
    if (!this.utilityHoldActive || this.utilityChargeStartedAt !== null) return false;
    const eligibleAt = this.utilityChargeEligibleAt ?? this.getEffectiveUtilityCooldownUntil();
    return now < eligibleAt;
  }

  private consumeLeftClickForModeConfirmation(): void {
    this.suppressWeapon1UntilLeftRelease = true;
  }

  private consumeRightClickForModeCancellation(): void {
    this.consumedPointerButtons |= SECONDARY_POINTER_BUTTON;
    this.pendingRightInputStarted = false;
  }

  private cancelUtilityTargeting(): void {
    this.utilityTargetingActive = false;
  }

  private cancelUtilityPlacement(): void {
    this.utilityPlacementActive = false;
    this.placementPreviewState = null;
  }

  private cancelUltimatePlacement(): void {
    this.ultimatePlacementActive = false;
    this.tunnelPlacementAnchor = null;
    this.placementPreviewState = null;
  }

  private cancelUtilityInteraction(): void {
    this.cancelUtilityCharge();
    this.cancelUtilityTargeting();
    this.cancelUtilityPlacement();
    this.cancelRadialPlacement();
    this.cancelGlobalDismantleHold();
  }

  private cancelRadialPlacement(): void {
    this.constructionPlacementActive = false;
    this.dismantlePlacementActive = false;
    this.persistentRewardPlacementActive = false;
    this.placementPreviewState = null;
  }

  private cancelUtilityCharge(cancelHost = true): void {
    if (cancelHost && this.activeHeldActionId) this.bridge.sendHeldActionCancel(this.activeHeldActionId);
    this.activeHeldActionId = null;
    this.utilityHoldActive = false;
    this.utilityChargeEligibleAt = null;
    this.utilityChargeStartedAt = null;
    this.utilityChargeAction = null;
    this.utilityChargeConfig = null;
    this.utilityChargeParams = undefined;
    if (this.chargeLoopHandle) {
      this.audioSystem?.stopLoop(this.chargeLoopHandle);
      this.chargeLoopHandle = null;
    }
  }

  private cancelGlobalDismantleHold(): void {
    if (this.globalDismantleHoldStartedAt === null) return;
    if (this.activeHeldActionId) this.bridge.sendHeldActionCancel(this.activeHeldActionId);
    this.globalDismantleHoldStartedAt = null;
    this.activeHeldActionId = null;
  }

  private createHeldActionId(kind: string): string {
    this.heldActionSequence += 1;
    return `ha:${kind}:${this.heldActionSequence.toString(36)}`;
  }

  private cancelScopeAim(): void {
    this.scopeStartedAt = null;
    this.scopeProgress = 0;
    this.scopeChargeProgress = 0;
  }

  private syncPlacementPreviewState(preview: UtilityPlacementPreviewState | undefined): void {
    if ((!this.utilityPlacementActive
      && !this.constructionPlacementActive
      && !this.dismantlePlacementActive
      && !this.persistentRewardPlacementActive) || !preview) {
      this.placementPreviewState = null;
      return;
    }

    this.placementPreviewState = {
      active: true,
      kind: preview.kind,
      gridX: preview.gridX,
      gridY: preview.gridY,
      x: preview.targetX,
      y: preview.targetY,
      isValid: preview.isValid,
      frame: preview.frame,
      stage: preview.stage,
      anchorGridX: preview.anchorGridX,
      anchorGridY: preview.anchorGridY,
      anchorX: preview.anchorX,
      anchorY: preview.anchorY,
      constructionId: preview.constructionId,
      powerUpDefId: preview.powerUpDefId,
    };
  }

  private beginUltimateCharge(
    now: number,
    _cfg: GaussUltimateConfig,
    angle: number,
    targetX: number,
    targetY: number,
  ): void {
    const rage = this.getLocalRage?.() ?? 0;
    const cfg = this.getGaussUltimateConfig();
    if (!cfg) return;
    if (rage < cfg.rageRequired) {
      this.notifyUltimatePressedWithoutRage();
      return;
    }
    this.cancelUtilityInteraction();
    this.ultimateHoldActive = true;
    this.ultimateChargeStartedAt = now;
    this.chargeLoopHandle = this.audioSystem?.startLoop('sfx_gauss_charge') ?? null;
    this.bridge.sendDecoyStealthBreakRequest();
    this.onLoadoutUse?.('ultimate', angle, targetX, targetY, { ultimateAction: 'press', inputStarted: true });
  }

  private releaseUltimateCharge(
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    cfg: GaussUltimateConfig,
  ): void {
    const startedAt = this.ultimateChargeStartedAt;
    this.cancelUltimateCharge();
    if (startedAt === null) return;

    const chargeFraction = this.computeGaussChargeFraction(startedAt, cfg, now);
    this.onLoadoutUse?.('ultimate', angle, targetX, targetY, {
      ultimateAction: 'release',
      ultimateChargeFraction: chargeFraction,
    });
  }

  private computeGaussChargeFraction(startedAt: number, cfg: GaussUltimateConfig, now: number): number {
    if (cfg.chargeDuration <= 0) return 1;
    const elapsed = now - startedAt;
    return Math.max(0, Math.min(1, elapsed / cfg.chargeDuration));
  }

  private autoFireAndMaybeRechargeGauss(
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    cfg: GaussUltimateConfig,
  ): void {
    if (this.ultimateChargeStartedAt === null) return;

    this.onLoadoutUse?.('ultimate', angle, targetX, targetY, {
      ultimateAction: 'release',
      ultimateChargeFraction: 1.0,
    });

    if (this.keyQ.isDown) {
      const rage = this.getLocalRage?.() ?? 0;
      if (rage >= cfg.rageRequired) {
        this.ultimateChargeStartedAt = now;
        this.bridge.sendDecoyStealthBreakRequest();
        this.onLoadoutUse?.('ultimate', angle, targetX, targetY, { ultimateAction: 'press' });
        return;
      }
    }
    this.cancelUltimateCharge();
  }

  private cancelUltimateCharge(): void {
    this.ultimateHoldActive = false;
    this.ultimateChargeStartedAt = null;
    if (this.chargeLoopHandle) {
      this.audioSystem?.stopLoop(this.chargeLoopHandle);
      this.chargeLoopHandle = null;
    }
  }

  private notifyUltimatePressedWithoutRage(): void {
    this.onUltimatePressedWithoutRage?.();
  }

  setCameraFeedback(controller: CameraFeedbackController | null): void {
    this.cameraFeedback = controller;
  }

  setAudioSystem(system: GameAudioSystem): void {
    this.audioSystem = system;
  }
}
