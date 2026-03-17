import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { PlayerInput, LoadoutSlot, LoadoutUseParams, UtilityChargePreviewState } from '../types';
import { DASH_COOLDOWN_MS } from '../config';
import type { ChargedThrowUtilityActivationConfig, UtilityConfig } from '../loadout/LoadoutConfig';

export class InputSystem {
  private scene:           Phaser.Scene;
  private bridge:          NetworkBridge;
  private getLocalSprite:  () => Phaser.GameObjects.Rectangle | undefined;

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
  private utilityChargeStartedAt: number | null = null;

  // Lokaler Zustand vom Host empfangen
  private localIsStunned  = false;
  private localIsBurrowed = false;
  private inputEnabled    = true;

  constructor(
    scene:          Phaser.Scene,
    bridge:         NetworkBridge,
    getLocalSprite: () => Phaser.GameObjects.Rectangle | undefined,
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

  /**
   * Wird von ArenaScene jeden Frame mit dem aktuellen Spieler-Netzwerkstatus gesetzt,
   * damit Stun und Burrow-Zustand für Input-Gating berücksichtigt werden.
   */
  setLocalState(isStunned: boolean, isBurrowed: boolean): void {
    this.localIsStunned  = isStunned;
    this.localIsBurrowed = isBurrowed;
    if (isStunned) this.cancelUtilityCharge();
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.cancelUtilityCharge();
  }

  /**
   * Dash-Cooldown als Fraktion 0 (bereit) – 1 (gerade benutzt) für das HUD.
   */
  getDashCooldownFrac(): number {
    const remaining = this.dashCooldownUntil - Date.now();
    if (remaining <= 0) return 0;
    return Math.min(1, remaining / DASH_COOLDOWN_MS);
  }

  isUtilityCharging(): boolean {
    return this.utilityChargeStartedAt !== null;
  }

  getUtilityChargePreviewState(): UtilityChargePreviewState | undefined {
    const sprite = this.getLocalSprite();
    const cfg = this.getChargedThrowUtilityConfig();
    const startedAt = this.utilityChargeStartedAt;
    if (!sprite || !cfg || startedAt === null) return undefined;

    const pointer = this.scene.input.activePointer;
    const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, pointer.x, pointer.y);
    return {
      angle,
      chargeFraction: this.computeUtilityChargeFraction(startedAt, cfg.activation, Date.now()),
      minThrowSpeed: cfg.activation.minThrowSpeed,
      maxThrowSpeed: cfg.projectileSpeed,
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

    const input: PlayerInput = { dx, dy };
    this.bridge.sendLocalInput(input);

    if (!this.inputEnabled) return;

    // ── 2. Stun: keine weiteren Aktionen ───────────────────────────────────
    if (this.localIsStunned) {
      this.cancelUtilityCharge();
      return;
    }

    // ── 3. Dash (Flanke, einmalig auslösen) ────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      const now = Date.now();
      if (now >= this.dashCooldownUntil) {
        this.bridge.sendDash(dx, dy);
        this.dashCooldownUntil = now + DASH_COOLDOWN_MS;
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
      this.cancelUtilityCharge();
      return;
    }

    const px    = pointer.x;
    const py    = pointer.y;
    const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, px, py);

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
      if (!this.tryStartChargedUtility(now)) {
        this.onLoadoutUse('utility', angle, px, py);
      }
    }

    if (Phaser.Input.Keyboard.JustUp(this.keyE) && this.utilityChargeStartedAt !== null) {
      this.releaseChargedUtility(angle, px, py, now);
    }

    // Q-Taste → ultimate (keine Positionsdaten nötig)
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.onLoadoutUse('ultimate', 0, 0, 0);
    }
  }

  private getChargedThrowUtilityConfig(): (UtilityConfig & { activation: ChargedThrowUtilityActivationConfig }) | undefined {
    const cfg = this.getLocalUtilityConfig?.();
    if (!cfg || cfg.activation.type !== 'charged_throw') return undefined;
    return cfg as UtilityConfig & { activation: ChargedThrowUtilityActivationConfig };
  }

  private tryStartChargedUtility(now: number): boolean {
    const cfg = this.getChargedThrowUtilityConfig();
    if (!cfg) return false;
    this.utilityChargeStartedAt = now;
    return true;
  }

  private releaseChargedUtility(angle: number, targetX: number, targetY: number, now: number): void {
    const cfg = this.getChargedThrowUtilityConfig();
    const startedAt = this.utilityChargeStartedAt;
    this.utilityChargeStartedAt = null;
    if (!cfg || startedAt === null) return;

    this.onLoadoutUse?.('utility', angle, targetX, targetY, {
      utilityChargeFraction: this.computeUtilityChargeFraction(startedAt, cfg.activation, now),
    });
  }

  private computeUtilityChargeFraction(
    startedAt: number,
    activation: ChargedThrowUtilityActivationConfig,
    now: number,
  ): number {
    if (activation.fullChargeDuration <= 0) return 1;
    const elapsed = now - startedAt;
    return Math.max(0, Math.min(1, elapsed / activation.fullChargeDuration));
  }

  private cancelUtilityCharge(): void {
    this.utilityChargeStartedAt = null;
  }
}
