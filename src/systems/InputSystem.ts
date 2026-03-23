import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { PlayerInput, LoadoutSlot, LoadoutUseParams, UtilityChargePreviewState, UtilityTargetingPreviewState } from '../types';
import {
  DASH_T1_S, DASH_T2_S,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT,
} from '../config';
import { quantizeAngle } from '../utils/angle';

const DASH_CYCLE_MS = (DASH_T1_S + DASH_T2_S) * 1000; // 600ms Gesamtzyklusdauer
import type {
  ChargedThrowUtilityActivationConfig,
  ChargedGateUtilityActivationConfig,
  TargetedClickUtilityActivationConfig,
  UtilityConfig,
} from '../loadout/LoadoutConfig';

/** Gemeinsamer Nenner für alle aufladbaren Utility-Aktivierungen. */
type ChargeableActivation = ChargedThrowUtilityActivationConfig | ChargedGateUtilityActivationConfig;
type TargetedActivation = TargetedClickUtilityActivationConfig;

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
  private predictedUtilityCooldownUntil = 0;
  private utilityHoldActive = false;
  private utilityChargeEligibleAt: number | null = null;
  private utilityChargeStartedAt: number | null = null;
  private utilityTargetingActive = false;

  // Aktueller Aim-Winkel (Radiant, für Rotation-Sync)
  private currentAimAngle = 0;

  // Lokaler Zustand vom Host empfangen
  private localIsStunned  = false;
  private localIsBurrowed = false;
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

  /**
   * Wird von ArenaScene jeden Frame mit dem aktuellen Spieler-Netzwerkstatus gesetzt,
   * damit Stun und Burrow-Zustand für Input-Gating berücksichtigt werden.
   */
  setLocalState(isStunned: boolean, isBurrowed: boolean): void {
    this.localIsStunned  = isStunned;
    this.localIsBurrowed = isBurrowed;
    if (isStunned) this.cancelUtilityInteraction();
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.predictedUtilityCooldownUntil = 0;
      this.cancelUtilityInteraction();
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

  getUtilityChargePreviewState(): UtilityChargePreviewState | undefined {
    const sprite = this.getLocalSprite();
    const cfg = this.getChargeableUtilityConfig();
    if (!this.utilityHoldActive || !sprite || !cfg) return undefined;

    const now = Date.now();
    const startedAt = this.utilityChargeStartedAt;
    const isGate = cfg.activation.type === 'charged_gate';

    const pointer = this.scene.input.activePointer;
    const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, pointer.x, pointer.y);
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
    const target = this.clampPointToArena(pointer.x, pointer.y);
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

    const input: PlayerInput = { dx, dy, aim: quantizeAngle(this.currentAimAngle) };
    this.bridge.sendLocalInput(input);

    if (!this.inputEnabled) return;

    // ── 2. Stun: keine weiteren Aktionen ───────────────────────────────────
    if (this.localIsStunned) {
      this.cancelUtilityInteraction();
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
      this.bridge.sendBurrowRequest(!this.localIsBurrowed);
    }

    // ── 5. Loadout-Aktionen ────────────────────────────────────────────────
    if (!this.onLoadoutUse) return;

    const pointer = this.scene.input.activePointer;
    const sprite  = this.getLocalSprite();
    const now     = Date.now();

    if (!sprite) {
      this.cancelUtilityInteraction();
      return;
    }

    const px    = pointer.x;
    const py    = pointer.y;
    const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, px, py);
    this.currentAimAngle = angle;

    if (this.utilityTargetingActive) {
      const targetedCfg = this.getTargetedUtilityConfig();
      if (!targetedCfg) {
        this.cancelUtilityTargeting();
      } else {
        const target = this.clampPointToArena(px, py);
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

    // LMB gedrückt halten → weapon1 (Dauerfeuer, kein Client-Throttle)
    // Korrekte Host-Authority: RPCs jeden Frame senden, Host entscheidet über Cooldown.
    // Client-seitiger Cooldown würde bei variabler RPC-Latenz zu Schuss-Lücken führen.
    if (pointer.leftButtonDown()) {
      this.onLoadoutUse('weapon1', angle, px, py);
    } else if (pointer.rightButtonDown()) {
      // RMB gedrückt halten → weapon2 (Dauerfeuer, kein Client-Throttle)
      this.onLoadoutUse('weapon2', angle, px, py);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.beginTargetedUtilityAim(now)) {
        return;
      }
      if (!this.beginChargedUtilityHold(now)) {
        this.onLoadoutUse('utility', angle, px, py);
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
      this.releaseChargedUtility(angle, px, py, now);
    } else if (releasedUtility) {
      this.cancelUtilityCharge();
    } else if (this.utilityHoldActive && !this.keyE.isDown) {
      this.cancelUtilityCharge();
    }

    // Q-Taste → ultimate (keine Positionsdaten nötig)
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.onLoadoutUse('ultimate', 0, 0, 0);
    }
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

  private beginTargetedUtilityAim(now: number): boolean {
    const cfg = this.getTargetedUtilityConfig();
    if (!cfg) return false;

    if (now < this.getEffectiveUtilityCooldownUntil()) return true;

    this.cancelUtilityCharge();
    this.utilityTargetingActive = true;
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

  private clampPointToArena(x: number, y: number): { x: number; y: number } {
    return {
      x: Phaser.Math.Clamp(x, ARENA_OFFSET_X, ARENA_OFFSET_X + ARENA_WIDTH),
      y: Phaser.Math.Clamp(y, ARENA_OFFSET_Y, ARENA_OFFSET_Y + ARENA_HEIGHT),
    };
  }

  private cancelUtilityTargeting(): void {
    this.utilityTargetingActive = false;
  }

  private cancelUtilityInteraction(): void {
    this.cancelUtilityCharge();
    this.cancelUtilityTargeting();
  }

  private cancelUtilityCharge(): void {
    this.utilityHoldActive = false;
    this.utilityChargeEligibleAt = null;
    this.utilityChargeStartedAt = null;
  }
}
