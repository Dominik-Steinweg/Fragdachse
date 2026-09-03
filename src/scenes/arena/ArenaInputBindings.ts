import * as Phaser from 'phaser';
import type { GameAudioSystem } from '../../audio/GameAudioSystem';
import { getCoopDefenseConstructionDefinition, COOP_DEFENSE_DISMANTLE_RANGE } from '../../config/coopDefenseConstructions';
import type { CoopDefenseConstructionDefinition } from '../../config/coopDefenseConstructions';
import { isCoopDefenseMode } from '../../gameModes';
import { getUtilityConfigForMode } from '../../loadout/LoadoutConfig';
import type {
  PlaceableUtilityConfig,
  TunnelUltimateConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from '../../loadout/LoadoutConfig';
import type {
  ConstructionId,
  GameMode,
  GamePhase,
  LoadoutCommitSnapshot,
  LoadoutSlot,
  LoadoutToolRef,
  LoadoutUseParams,
  LoadoutUseResult,
  TemporaryUtilityInstanceDescriptor,
  UtilityPlacementPreviewState,
} from '../../types';
import { t } from '../../i18n';
import type { PersistentBaseRewardId } from '../../persistentBase/PersistentBaseRewardTypes';
import type { RadialActionRef } from '../../systems/RadialActionModel';
import type { InputSystem } from '../../systems/InputSystem';
import { resolveInputPolicy, type InputPolicyInput } from '../../world/InputPolicy';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';
import type {
  LocalWeaponPredictionResult,
  PredictedWeapon2Request,
} from './ClientUpdateCoordinator';

export type ArenaInputDebugHotkey = 'flowfield_bases' | 'flowfield_players';

/** Kleine UI-/Lifecycle-Ports fuer die lokalen Hotkeys; die Scene bleibt deren Composition-Owner. */
export interface ArenaInputHotkeyPorts {
  getGamePhase(): GamePhase;
  isMatchTerminated(): boolean;
  isCoopDefenseMode(): boolean;
  canLeaveLocalLobbyWorld(): boolean;
  requestLocalLobbyWorldLeave(): void;

  isHotkeyInputBlocked(): boolean;
  isHelpOverlayOpen(): boolean;
  hideHelpOverlay(): void;
  isOptionsOverlayOpen(): boolean;
  hideOptionsOverlay(): void;
  toggleOptionsOverlay(): void;
  isCoopDefenseUpgradesOpen(): boolean;
  hideCoopDefenseUpgrades(): void;
  isCoopDefenseDebugOpen(): boolean;
  hideCoopDefenseDebug(): void;
  toggleCoopDefenseDebug(): void;
  isItemsOpen(): boolean;
  hideItems(): void;
  isItemRewardVisible(): boolean;
  hideItemReward(): void;
  isMatchResultsVisible(): boolean;
  hideMatchResults(): void;
  isRoomStatisticsVisible(): boolean;
  hideRoomStatistics(): void;
  isWeaponBalanceLabOpen(): boolean;
  hideWeaponBalanceLab(): void;
  toggleWeaponBalanceLab(): void;
  isNetDebugOpen(): boolean;
  hideNetDebug(): void;
  toggleNetDebug(): void;
  isPerformanceOverlayOpen(): boolean;
  hidePerformanceOverlay(): void;
  togglePerformanceOverlay(): void;
  isTimeOfDayDebugOpen(): boolean;
  hideTimeOfDayDebug(): void;
  toggleTimeOfDayDebug(): void;
}

export interface ArenaInputPlacementPorts {
  getUsedCapacity(ownerId: string): number;
  getDismantlePreview(
    ownerId: string,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    range: number,
  ): UtilityPlacementPreviewState | undefined;
  getPlacementPreview(
    config: PlaceableUtilityConfig,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined;
  getTunnelPlacementPreview(
    config: TunnelUltimateConfig,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    anchor: { x: number; y: number; gridX: number; gridY: number } | null,
  ): UtilityPlacementPreviewState | undefined;
  getConstructionPlacementPreview(
    definition: CoopDefenseConstructionDefinition,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined;
}

export interface ArenaInputPersistentBasePorts {
  getRewardIdsForPlayer(playerId: string): readonly PersistentBaseRewardId[];
  getRewardPlacementPreview(
    playerId: string,
    rewardId: PersistentBaseRewardId,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined;
  requestRewardPlacement(
    rewardId: PersistentBaseRewardId,
    preview: UtilityPlacementPreviewState,
  ): Promise<LoadoutUseResult>;
  getMoveSourcePreview(
    playerId: string,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined;
  getMoveTargetPreview(
    playerId: string,
    sourceRuntimeId: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined;
  requestMove(sourceRuntimeId: number, preview: UtilityPlacementPreviewState): Promise<LoadoutUseResult>;
}

export interface ArenaInputFeedbackPorts {
  notifyAdrenalineInsufficientShot(): void;
  flashUltimateInsufficientRage(): void;
  flashUtilityCooldown(fraction: number, displayName: string): void;
  showPlacementError(message: string): void;
}

export interface ArenaInputActionPorts {
  getLocalUtilityConfig(): UtilityConfig | undefined;
  getLocalUtilityCooldownUntil(temporaryUtilityInstanceId?: string): number;
  getLocalUltimateConfig(): UltimateConfig | undefined;
  getLocalRage(): number;
  getLocalWeaponConfig(slot: 'weapon1' | 'weapon2'): WeaponConfig | undefined;
  getLocalWeaponAdrenalineCost(slot?: 'weapon1' | 'weapon2'): number;
  getLocalAdrenaline(): number;
  getLocalInspectorTools(): readonly LoadoutToolRef[];
  getLocalConstructionCapacity(): number;
  getWeaponLastFired(slot: 'weapon1' | 'weapon2'): number;
  notifyLoadoutFired(
    slot: 'weapon1' | 'weapon2',
    angle: number,
    targetX: number,
    targetY: number,
  ): LocalWeaponPredictionResult;
  rollbackRejectedLoadoutFire(slot: 'weapon1' | 'weapon2', predictionId?: number): void;
  notifyUtilityFired(): void;
  beginPredictedWeapon2Use(
    predictionId: number,
    request: PredictedWeapon2Request,
    amount: number,
    onReject: (result: LoadoutUseResult) => void,
  ): void;

  getLocalPlayerId(): string;
  getActiveGameMode(): GameMode;
  isHost(): boolean;
  getSynchronizedNow(): number;
  getPlayerCurrentLoadoutSnapshot(playerId: string): LoadoutCommitSnapshot | null;
  getPlayerUtilityCooldownUntil(playerId: string, utilityId?: string): number;
  getPlayerTemporaryUtilityInstances(playerId: string): readonly TemporaryUtilityInstanceDescriptor[];
  sendLoadoutUse(
    slot: LoadoutSlot,
    angle: number,
    targetX: number,
    targetY: number,
    shotId?: number,
    params?: LoadoutUseParams,
    clientX?: number,
    clientY?: number,
    awaitResult?: boolean,
    predictionId?: number,
  ): Promise<LoadoutUseResult | null>;

  getPlayerCapabilities(): PlayerCapabilities;
  isLocalPlayerAlive(): boolean;
  isLocalPlayerBurrowed(): boolean;
  getLocalPlayerPosition(): { x: number; y: number } | undefined;
  getPointerWorldPoint(): { x: number; y: number };
  getConstructionCapacityForPlayer(playerId: string): number | undefined;
  getTranslocatorActivePuckId(playerId: string): number | undefined;

  readonly placement: ArenaInputPlacementPorts;
  readonly persistentBase: ArenaInputPersistentBasePorts;
  readonly feedback: ArenaInputFeedbackPorts;
}

export interface ArenaInputBindingsInput {
  readonly scene: Phaser.Scene;
  readonly inputSystem: InputSystem;
  readonly audioSystem: GameAudioSystem;
  readonly actions: ArenaInputActionPorts;
  readonly onFlowFieldDebugHotkey: (type: ArenaInputDebugHotkey) => void;
  readonly hotkeys: ArenaInputHotkeyPorts;
}

export interface ArenaSpectatorCameraInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
}

export interface ArenaInputFrameState {
  readonly enabled: boolean;
  readonly gameplayActive: boolean;
  readonly countdownActive: boolean;
  readonly uiBlocking: boolean;
  readonly diagnosticsArena: boolean;
}

export interface ArenaAimPresentationState {
  readonly aimVisible: boolean;
  readonly cursorVisible: boolean;
}

/**
 * Scene-langlebiger Owner fuer Keyboard-Setup, InputSystem-Callbacks und lokale Hotkeys.
 *
 * Der Owner entscheidet keine hostautoritativen Regeln. Er verbindet die bestehende
 * InputSystem-Callbackflaeche mit kleinen Read-/Request-/Feedback-Ports und besitzt deren
 * lokale Lifetime. Vorschauen und lokale Rueckmeldungen bleiben damit ausserhalb von
 * ArenaScene, waehrend Hostvalidierung und Gameplay weiterhin in ihren bestehenden Owners leben.
 */
export class ArenaInputBindings {
  private spectatorCameraLeftKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraRightKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraUpKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraDownKey: Phaser.Input.Keyboard.Key | null = null;
  private arenaPanelTabKey: Phaser.Input.Keyboard.Key | null = null;
  private coopDefenseDebugDamageKey: Phaser.Input.Keyboard.Key | null = null;

  private escapeHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private optionsHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private coopDefenseXpDebugHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private weaponBalanceLabHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private netDebugHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private performanceHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private timeOfDayHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;

  private setupComplete = false;
  private destroyed = false;

  constructor(private readonly input: ArenaInputBindingsInput) {}

  setup(): void {
    if (this.setupComplete || this.destroyed) return;
    const keyboard = this.input.scene.input.keyboard;
    if (!keyboard) return;

    this.setupComplete = true;
    this.spectatorCameraLeftKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false);
    this.spectatorCameraRightKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D, false);
    this.spectatorCameraUpKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W, false);
    this.spectatorCameraDownKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S, false);
    this.input.inputSystem.setup();
    this.input.inputSystem.setAudioSystem(this.input.audioSystem);
    this.input.inputSystem.setupUtilityConfigProvider(this.input.actions.getLocalUtilityConfig);
    this.input.inputSystem.setupUtilityCooldownProvider(
      this.input.actions.getLocalUtilityCooldownUntil.bind(this.input.actions),
    );
    this.input.inputSystem.setupUltimateConfigProvider(this.input.actions.getLocalUltimateConfig);
    this.input.inputSystem.setupLocalRageProvider(this.input.actions.getLocalRage);
    this.input.inputSystem.setupDebugHotkeys((type) => {
      if (!this.destroyed) this.input.onFlowFieldDebugHotkey(type);
    });
    this.input.inputSystem.setupWeapon2ConfigProvider(
      this.input.actions.getLocalWeaponConfig.bind(this.input.actions, 'weapon2'),
    );
    this.setupActionBindings();

    this.arenaPanelTabKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB, true);
    // K bleibt fuer den optionalen Debug-Schaden abfragbar, darf aber kein DOM-Textfeld
    // blockieren, weil der Buchstabe auch in Spielernamen verwendet wird.
    this.coopDefenseDebugDamageKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K, false);

    this.escapeHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      if (!ports.canLeaveLocalLobbyWorld()) return;

      // ESC schliesst immer zuerst die oberste UI-Schicht. Erst wenn keine modale oder
      // eingabeblockierende Oberflaeche offen ist, darf es die World-Teilnahme verlassen.
      if (ports.isHelpOverlayOpen()) {
        ports.hideHelpOverlay();
        event.preventDefault();
        return;
      }
      if (ports.isOptionsOverlayOpen()) {
        ports.hideOptionsOverlay();
        event.preventDefault();
        return;
      }
      if (ports.isCoopDefenseUpgradesOpen()) {
        ports.hideCoopDefenseUpgrades();
        event.preventDefault();
        return;
      }
      if (ports.isCoopDefenseDebugOpen()) {
        ports.hideCoopDefenseDebug();
        event.preventDefault();
        return;
      }
      if (ports.isItemsOpen()) {
        ports.hideItems();
        event.preventDefault();
        return;
      }
      if (ports.isItemRewardVisible()) {
        ports.hideItemReward();
        event.preventDefault();
        return;
      }
      if (ports.isMatchResultsVisible()) {
        ports.hideMatchResults();
        event.preventDefault();
        return;
      }
      if (ports.isRoomStatisticsVisible()) {
        ports.hideRoomStatistics();
        event.preventDefault();
        return;
      }
      if (ports.isWeaponBalanceLabOpen()) {
        ports.hideWeaponBalanceLab();
        event.preventDefault();
        return;
      }
      if (ports.isNetDebugOpen()) {
        ports.hideNetDebug();
        event.preventDefault();
        return;
      }
      if (ports.isPerformanceOverlayOpen()) {
        ports.hidePerformanceOverlay();
        event.preventDefault();
        return;
      }
      if (ports.isTimeOfDayDebugOpen()) {
        ports.hideTimeOfDayDebug();
        event.preventDefault();
        return;
      }
      if (ports.isHotkeyInputBlocked()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      ports.requestLocalLobbyWorldLeave();
    };
    keyboard.on('keydown-ESC', this.escapeHotkeyHandler);

    this.optionsHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      const phase = ports.getGamePhase();
      if ((phase !== 'LOBBY' && phase !== 'ARENA') || ports.isMatchTerminated()) return;
      if (ports.isHotkeyInputBlocked()) return;
      if (ports.isHelpOverlayOpen()) return;
      if (ports.isCoopDefenseUpgradesOpen()) return;
      if (ports.isCoopDefenseDebugOpen()) return;
      if (ports.isWeaponBalanceLabOpen()) return;

      ports.toggleOptionsOverlay();
    };
    keyboard.on('keydown-O', this.optionsHotkeyHandler);

    this.coopDefenseXpDebugHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      if (ports.getGamePhase() !== 'LOBBY' || ports.isMatchTerminated()) return;
      if (!ports.isCoopDefenseMode()) return;
      if (ports.isHotkeyInputBlocked()) return;
      if (ports.isHelpOverlayOpen()) return;
      if (ports.isOptionsOverlayOpen()) return;
      if (ports.isCoopDefenseUpgradesOpen()) return;
      if (ports.isWeaponBalanceLabOpen()) return;

      ports.toggleCoopDefenseDebug();
    };
    keyboard.on('keydown-L', this.coopDefenseXpDebugHotkeyHandler);

    this.weaponBalanceLabHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      if (ports.getGamePhase() !== 'LOBBY' || ports.isMatchTerminated()) return;
      if (!ports.isCoopDefenseMode()) return;
      if (ports.isHotkeyInputBlocked()) return;
      if (ports.isHelpOverlayOpen() || ports.isOptionsOverlayOpen()) return;
      if (ports.isCoopDefenseUpgradesOpen() || ports.isCoopDefenseDebugOpen()) return;
      event.preventDefault();
      ports.toggleWeaponBalanceLab();
    };
    keyboard.on('keydown-F8', this.weaponBalanceLabHotkeyHandler);

    // Transportdiagnose ist in jeder Phase erreichbar – gerade wenn etwas klemmt.
    this.netDebugHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const ports = this.input.hotkeys;
      if (ports.isHotkeyInputBlocked()) return;
      ports.toggleNetDebug();
    };
    keyboard.on('keydown-P', this.netDebugHotkeyHandler);

    this.performanceHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // T ist ein Schreibzeichen: nicht auslösen, während ein Textfeld den Fokus hat.
      if (this.input.hotkeys.isHotkeyInputBlocked()) return;
      this.input.hotkeys.togglePerformanceOverlay();
    };
    keyboard.on('keydown-T', this.performanceHotkeyHandler);

    this.timeOfDayHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // M ist ein Schreibzeichen: nicht auslösen, während ein Textfeld den Fokus hat.
      if (this.input.hotkeys.isHotkeyInputBlocked()) return;
      this.input.hotkeys.toggleTimeOfDayDebug();
    };
    keyboard.on('keydown-M', this.timeOfDayHotkeyHandler);
  }

  private setupActionBindings(): void {
    const actions = this.input.actions;
    const inputSystem = this.input.inputSystem;

    inputSystem.setupRadialActionProviders({
      getTools: () => {
        const localId = actions.getLocalPlayerId();
        const currentLoadout = actions.getPlayerCurrentLoadoutSnapshot(localId);
        return isCoopDefenseMode(actions.getActiveGameMode())
          && currentLoadout?.coopDefenseClassId === 'inspector_gadachs'
          ? actions.getLocalInspectorTools()
          : currentLoadout?.utility
            ? [{ kind: 'utility' as const, id: currentLoadout.utility }]
            : [];
      },
      // Host und Client halten denselben Bestand platzierter Objekte, deshalb kann die
      // belegte Baukapazitaet lokal berechnet werden. Das Maximum kommt aus denselben
      // Effekt-Summen wie das HUD, damit das Radialmenue nichts als baubar anzeigt, was das
      // Host-Gate anschliessend ablehnt.
      getCapacity: () => {
        const localId = actions.getLocalPlayerId();
        return {
          used: actions.placement.getUsedCapacity(localId),
          max: actions.isHost()
            ? actions.getConstructionCapacityForPlayer(localId) ?? actions.getLocalConstructionCapacity()
            : actions.getLocalConstructionCapacity(),
        };
      },
      getDismantlePreview: () => {
        const localId = actions.getLocalPlayerId();
        const position = actions.getLocalPlayerPosition();
        if (!position) return undefined;
        const pointer = actions.getPointerWorldPoint();
        return actions.placement.getDismantlePreview(
          localId,
          position.x,
          position.y,
          pointer.x,
          pointer.y,
          COOP_DEFENSE_DISMANTLE_RANGE,
        );
      },
      getCooldownUntil: (ref: RadialActionRef) => {
        const localId = actions.getLocalPlayerId();
        if (ref.kind === 'construction') {
          return actions.getPlayerUtilityCooldownUntil(localId, ref.constructionId);
        }
        if (ref.kind === 'utility') {
          const resolved = getUtilityConfigForMode(ref.utilityId, actions.getActiveGameMode());
          return actions.getPlayerUtilityCooldownUntil(localId, resolved?.id ?? ref.utilityId);
        }
        if (ref.kind === 'management') {
          return actions.getPlayerUtilityCooldownUntil(localId, `management:${ref.action}`);
        }
        return 0;
      },
      getCapabilities: () => {
        const capabilities = actions.getPlayerCapabilities();
        return {
          canUseUtility: capabilities.canInteract && capabilities.canUseCombat,
          canPlace: capabilities.canInteract && capabilities.canPlace,
          canManage: capabilities.canInteract && capabilities.canDismantle,
        };
      },
      // Persistent-Base-Management ist nach 3F keine Klassenfrage mehr: Base-owned Rewards
      // gehoeren der Basis, und persoenliche Konstruktionen bleiben ueber die Ownership-Pruefung
      // des Hosts geschuetzt. Angeboten wird die Verwaltung deshalb im gesamten Coop-Defense-Modus.
      getManagementActions: () => (isCoopDefenseMode(actions.getActiveGameMode())
        ? ['reposition', 'dismantle', 'dismantle-own-all'] as const
        : []),
      utilityUsesToolRef: (utilityId: string) => {
        const currentLoadout = actions.getPlayerCurrentLoadoutSnapshot(actions.getLocalPlayerId());
        return currentLoadout?.coopDefenseClassId === 'inspector_gadachs'
          && (currentLoadout.tools ?? []).some((tool) => tool.kind === 'utility' && tool.id === utilityId);
      },
    });
    inputSystem.setupTemporaryUtilityProvider(
      () => actions.getPlayerTemporaryUtilityInstances(actions.getLocalPlayerId()),
    );
    inputSystem.setupPersistentRewardActionProvider(
      () => {
        if (!isCoopDefenseMode(actions.getActiveGameMode())) return [];
        return actions.persistentBase.getRewardIdsForPlayer(actions.getLocalPlayerId());
      },
      (rewardId: PersistentBaseRewardId) => {
        const pointer = actions.getPointerWorldPoint();
        return actions.persistentBase.getRewardPlacementPreview(
          actions.getLocalPlayerId(),
          rewardId,
          pointer.x,
          pointer.y,
        );
      },
      (rewardId, preview) => actions.persistentBase.requestRewardPlacement(rewardId, preview),
    );
    inputSystem.setupRepositionActionProvider(
      () => {
        const pointer = actions.getPointerWorldPoint();
        return actions.persistentBase.getMoveSourcePreview(
          actions.getLocalPlayerId(),
          pointer.x,
          pointer.y,
        );
      },
      (sourceRuntimeId: number) => {
        const pointer = actions.getPointerWorldPoint();
        return actions.persistentBase.getMoveTargetPreview(
          actions.getLocalPlayerId(),
          sourceRuntimeId,
          pointer.x,
          pointer.y,
        );
      },
      (sourceRuntimeId, preview) => actions.persistentBase.requestMove(sourceRuntimeId, preview).then((result) => {
        if (!result.ok) actions.feedback.showPlacementError(t('ui.errors.moveFailed'));
        return result;
      }),
    );

    const playLocalFailureSound = (slot: LoadoutSlot): void => {
      if (slot === 'weapon1' || slot === 'weapon2') {
        const shotAudio = actions.getLocalWeaponConfig(slot)?.shotAudio;
        this.input.audioSystem.playLocalSound(shotAudio?.failureKey);
        return;
      }

      if (slot === 'ultimate') {
        const ultimate = actions.getLocalUltimateConfig();
        if (ultimate?.type === 'gauss') {
          this.input.audioSystem.playLocalSound(ultimate.shotAudio?.failureKey);
        }
      }
    };
    const getLocalWeapon2AdrenalineCost = (): number => {
      return actions.getLocalWeaponAdrenalineCost('weapon2');
    };
    const isWeapon2AdrenalineInsufficient = (assumeRecentLocalShot = false): boolean => {
      const adrenalineCost = getLocalWeapon2AdrenalineCost();
      if (adrenalineCost <= 0) return false;

      const localAdrenaline = actions.getLocalAdrenaline();
      if (localAdrenaline < adrenalineCost) return true;
      if (!assumeRecentLocalShot) return false;

      return localAdrenaline < adrenalineCost * 2;
    };
    const handleLocalFailureFeedback = (
      slot: LoadoutSlot,
      reason: 'cooldown' | 'resource',
      inputStarted: boolean,
      resourceKind?: LoadoutUseResult['resourceKind'],
      assumeRecentLocalWeapon2Shot = false,
    ): void => {
      if (!inputStarted) return;

      if (
        slot === 'weapon2'
        && ((reason === 'resource' && resourceKind === 'adrenaline')
          || (reason === 'cooldown' && isWeapon2AdrenalineInsufficient(assumeRecentLocalWeapon2Shot)))
      ) {
        actions.feedback.notifyAdrenalineInsufficientShot();
      }

      if (slot === 'ultimate' && reason === 'resource' && resourceKind === 'rage') {
        actions.feedback.flashUltimateInsufficientRage();
      }

      playLocalFailureSound(slot);
    };
    inputSystem.setupCanStartScopeCheck(() => {
      const wepConfig = actions.getLocalWeaponConfig('weapon2');
      if (!wepConfig) return false;
      const lastFired = actions.getWeaponLastFired('weapon2');
      const cooldownOk = lastFired === 0 || Date.now() - lastFired >= wepConfig.cooldown;
      const adrenalineCost = getLocalWeapon2AdrenalineCost();
      const adrenalineOk = adrenalineCost === 0 || actions.getLocalAdrenaline() >= adrenalineCost;
      if (!cooldownOk) {
        handleLocalFailureFeedback('weapon2', 'cooldown', true, undefined, true);
        return false;
      }
      if (!adrenalineOk) {
        handleLocalFailureFeedback('weapon2', 'resource', true, 'adrenaline');
        return false;
      }
      return true;
    });
    inputSystem.setupUtilityPlacementPreviewProvider(() => this.getLocalPlacementPreview());
    inputSystem.setupUltimatePlacementPreviewProvider(() => this.getLocalUltimatePlacementPreview());
    inputSystem.setupConstructionPlacementPreviewProvider(
      (constructionId: ConstructionId) => {
        const position = actions.getLocalPlayerPosition();
        if (!position) return undefined;
        const pointer = actions.getPointerWorldPoint();
        return actions.placement.getConstructionPlacementPreview(
          getCoopDefenseConstructionDefinition(constructionId),
          position.x,
          position.y,
          pointer.x,
          pointer.y,
        );
      },
    );
    inputSystem.setupTranslocatorRecallCheck(() => {
      const cfg = actions.getLocalUtilityConfig();
      if (!cfg || cfg.type !== 'translocator') return false;
      return actions.getTranslocatorActivePuckId(actions.getLocalPlayerId()) !== undefined;
    });
    inputSystem.onUtilityPressedDuringCooldown = () => {
      const config = actions.getLocalUtilityConfig();
      const selected = inputSystem.getSelectedRadialActionForHud();
      const cooldownUntil = inputSystem.getSelectedUtilityCooldownUntil();
      const remaining = Math.max(0, cooldownUntil - actions.getSynchronizedNow());
      const cooldown = selected?.kind === 'construction'
        ? getCoopDefenseConstructionDefinition(selected.constructionId).buildCooldownMs
        : config?.cooldown ?? 0;
      const fraction = cooldown > 0 ? Math.min(1, remaining / cooldown) : 0.8;
      const displayName = selected?.kind === 'construction' ? selected.constructionId : config?.id ?? 'UTILITY';
      actions.feedback.flashUtilityCooldown(fraction, displayName);
    };
    inputSystem.onUltimatePressedWithoutRage = () => {
      actions.feedback.flashUltimateInsufficientRage();
    };

    const handleLocalLoadoutFailure = (
      slot: LoadoutSlot,
      result: LoadoutUseResult | null,
      inputStarted: boolean,
      predictionId?: number,
    ): void => {
      if (!result || result.ok) return;

      if (slot === 'ultimate') {
        inputSystem.cancelLocalUltimateChargePreview();
      }

      if ((slot === 'weapon1' || slot === 'weapon2')
        && (result.reason === 'cooldown' || result.reason === 'resource')) {
        actions.rollbackRejectedLoadoutFire(slot, predictionId);
      }

      if (result.reason === 'cooldown' || result.reason === 'resource') {
        handleLocalFailureFeedback(slot, result.reason, inputStarted, result.resourceKind);
      }
    };
    const getConstructionFailureMessage = (reason: LoadoutUseResult['reason']): string => {
      switch (reason) {
        case 'capacity': return t('ui.errors.capacity');
        case 'cooldown': return t('ui.errors.cooldown');
        case 'placement': return t('ui.errors.placement');
        default: return t('ui.errors.blocked');
      }
    };
    inputSystem.setupLoadoutListener((slot, angle, targetX, targetY, params) => {
      const capabilities = actions.getPlayerCapabilities();
      if (!capabilities.canInteract) return;
      const dismantleAction = params?.dismantle === true || params?.globalDismantle === true;
      const constructionAction = params?.constructionId !== undefined
        || params?.toolRef?.kind === 'construction';
      if (dismantleAction ? !capabilities.canDismantle
        : constructionAction ? !capabilities.canPlace
        : !capabilities.canUseCombat) return;
      if (!actions.isLocalPlayerAlive() || actions.isLocalPlayerBurrowed()) return;

      let shotId: number | undefined;
      let predictedWeapon2Id: number | undefined;
      const inputStarted = params?.inputStarted === true;

      if ((slot === 'weapon1' || slot === 'weapon2') && !params?.constructionId) {
        // scopeHolding: kein Schuss, nur holdSpeedFactor auf Host-Seite aktiv halten.
        // Weder Cooldown-Check noch notifyLoadoutFired – sonst würde der echte Schuss blockiert.
        if (params?.scopeHolding) {
          void actions.sendLoadoutUse(slot, angle, targetX, targetY, undefined, params);
          return;
        }
        const now = Date.now();
        const lastFired = actions.getWeaponLastFired(slot);
        const wepConfig = actions.getLocalWeaponConfig(slot);
        if (!wepConfig) return;
        if (lastFired > 0 && now - lastFired < wepConfig.cooldown) {
          handleLocalFailureFeedback(slot, 'cooldown', inputStarted, undefined, slot === 'weapon2');
          return;
        }
        // Der Host prueft Ressourcen autoritativ im LoadoutManager. Dasselbe Gate muss vor
        // der lokalen Prediction liegen, die sowohl Host als auch Clients ausfuehren; sonst
        // werden trotz abgelehntem Schuss weiterhin Strahl und Erfolgssound dargestellt.
        if (slot === 'weapon2' && isWeapon2AdrenalineInsufficient()) {
          handleLocalFailureFeedback(slot, 'resource', inputStarted, 'adrenaline');
          return;
        }
        const localFire = actions.notifyLoadoutFired(slot, angle, targetX, targetY);
        if (!localFire.fired) {
          handleLocalFailureFeedback(slot, 'cooldown', inputStarted, undefined, slot === 'weapon2');
          return;
        }
        shotId = localFire.shotId;
        if (slot === 'weapon2') predictedWeapon2Id = localFire.predictionId;
      }
      // Der Rueckbau nutzt zwar den Utility-Kanal, hat aber weder Config noch Cooldown.
      if (slot === 'utility' && !params?.dismantle && params?.toolRef?.kind !== 'construction') {
        // The InputSystem has already checked keyed local prediction before dispatch. This
        // synchronous callback must only gate against the authoritative state; otherwise the
        // prediction created by this very request would reject the request itself.
        const utilityCooldownUntil = params?.temporaryUtilityInstanceId
          ? actions.getLocalUtilityCooldownUntil(params.temporaryUtilityInstanceId)
          : actions.getLocalUtilityCooldownUntil();
        if (utilityCooldownUntil > actions.getSynchronizedNow()) {
          if (inputStarted) {
            const utilityShotAudio = actions.getLocalUtilityConfig()?.shotAudio;
            this.input.audioSystem.playLocalSound(utilityShotAudio?.failureKey);
          }
          return;
        }
        actions.notifyUtilityFired();
      }

      const localPosition = actions.getLocalPlayerPosition();
      if (slot === 'weapon2' && predictedWeapon2Id !== undefined && !actions.isHost()) {
        actions.beginPredictedWeapon2Use(
          predictedWeapon2Id,
          {
            angle,
            targetX,
            targetY,
            shotId,
            params,
            clientX: localPosition?.x,
            clientY: localPosition?.y,
          },
          getLocalWeapon2AdrenalineCost(),
          (result) => handleLocalLoadoutFailure('weapon2', result, inputStarted, predictedWeapon2Id),
        );
        return;
      }
      const utilityConfig = actions.getLocalUtilityConfig();
      const isUtilityPlacementAction = slot === 'utility'
        && inputSystem.isUtilityPlacementActive()
        && utilityConfig?.activation.type === 'placement_mode';
      const isUltimatePlacementAction = slot === 'ultimate'
          && inputSystem.isUltimatePlacementActive()
          && params?.tunnelAction === 'commit';
      const isConstructionAction = params?.toolRef?.kind === 'construction';
      const isToolUtilityAction = params?.toolRef?.kind === 'utility';
      const isTemporaryUtilityAction = params?.temporaryUtilityInstanceId !== undefined;
      const isDismantleAction = params?.dismantle === true;
      const awaitResult = isUtilityPlacementAction
        || isUltimatePlacementAction
        || isConstructionAction
        || isToolUtilityAction
        || isTemporaryUtilityAction
        || isDismantleAction;
      const awaitFailureResult = inputStarted
        && !params?.constructionId
        && (slot === 'weapon1' || slot === 'ultimate' || (slot === 'weapon2' && actions.isHost()));
      const loadoutPromise = actions.sendLoadoutUse(
        slot,
        angle,
        targetX,
        targetY,
        shotId,
        params,
        localPosition?.x,
        localPosition?.y,
        awaitResult || awaitFailureResult,
      );
      if (awaitFailureResult) {
        void loadoutPromise.then((result) => {
          handleLocalLoadoutFailure(slot, result, inputStarted);
        });
      }
      if (awaitResult) {
        void loadoutPromise.then((result) => {
          if (result?.ok) return;
          if (isDismantleAction) {
            actions.feedback.showPlacementError(t('ui.errors.dismantleFailed'));
            return;
          }
          if (isConstructionAction) {
            actions.feedback.showPlacementError(getConstructionFailureMessage(result?.reason));
            return;
          }
          if (isUtilityPlacementAction || isUltimatePlacementAction) {
            actions.feedback.showPlacementError(
              result?.reason === 'capacity' ? t('ui.errors.capacity') : t('ui.errors.buildFailed'),
            );
            return;
          }
          handleLocalLoadoutFailure(slot, result, inputStarted);
        }).catch(() => {
          if (isConstructionAction) {
            actions.feedback.showPlacementError(t('ui.errors.blocked'));
          } else if (isUtilityPlacementAction || isUltimatePlacementAction) {
            actions.feedback.showPlacementError(t('ui.errors.buildFailed'));
          }
        });
      }
    });
  }

  /**
   * Wendet die zentrale lokale InputPolicy an und taktet danach den vorhandenen InputSystem.
   * Die Scene liefert nur den Frame-Kontext; Capabilities werden ueber den Read-Port bezogen.
   */
  updateFrame(frame: ArenaInputFrameState): void {
    if (!frame.enabled) {
      this.input.inputSystem.setAimEnabled(false);
      this.input.inputSystem.setInputEnabled(false);
      return;
    }

    const policyInput: InputPolicyInput = {
      capabilities: this.input.actions.getPlayerCapabilities(),
      gameplayActive: frame.gameplayActive,
      countdownActive: frame.countdownActive,
      uiBlocking: frame.uiBlocking,
      diagnosticsArena: frame.diagnosticsArena,
    };
    const inputPolicy = resolveInputPolicy(policyInput);
    this.input.inputSystem.setAimEnabled(inputPolicy.aim);
    this.input.inputSystem.setInputEnabled(inputPolicy.movement, inputPolicy.worldInteraction);
    this.input.inputSystem.update();
  }

  /** Liefert die lokale Aim-/Systemcursor-Freigabe fuer die Presentation-Schicht. */
  getAimPresentationState(
    worldInteractive: boolean,
    spectator: boolean,
    optionsOpen: boolean,
  ): ArenaAimPresentationState {
    if (this.destroyed) return { aimVisible: false, cursorVisible: false };
    const cursorVisible = worldInteractive && !optionsOpen && !spectator;
    const actions = this.input.actions;
    const aimVisible = cursorVisible
      && actions.isLocalPlayerAlive()
      && !actions.isLocalPlayerBurrowed()
      && !this.input.inputSystem.isUtilityChargePreviewActive()
      && !this.input.inputSystem.isUtilityPlacementActive()
      && !this.input.inputSystem.isConstructionPlacementActive()
      && !this.input.inputSystem.isDismantlePlacementActive()
      && !this.input.inputSystem.isPersistentRewardPlacementActive()
      && !this.input.inputSystem.isRepositionActive()
      && !this.input.inputSystem.isUltimatePlacementActive();
    return { aimVisible, cursorVisible };
  }

  getLocalPlacementPreview(): UtilityPlacementPreviewState | undefined {
    if (this.destroyed) return undefined;
    const position = this.input.actions.getLocalPlayerPosition();
    const config = this.input.actions.getLocalUtilityConfig();
    if (!position || !config || !this.input.inputSystem.isUtilityPlacementActive()) return undefined;
    if (config.activation.type !== 'placement_mode') return undefined;
    const pointer = this.input.actions.getPointerWorldPoint();
    return this.input.actions.placement.getPlacementPreview(
      config as PlaceableUtilityConfig,
      position.x,
      position.y,
      pointer.x,
      pointer.y,
    );
  }

  getLocalUltimatePlacementPreview(): UtilityPlacementPreviewState | undefined {
    if (this.destroyed) return undefined;
    const position = this.input.actions.getLocalPlayerPosition();
    const config = this.input.actions.getLocalUltimateConfig();
    if (!position || !config || !this.input.inputSystem.isUltimatePlacementActive()) return undefined;
    if (config.type !== 'tunnel') return undefined;
    const pointer = this.input.actions.getPointerWorldPoint();
    return this.input.actions.placement.getTunnelPlacementPreview(
      config as TunnelUltimateConfig,
      position.x,
      position.y,
      pointer.x,
      pointer.y,
      this.input.inputSystem.getUltimatePlacementAnchor(),
    );
  }

  getSpectatorCameraInput(): ArenaSpectatorCameraInput {
    return {
      left: this.isSpectatorCameraLeftDown(),
      right: this.isSpectatorCameraRightDown(),
      up: this.isSpectatorCameraUpDown(),
      down: this.isSpectatorCameraDownDown(),
    };
  }

  isSpectatorCameraLeftDown(): boolean {
    return !this.destroyed && this.spectatorCameraLeftKey?.isDown === true;
  }

  isSpectatorCameraRightDown(): boolean {
    return !this.destroyed && this.spectatorCameraRightKey?.isDown === true;
  }

  isSpectatorCameraUpDown(): boolean {
    return !this.destroyed && this.spectatorCameraUpKey?.isDown === true;
  }

  isSpectatorCameraDownDown(): boolean {
    return !this.destroyed && this.spectatorCameraDownKey?.isDown === true;
  }

  isArenaPanelHeld(): boolean {
    return !this.destroyed && this.arenaPanelTabKey?.isDown === true;
  }

  isCoopDefenseDebugDamageJustDown(): boolean {
    return !this.destroyed
      && this.coopDefenseDebugDamageKey !== null
      && Phaser.Input.Keyboard.JustDown(this.coopDefenseDebugDamageKey);
  }

  /** Idempotenter Owner-Teardown fuer eigene Keyboard-Keys und DOM-nahe Keyboard-Listener. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const keyboard = this.input.scene.input.keyboard;
    if (keyboard) {
      if (this.escapeHotkeyHandler) keyboard.off('keydown-ESC', this.escapeHotkeyHandler);
      if (this.optionsHotkeyHandler) keyboard.off('keydown-O', this.optionsHotkeyHandler);
      if (this.coopDefenseXpDebugHotkeyHandler) keyboard.off('keydown-L', this.coopDefenseXpDebugHotkeyHandler);
      if (this.weaponBalanceLabHotkeyHandler) keyboard.off('keydown-F8', this.weaponBalanceLabHotkeyHandler);
      if (this.netDebugHotkeyHandler) keyboard.off('keydown-P', this.netDebugHotkeyHandler);
      if (this.performanceHotkeyHandler) keyboard.off('keydown-T', this.performanceHotkeyHandler);
      if (this.timeOfDayHotkeyHandler) keyboard.off('keydown-M', this.timeOfDayHotkeyHandler);

      for (const key of [
        this.spectatorCameraLeftKey,
        this.spectatorCameraRightKey,
        this.spectatorCameraUpKey,
        this.spectatorCameraDownKey,
        this.arenaPanelTabKey,
        this.coopDefenseDebugDamageKey,
      ]) {
        if (key) keyboard.removeKey(key, true, true);
      }
    }

    this.escapeHotkeyHandler = null;
    this.optionsHotkeyHandler = null;
    this.coopDefenseXpDebugHotkeyHandler = null;
    this.weaponBalanceLabHotkeyHandler = null;
    this.netDebugHotkeyHandler = null;
    this.performanceHotkeyHandler = null;
    this.timeOfDayHotkeyHandler = null;
    this.spectatorCameraLeftKey = null;
    this.spectatorCameraRightKey = null;
    this.spectatorCameraUpKey = null;
    this.spectatorCameraDownKey = null;
    this.arenaPanelTabKey = null;
    this.coopDefenseDebugDamageKey = null;
  }
}
