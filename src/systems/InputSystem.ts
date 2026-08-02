import * as Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { BurrowPhase, ConstructionId, LoadoutToolRef, PlacementPreviewNetState, PlayerInput, LoadoutSlot, LoadoutUseParams, UltimateChargePreviewState, UtilityChargePreviewState, UtilityPlacementPreviewState, UtilityTargetingPreviewState } from '../types';
import {
  DASH_T1_S, DASH_T2_S,
  clampPointToArena,
} from '../config';
import { COOP_DEFENSE_CONSTRUCTION_CAPACITY } from '../config/coopDefenseConstructions';
import { quantizeAngle } from '../utils/angle';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { InspectorToolRadialMenu, type InspectorRadialSelection } from '../ui/InspectorToolRadialMenu';
import type { CameraFeedbackController } from '../effects/camera/CameraFeedbackController';
import { chargeRumble } from '../effects/camera/cameraFeedbackPresets';
import { getUnshakenPointerWorldPoint } from '../graphics/cameraBaseScroll';

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
type TargetedActivation = TargetedClickUtilityActivationConfig;
type PlacementActivation = PlacementModeUtilityActivationConfig;

type DebugHotkeyType = 'flowfield_bases' | 'flowfield_players';

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
  private constructionKeys: Phaser.Input.Keyboard.Key[] = [];

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
  private predictedUtilityCooldownUntil = 0;
  public onUtilityPressedDuringCooldown: (() => void) | null = null;
  public onUltimatePressedWithoutRage: (() => void) | null = null;
  private utilityHoldActive = false;
  private utilityChargeEligibleAt: number | null = null;
  private utilityChargeStartedAt: number | null = null;
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
  private suppressWeapon1UntilLeftRelease = false;
  private selectedConstructionId: ConstructionId = 'rocket_turret';
  private getAvailableConstructionIds: (() => readonly ConstructionId[]) | null = null;
  private getConstructionPlacementPreviewProvider: ((
    constructionId: ConstructionId,
  ) => UtilityPlacementPreviewState | undefined) | null = null;
  private constructionWheelHandler: ((event: WheelEvent) => void) | null = null;
  private inspectorGetTools: (() => readonly LoadoutToolRef[]) | null = null;
  private inspectorGetSelectedTool: (() => LoadoutToolRef | null) | null = null;
  private inspectorSetSelectedTool: ((tool: LoadoutToolRef) => void) | null = null;
  private inspectorModeProvider: (() => boolean) | null = null;
  private inspectorUtilityOverrideProvider: (() => boolean) | null = null;
  private inspectorRadialMenu: InspectorToolRadialMenu | null = null;
  private inspectorConstructionPlacementActive = false;
  /** Rueckbau ist eine reine Client-Auswahl und wandert nie in das persistierte Loadout. */
  private inspectorDismantleSelected = false;
  private inspectorDismantlePlacementActive = false;
  /** Liefert Verbrauch und persoenliches Maximum als Paar, damit beide nie auseinanderlaufen. */
  private inspectorGetCapacity: (() => { used: number; max: number }) | null = null;
  private getDismantlePreviewProvider: (() => UtilityPlacementPreviewState | undefined) | null = null;

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
    this.constructionKeys = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
    ].map((keyCode) => kb.addKey(keyCode, false));

    // Kontextmenü deaktivieren damit Rechtsklick im Spiel registriert wird
    this.scene.input.mouse?.disableContextMenu();
    this.inspectorRadialMenu = new InspectorToolRadialMenu(this.scene);
    this.constructionWheelHandler = (event: WheelEvent) => {
      const available = this.getAvailableConstructionIds?.() ?? [];
      if (!this.inputEnabled || this.isInspectorMode() || available.length < 2) return;
      event.preventDefault();
      const current = Math.max(0, available.indexOf(this.getSelectedConstructionId()));
      const direction = event.deltaY >= 0 ? 1 : -1;
      this.selectedConstructionId = available[
        (current + direction + available.length) % available.length
      ];
    };
    this.scene.game.canvas.addEventListener('wheel', this.constructionWheelHandler, { passive: false });
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.constructionWheelHandler) {
        this.scene.game.canvas.removeEventListener('wheel', this.constructionWheelHandler);
        this.constructionWheelHandler = null;
      }
      this.inspectorRadialMenu?.destroy();
      this.inspectorRadialMenu = null;
    });
  }

  setupInspectorToolProvider(
    getTools: () => readonly LoadoutToolRef[],
    getSelected: () => LoadoutToolRef | null,
    setSelected: (tool: LoadoutToolRef) => void,
    isInspectorMode?: () => boolean,
    isUtilityOverrideActive?: () => boolean,
    getCapacity?: () => { used: number; max: number },
    getDismantlePreview?: () => UtilityPlacementPreviewState | undefined,
  ): void {
    this.inspectorGetTools = getTools;
    this.inspectorGetSelectedTool = getSelected;
    this.inspectorSetSelectedTool = setSelected;
    this.inspectorModeProvider = isInspectorMode ?? null;
    this.inspectorUtilityOverrideProvider = isUtilityOverrideActive ?? null;
    this.inspectorGetCapacity = getCapacity ?? null;
    this.getDismantlePreviewProvider = getDismantlePreview ?? null;
  }

  setupConstructionProviders(
    getAvailable: () => readonly ConstructionId[],
    getPreview: (constructionId: ConstructionId) => UtilityPlacementPreviewState | undefined,
  ): void {
    this.getAvailableConstructionIds = getAvailable;
    this.getConstructionPlacementPreviewProvider = getPreview;
  }

  getSelectedConstructionId(): ConstructionId {
    const available = this.getAvailableConstructionIds?.() ?? [];
    if (available.length > 0 && !available.includes(this.selectedConstructionId)) {
      this.selectedConstructionId = available[0];
    }
    return this.selectedConstructionId;
  }

  private getInspectorTools(): readonly LoadoutToolRef[] {
    return this.inspectorGetTools?.() ?? [];
  }

  private getSelectedInspectorTool(): LoadoutToolRef | null {
    return this.inspectorDismantleSelected ? null : (this.inspectorGetSelectedTool?.() ?? null);
  }

  getSelectedInspectorToolForHud(): LoadoutToolRef | null {
    return this.getSelectedInspectorTool();
  }

  /** Ist aktuell der Rueckbau statt eines Werkzeugs im Rad gewaehlt? */
  isInspectorDismantleSelected(): boolean {
    return this.isInspectorMode() && this.inspectorDismantleSelected;
  }

  private getSelectedInspectorRadialSelection(): InspectorRadialSelection | null {
    if (this.inspectorDismantleSelected) return { kind: 'dismantle' };
    const tool = this.inspectorGetSelectedTool?.() ?? null;
    return tool ? { kind: 'tool', tool } : null;
  }

  private applyInspectorRadialSelection(selection: InspectorRadialSelection): void {
    if (selection.kind === 'dismantle') {
      this.inspectorDismantleSelected = true;
      return;
    }
    this.inspectorDismantleSelected = false;
    this.inspectorSetSelectedTool?.(selection.tool);
  }

  private getInspectorUtilityParams(): LoadoutUseParams | undefined {
    const tool = this.getSelectedInspectorTool();
    // A special pickup temporarily replaces E; let it use the normal utility
    // slot and restore the Inspector selection afterwards.
    const activeConfig = this.getLocalUtilityConfig?.();
    const resolvedToolConfig = tool?.kind === 'utility'
      ? getUtilityConfigForMode(tool.id, this.bridge.getGameMode())
      : undefined;
    return this.isInspectorMode() && tool?.kind === 'utility'
      // Coop commits the concrete `*_COOP` variant while the Inspector keeps
      // the user-facing base ID. Treat both IDs as the same tool, but keep
      // temporary utility overrides (which resolve to a different config)
      // on the ordinary utility path.
      && (!activeConfig || activeConfig.id === resolvedToolConfig?.id)
      ? { toolRef: tool }
      : undefined;
  }

  private isInspectorMode(): boolean {
    return this.inspectorModeProvider?.() ?? (this.inspectorGetTools !== null && this.getInspectorTools().length > 0);
  }

  private isInspectorUtilityOverrideActive(): boolean {
    return this.isInspectorMode() && (this.inspectorUtilityOverrideProvider?.() ?? false);
  }

  isInspectorConstructionPlacementActive(): boolean {
    return this.isInspectorMode()
      && this.inspectorConstructionPlacementActive
      && !this.isInspectorUtilityOverrideActive();
  }

  isInspectorDismantlePlacementActive(): boolean {
    return this.isInspectorMode()
      && this.inspectorDismantlePlacementActive
      && !this.isInspectorUtilityOverrideActive();
  }

  getConstructionPlacementPreviewState(): UtilityPlacementPreviewState | undefined {
    if (this.isInspectorDismantlePlacementActive()) return this.getDismantlePreviewProvider?.();
    if (this.isInspectorMode() && !this.isInspectorConstructionPlacementActive()) return undefined;
    const inspectorTool = this.getSelectedInspectorTool();
    if (inspectorTool?.kind === 'construction') {
      return this.getConstructionPlacementPreviewProvider?.(inspectorTool.id);
    }
    const available = this.getAvailableConstructionIds?.() ?? [];
    if (available.length === 0) return undefined;
    return this.getConstructionPlacementPreviewProvider?.(this.getSelectedConstructionId());
  }

  private updateConstructionHotkeys(): void {
    if (this.isInspectorMode()) return;
    const available = this.getAvailableConstructionIds?.() ?? [];
    if (available.length === 0) return;
    for (let index = 0; index < this.constructionKeys.length; index += 1) {
      if (Phaser.Input.Keyboard.JustDown(this.constructionKeys[index]) && available[index]) {
        this.selectedConstructionId = available[index];
      }
    }
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

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.predictedUtilityCooldownUntil = 0;
      this.cancelUtilityInteraction();
      this.cancelUltimateCharge();
      this.cancelUltimatePlacement();
      this.ultimateTargetingActive = false;
      this.scopeStartedAt = null;
      this.scopeProgress = 0;
      this.scopeChargeProgress = 0;
      this.tunnelPlacementAnchor = null;
      this.placementPreviewState = null;
      this.inspectorConstructionPlacementActive = false;
      this.inspectorDismantlePlacementActive = false;
      this.inspectorRadialMenu?.close();
      this.suppressWeapon1UntilLeftRelease = false;
      this.prevLeftPointerDown = false;
      this.prevRightPointerDown = false;
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
    return this.utilityHoldActive;
  }

  isUtilityHudDisplayActive(): boolean {
    if (!this.inputEnabled) return false;
    return !!this.keyE?.isDown || this.utilityHoldActive || this.utilityTargetingActive || this.utilityPlacementActive;
  }

  isUtilityChargePreviewActive(): boolean {
    return this.utilityHoldActive;
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
    if (!this.utilityHoldActive) return undefined;
    const sprite = this.getLocalSprite();
    const cfg = this.getChargeableUtilityConfig();
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
    // Die Scene schaltet den lokalen Input zusaetzlich ab; dieser Rollencheck verhindert, dass
    // bereits gedrueckte Tasten oder Debug-/Placement-Hotkeys beim Spectator noch Aktionen
    // erzeugen, bevor der naechste Snapshot die Entity entfernt.
    if (this.bridge.getGamePhase() === 'ARENA' && !this.bridge.canPlayerAct(this.bridge.getLocalPlayerId())) {
      this.bridge.sendLocalInput({
        dx: 0,
        dy: 0,
        aim: quantizeAngle(this.currentAimAngle),
        dashHeld: false,
        placementPreview: null,
      });
      return;
    }

    // Process debug hotkeys first (regardless of input enabled state)
    this.updateDebugHotkeys();
    this.updateConstructionHotkeys();

    // ── 1. Blickrichtung (auch bei gesperrter Eingabe) ─────────────────────
    // Drehen bleibt während des Arena-Countdowns erlaubt und wird über den
    // Input-Kanal repliziert; Bewegung und Aktionen bleiben gesperrt.
    const aimTarget = this.updateAimFromPointer();
    const selectedInspectorTool = this.getSelectedInspectorTool();
    const constructionPreview = this.isInspectorMode()
      && ((this.isInspectorConstructionPlacementActive() && selectedInspectorTool?.kind === 'construction')
        || this.isInspectorDismantlePlacementActive())
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
      placementPreview: this.placementPreviewState,
    };
    this.bridge.sendLocalInput(input);

    if (!this.inputEnabled) return;

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

    const leftPointerDown = pointer.leftButtonDown();
    const rightPointerDown = pointer.rightButtonDown();
    const leftInputStarted = leftPointerDown && !this.prevLeftPointerDown;
    const rightInputStarted = rightPointerDown && !this.prevRightPointerDown;
    this.prevLeftPointerDown = leftPointerDown;
    this.prevRightPointerDown = rightPointerDown;
    if (!leftPointerDown) {
      this.suppressWeapon1UntilLeftRelease = false;
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

    // Inspector: R haelt das Auswahlrad offen, RMB gehoert der Waffe 2. Ein laufender
    // Bau- oder Rueckbaumodus wird von beiden Eingaben zuerst abgebrochen.
    if (this.isInspectorMode()) {
      const inspectorModeActive = this.utilityPlacementActive
        || this.utilityTargetingActive
        || this.utilityHoldActive
        || this.inspectorConstructionPlacementActive
        || this.inspectorDismantlePlacementActive;
      if (rightInputStarted && inspectorModeActive) {
        this.cancelUtilityInteraction();
        this.prevRightPointerDown = rightPointerDown;
        this.suppressWeapon1UntilLeftRelease = false;
        return;
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyR) && !this.inspectorRadialMenu?.isOpen) {
        if (inspectorModeActive) this.cancelUtilityInteraction();
        const capacity = this.inspectorGetCapacity?.();
        this.inspectorRadialMenu?.open(
          pointer.x,
          pointer.y,
          this.getInspectorTools(),
          this.getSelectedInspectorRadialSelection(),
          capacity?.used ?? 0,
          capacity?.max ?? COOP_DEFENSE_CONSTRUCTION_CAPACITY,
        );
      }
      if (this.inspectorRadialMenu?.isOpen) {
        if (this.keyR.isDown) {
          this.inspectorRadialMenu.update(pointer.x, pointer.y);
        } else {
          const selected = this.inspectorRadialMenu.close(pointer.x, pointer.y);
          if (selected) this.applyInspectorRadialSelection(selected);
        }
        this.prevRightPointerDown = rightPointerDown;
        return;
      }
    }

    if (this.isInspectorMode() && this.inspectorDismantlePlacementActive) {
      const preview = constructionPreview;
      this.syncPlacementPreviewState(preview);
      if (!preview) {
        this.cancelInspectorConstructionPlacement();
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
        this.cancelInspectorConstructionPlacement();
        return;
      }
      return;
    }

    if (this.isInspectorMode() && this.inspectorConstructionPlacementActive) {
      const preview = constructionPreview;
      this.syncPlacementPreviewState(preview);
      if (!preview) {
        this.cancelInspectorConstructionPlacement();
        return;
      }
      if (leftInputStarted || Phaser.Input.Keyboard.JustDown(this.keyE)) {
        if (leftInputStarted) this.consumeLeftClickForModeConfirmation();
        if (preview.isValid) {
          const tool = this.getSelectedInspectorTool();
          if (tool?.kind === 'construction') {
            this.onLoadoutUse('utility', preview.angle, preview.targetX, preview.targetY, {
              inputStarted: true,
              constructionId: tool.id,
              toolRef: tool,
            });
          }
        }
        this.cancelInspectorConstructionPlacement();
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

        if (pointer.rightButtonDown() || Phaser.Input.Keyboard.JustDown(this.keyE)) {
          this.cancelUtilityTargeting();
          return;
        }

        if (leftInputStarted) {
          this.consumeLeftClickForModeConfirmation();
          this.predictedUtilityCooldownUntil = now + targetedCfg.cooldown;
          this.onLoadoutUse('utility', targetAngle, target.x, target.y, this.getInspectorUtilityParams());
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

        if (pointer.rightButtonDown() || Phaser.Input.Keyboard.JustDown(this.keyQ)) {
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

      if (pointer.rightButtonDown()) {
        this.cancelUtilityPlacement();
        return;
      }

      if (Phaser.Input.Keyboard.JustDown(this.keyE) || leftInputStarted) {
        if (leftInputStarted) {
          this.consumeLeftClickForModeConfirmation();
        }
        if (preview.isValid) {
          this.onLoadoutUse('utility', preview.angle, preview.targetX, preview.targetY, this.getInspectorUtilityParams());
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

      if (pointer.rightButtonDown() || Phaser.Input.Keyboard.JustDown(this.keyQ)) {
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
      // RMB → weapon2: Scope-Waffen (z.B. AWP) nutzen fire-on-release Mechanik,
      // andere Waffen feuern weiterhin per Dauerfeuer.
      // Auch beim Inspector gehoert RMB der Waffe 2 (Adrenalinfaehigkeit); ein laufender
      // Bau- oder Rueckbaumodus faengt den Rechtsklick bereits weiter oben ab.
      const scopeCfg = this.getWeapon2Config?.()?.scopeConfig;
      if (scopeCfg) {
        if (rightPointerDown) {
          // Scope-In: Fortschritt berechnen, nur holdSpeedFactor aktiv halten (kein Schuss)
          if (rightInputStarted) {
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
        this.onLoadoutUse('weapon2', angle, clampedTarget.x, clampedTarget.y, { inputStarted: rightInputStarted });
      }
    }

    // Scope abbrechen wenn Waffen geblockt (z.B. Burrow, Ultimate)
    if (weaponsBlocked && this.scopeStartedAt !== null) {
      this.scopeStartedAt = null;
      this.scopeProgress = 0;
      this.scopeChargeProgress = 0;
    }

    if (!utilityBlocked && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.isInspectorDismantleSelected() && !this.isInspectorUtilityOverrideActive()) {
        this.cancelUtilityInteraction();
        this.inspectorDismantlePlacementActive = true;
        this.syncPlacementPreviewState(this.getConstructionPlacementPreviewState());
        return;
      }
      const inspectorTool = this.getSelectedInspectorTool();
      if (this.isInspectorMode() && !inspectorTool) return;
      if (this.isInspectorMode()
        && inspectorTool?.kind === 'construction'
        && !this.isInspectorUtilityOverrideActive()) {
        this.cancelUtilityInteraction();
        this.inspectorConstructionPlacementActive = true;
        this.bridge.sendDecoyStealthBreakRequest();
        this.syncPlacementPreviewState(this.getConstructionPlacementPreviewState());
        return;
      }
      if (this.getEffectiveUtilityCooldownUntil() > now) {
        this.onUtilityPressedDuringCooldown?.();
      }
      // Translocator-Recall: Puck aktiv → sofort beamen (kein Aufladen)
      if (this.isTranslocatorRecallReady?.()) {
        this.onLoadoutUse('utility', angle, clampedTarget.x, clampedTarget.y, this.getInspectorUtilityParams());
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
        this.onLoadoutUse('utility', angle, clampedTarget.x, clampedTarget.y, this.getInspectorUtilityParams());
      }
    }

    if (this.utilityHoldActive && this.utilityChargeStartedAt === null && this.keyE.isDown) {
      this.maybeStartHeldUtilityCharge(now);
    }

    // Screenshake während Gate-Charge (BFG Auflade-Feedback)
    if (this.utilityHoldActive && this.utilityChargeStartedAt !== null) {
      const chargeCfg = this.getChargeableUtilityConfig();
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

  private getChargeableUtilityConfig(): (UtilityConfig & { activation: ChargeableActivation }) | undefined {
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

    const cooldownUntil = this.getEffectiveUtilityCooldownUntil();
    this.utilityHoldActive = true;
    this.utilityChargeEligibleAt = now < cooldownUntil ? cooldownUntil : now;
    this.utilityChargeStartedAt = null;
    this.maybeStartHeldUtilityCharge(now);
    this.bridge.sendDecoyStealthBreakRequest();
    return true;
  }

  private maybeStartHeldUtilityCharge(now: number): void {
    if (!this.utilityHoldActive || this.utilityChargeStartedAt !== null) return;

    const eligibleAt = this.utilityChargeEligibleAt ?? now;
    if (now < eligibleAt) return;

    this.utilityChargeStartedAt = eligibleAt;
    this.utilityChargeEligibleAt = null;

    // BFG charge sound (charged_gate utilities)
    const utCfg = this.getChargeableUtilityConfig();
    if (utCfg?.activation.type === 'charged_gate') {
      this.chargeLoopHandle = this.audioSystem?.startLoop('sfx_bfg_charge') ?? null;
    }
  }

  private releaseChargedUtility(angle: number, targetX: number, targetY: number, now: number): void {
    const cfg = this.getChargeableUtilityConfig();
    const startedAt = this.utilityChargeStartedAt;
    this.cancelUtilityCharge();
    if (!cfg || startedAt === null) return;

    const chargeFraction = this.computeUtilityChargeFraction(startedAt, cfg.activation, now);

    // Gate-Charge: nur feuern wenn voll aufgeladen (fraction >= 1.0)
    if (cfg.activation.type === 'charged_gate' && chargeFraction < 1.0) return;

    this.predictedUtilityCooldownUntil = now + cfg.cooldown;

    this.onLoadoutUse?.('utility', angle, targetX, targetY, {
      ...this.getInspectorUtilityParams(),
      utilityChargeFraction: chargeFraction,
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
    // Wenn der Host den Cooldown aktiv zurückgesetzt hat (z.B. Utility-Override),
    // darf die lokale Prediction nicht mehr blockieren.
    if (authoritative < this.predictedUtilityCooldownUntil && Date.now() >= authoritative) {
      this.predictedUtilityCooldownUntil = 0;
    }
    const effective = Math.max(authoritative, this.predictedUtilityCooldownUntil);
    if (Date.now() >= effective) {
      this.predictedUtilityCooldownUntil = 0;
      return authoritative;
    }
    return effective;
  }

  private isUtilityBlocked(now: number): boolean {
    if (!this.utilityHoldActive || this.utilityChargeStartedAt !== null) return false;
    const eligibleAt = this.utilityChargeEligibleAt ?? this.getEffectiveUtilityCooldownUntil();
    return now < eligibleAt;
  }

  private consumeLeftClickForModeConfirmation(): void {
    this.suppressWeapon1UntilLeftRelease = true;
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
    this.cancelInspectorConstructionPlacement();
  }

  private cancelInspectorConstructionPlacement(): void {
    this.inspectorConstructionPlacementActive = false;
    this.inspectorDismantlePlacementActive = false;
    this.placementPreviewState = null;
  }

  private cancelUtilityCharge(): void {
    this.utilityHoldActive = false;
    this.utilityChargeEligibleAt = null;
    this.utilityChargeStartedAt = null;
    if (this.chargeLoopHandle) {
      this.audioSystem?.stopLoop(this.chargeLoopHandle);
      this.chargeLoopHandle = null;
    }
  }

  private syncPlacementPreviewState(preview: UtilityPlacementPreviewState | undefined): void {
    if ((!this.utilityPlacementActive && !this.inspectorConstructionPlacementActive) || !preview) {
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
