import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { BurrowPhase, PlacementPreviewNetState, PlayerInput, LoadoutSlot, LoadoutUseParams, UltimateChargePreviewState, UtilityChargePreviewState, UtilityPlacementPreviewState, UtilityTargetingPreviewState } from '../types';
import {
  DASH_T1_S, DASH_T2_S,
  clampPointToArena,
} from '../config';
import { quantizeAngle } from '../utils/angle';

const DASH_CYCLE_MS = (DASH_T1_S + DASH_T2_S) * 1000; // 600ms Gesamtzyklusdauer
import type {
  ChargedThrowUtilityActivationConfig,
  ChargedGateUtilityActivationConfig,
  GaussUltimateConfig,
  PlacementModeUtilityActivationConfig,
  TargetedClickUtilityActivationConfig,
  UltimateConfig,
  UtilityConfig,
} from '../loadout/LoadoutConfig';

/** Gemeinsamer Nenner für alle aufladbaren Utility-Aktivierungen. */
type ChargeableActivation = ChargedThrowUtilityActivationConfig | ChargedGateUtilityActivationConfig;
type TargetedActivation = TargetedClickUtilityActivationConfig;
type PlacementActivation = PlacementModeUtilityActivationConfig;

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

  // Lokaler Dash-Cooldown (nur für HUD-Visualisierung, kein Gameplay-Impact)
  private dashCooldownUntil = 0;  // ms-Timestamp

  // Loadout-Callback (gesetzt von ArenaScene)
  private onLoadoutUse: ((slot: LoadoutSlot, angle: number, targetX: number, targetY: number, params?: LoadoutUseParams) => void) | null = null;
  private getLocalUtilityConfig: (() => UtilityConfig | undefined) | null = null;
  private getLocalUtilityCooldownUntil: (() => number) | null = null;
  private getLocalUltimateConfig: (() => UltimateConfig | undefined) | null = null;
  private getLocalRage: (() => number) | null = null;
  private predictedUtilityCooldownUntil = 0;
  private utilityHoldActive = false;
  private utilityChargeEligibleAt: number | null = null;
  private utilityChargeStartedAt: number | null = null;
  private utilityTargetingActive = false;
  private utilityPlacementActive = false;
  private ultimateHoldActive = false;
  private ultimateChargeStartedAt: number | null = null;
  private getUtilityPlacementPreviewProvider: (() => UtilityPlacementPreviewState | undefined) | null = null;
  private placementPreviewState: PlacementPreviewNetState | null = null;
  private prevLeftPointerDown = false;
  private prevRightPointerDown = false;

  // Aktueller Aim-Winkel (Radiant, für Rotation-Sync)
  private currentAimAngle = 0;

  // Lokaler Zustand vom Host empfangen
  private localIsStunned  = false;
  private localIsBurrowed = false;
  private localBurrowPhase: BurrowPhase = 'idle';
  private inputEnabled    = true;

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

    // Kontextmenü deaktivieren damit Rechtsklick im Spiel registriert wird
    this.scene.input.mouse?.disableContextMenu();
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
    }
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.predictedUtilityCooldownUntil = 0;
      this.cancelUtilityInteraction();
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

  isUtilityChargePreviewActive(): boolean {
    return this.utilityHoldActive;
  }

  isUtilityTargetingActive(): boolean {
    return this.utilityTargetingActive;
  }

  isUtilityPlacementActive(): boolean {
    return this.utilityPlacementActive;
  }

  cancelLocalUltimateChargePreview(): void {
    this.cancelUltimateCharge();
  }

  getUtilityPlacementPreviewState(): UtilityPlacementPreviewState | undefined {
    if (!this.utilityPlacementActive) return undefined;
    return this.getUtilityPlacementPreviewProvider?.();
  }

  setupUtilityPlacementPreviewProvider(cb: () => UtilityPlacementPreviewState | undefined): void {
    this.getUtilityPlacementPreviewProvider = cb;
  }

  getUltimateChargePreviewState(): UltimateChargePreviewState | undefined {
    const sprite = this.getLocalSprite();
    const cfg = this.getGaussUltimateConfig();
    if (!this.ultimateHoldActive || !sprite || !cfg) return undefined;

    const pointer = this.scene.input.activePointer;
    const clampedTarget = clampPointToArena(pointer.x, pointer.y);
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
    const sprite = this.getLocalSprite();
    const cfg = this.getChargeableUtilityConfig();
    if (!this.utilityHoldActive || !sprite || !cfg) return undefined;

    const now = Date.now();
    const startedAt = this.utilityChargeStartedAt;
    const isGate = cfg.activation.type === 'charged_gate';

    const pointer = this.scene.input.activePointer;
    const clampedTarget = clampPointToArena(pointer.x, pointer.y);
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
    const sprite = this.getLocalSprite();
    const cfg = this.getTargetedUtilityConfig();
    if (!this.utilityTargetingActive || !sprite || !cfg) return undefined;

    const pointer = this.scene.input.activePointer;
    const target = clampPointToArena(pointer.x, pointer.y);
    return {
      angle: Phaser.Math.Angle.Between(sprite.x, sprite.y, target.x, target.y),
      targetX: target.x,
      targetY: target.y,
    };
  }

  /** Jeden Frame: WASD + Dash + Burrow + Loadout lesen, RPCs senden. */
  update(): void {
    // ── 1. Bewegungs-Input (immer gesendet) ────────────────────────────────
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
      placementPreview: this.placementPreviewState,
    };
    this.bridge.sendLocalInput(input);

    if (!this.inputEnabled) return;

    // ── 2. Stun: keine weiteren Aktionen ───────────────────────────────────
    if (this.localIsStunned) {
      this.cancelUtilityInteraction();
      this.cancelUltimateCharge();
      return;
    }

    // ── 3. Dash (Flanke, einmalig auslösen) ────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      const now = Date.now();
      if (now >= this.dashCooldownUntil) {
        this.bridge.sendDash(dx, dy);
        this.dashCooldownUntil = now + DASH_CYCLE_MS;
      }
    }

    // ── 4. Burrow-Toggle (Flanke) ───────────────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.keyShift)) {
      if (this.localBurrowPhase === 'idle') {
        this.bridge.sendBurrowRequest(true);
      } else if (this.localBurrowPhase === 'underground' || this.localBurrowPhase === 'trapped') {
        this.bridge.sendBurrowRequest(false);
      }
    }

    // ── 5. Loadout-Aktionen ────────────────────────────────────────────────
    if (!this.onLoadoutUse) return;

    const pointer = this.scene.input.activePointer;
    const sprite  = this.getLocalSprite();
    const now     = Date.now();

    if (!sprite) {
      this.cancelUtilityInteraction();
      this.placementPreviewState = null;
      return;
    }

    const px    = pointer.x;
    const py    = pointer.y;
    const leftPointerDown = pointer.leftButtonDown();
    const rightPointerDown = pointer.rightButtonDown();
    const leftInputStarted = leftPointerDown && !this.prevLeftPointerDown;
    const rightInputStarted = rightPointerDown && !this.prevRightPointerDown;
    this.prevLeftPointerDown = leftPointerDown;
    this.prevRightPointerDown = rightPointerDown;
    const clampedTarget = clampPointToArena(px, py);
    const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, clampedTarget.x, clampedTarget.y);
    this.currentAimAngle = angle;
    const ultimateCharging = this.ultimateHoldActive;
    const weaponsBlocked = this.localBurrowPhase !== 'idle' || ultimateCharging || this.utilityPlacementActive;
    const utilityBlocked = this.localBurrowPhase === 'windup'
      || this.localBurrowPhase === 'underground'
      || this.localBurrowPhase === 'trapped'
      || ultimateCharging;
    const ultimateCfg = this.getLocalUltimateConfig?.();

    if (this.utilityTargetingActive) {
      const targetedCfg = this.getTargetedUtilityConfig();
      if (!targetedCfg) {
        this.cancelUtilityTargeting();
      } else {
        const target = clampPointToArena(px, py);
        const targetAngle = Phaser.Math.Angle.Between(sprite.x, sprite.y, target.x, target.y);
        this.currentAimAngle = targetAngle;

        if (pointer.rightButtonDown() || Phaser.Input.Keyboard.JustDown(this.keyE)) {
          this.cancelUtilityTargeting();
          return;
        }

        if (pointer.leftButtonDown()) {
          this.predictedUtilityCooldownUntil = now + targetedCfg.cooldown;
          this.onLoadoutUse('utility', targetAngle, target.x, target.y);
          this.cancelUtilityTargeting();
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

      if (Phaser.Input.Keyboard.JustDown(this.keyE) || pointer.leftButtonDown()) {
        if (preview.isValid) {
          this.onLoadoutUse('utility', preview.angle, preview.targetX, preview.targetY);
        }
        this.cancelUtilityPlacement();
        return;
      }

      return;
    }

    // LMB gedrückt halten → weapon1 (Dauerfeuer, kein Client-Throttle)
    // Korrekte Host-Authority: RPCs jeden Frame senden, Host entscheidet über Cooldown.
    // Client-seitiger Cooldown würde bei variabler RPC-Latenz zu Schuss-Lücken führen.
    if (!weaponsBlocked && leftPointerDown) {
      this.onLoadoutUse('weapon1', angle, clampedTarget.x, clampedTarget.y, { inputStarted: leftInputStarted });
    } else if (!weaponsBlocked && rightPointerDown) {
      // RMB gedrückt halten → weapon2 (Dauerfeuer, kein Client-Throttle)
      this.onLoadoutUse('weapon2', angle, clampedTarget.x, clampedTarget.y, { inputStarted: rightInputStarted });
    }

    if (!utilityBlocked && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      // Translocator-Recall: Puck aktiv → sofort beamen (kein Aufladen)
      if (this.isTranslocatorRecallReady?.()) {
        this.onLoadoutUse('utility', angle, clampedTarget.x, clampedTarget.y);
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
        this.onLoadoutUse('utility', angle, clampedTarget.x, clampedTarget.y);
      }
    }

    if (this.utilityHoldActive && this.utilityChargeStartedAt === null && this.keyE.isDown) {
      this.maybeStartHeldUtilityCharge(now);
    }

    // Screenshake während Gate-Charge (BFG Auflade-Feedback)
    if (this.utilityHoldActive && this.utilityChargeStartedAt !== null) {
      const chargeCfg = this.getChargeableUtilityConfig();
      if (chargeCfg?.activation.type === 'charged_gate') {
        this.scene.cameras.main.shake(50, 0.003);
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

    this.syncPlacementPreviewState(undefined);

    const gaussCfg = ultimateCfg?.type === 'gauss' ? ultimateCfg : undefined;
    if (!utilityBlocked && gaussCfg && Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.beginUltimateCharge(now, gaussCfg, angle, clampedTarget.x, clampedTarget.y);
    } else if (!utilityBlocked && !gaussCfg && Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.onLoadoutUse('ultimate', angle, clampedTarget.x, clampedTarget.y, { inputStarted: true });
    }

    if (this.ultimateHoldActive && this.ultimateChargeStartedAt !== null && gaussCfg) {
      const chargeFraction = this.computeGaussChargeFraction(this.ultimateChargeStartedAt, gaussCfg, now);
      if (chargeFraction >= 1.0) {
        this.autoFireAndMaybeRechargeGauss(angle, clampedTarget.x, clampedTarget.y, now, gaussCfg);
      } else if (this.keyQ.isDown) {
        this.scene.cameras.main.shake(50, 0.0022);
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

  private cancelUtilityTargeting(): void {
    this.utilityTargetingActive = false;
  }

  private cancelUtilityPlacement(): void {
    this.utilityPlacementActive = false;
    this.placementPreviewState = null;
  }

  private cancelUtilityInteraction(): void {
    this.cancelUtilityCharge();
    this.cancelUtilityTargeting();
    this.cancelUtilityPlacement();
  }

  private cancelUtilityCharge(): void {
    this.utilityHoldActive = false;
    this.utilityChargeEligibleAt = null;
    this.utilityChargeStartedAt = null;
  }

  private syncPlacementPreviewState(preview: UtilityPlacementPreviewState | undefined): void {
    if (!this.utilityPlacementActive || !preview) {
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
      this.onLoadoutUse?.('ultimate', angle, targetX, targetY, { ultimateAction: 'press', inputStarted: true });
      return;
    }
    this.cancelUtilityInteraction();
    this.ultimateHoldActive = true;
    this.ultimateChargeStartedAt = now;
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
  }
}
