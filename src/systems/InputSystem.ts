import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { PlayerInput, LoadoutSlot } from '../types';
import { DASH_COOLDOWN_MS } from '../config';
import { WEAPON_CONFIGS }   from '../loadout/LoadoutConfig';

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

  // Lokale Cooldown-Tracker für Waffen (Throttling der RPCs, Host validiert autoritativ)
  private slotLastFired = new Map<LoadoutSlot, number>();

  // Loadout-Callback (gesetzt von ArenaScene)
  private onLoadoutUse: ((slot: LoadoutSlot, angle: number, targetX: number, targetY: number) => void) | null = null;

  // Lokaler Zustand vom Host empfangen
  private localIsStunned  = false;
  private localIsBurrowed = false;

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
    this.keyW     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyShift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyE     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyQ     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    // Kontextmenü deaktivieren damit Rechtsklick im Spiel registriert wird
    this.scene.input.mouse?.disableContextMenu();
  }

  /**
   * Loadout-Callback registrieren.
   * Wird aufgerufen wenn der Spieler eine Aktion ausführt (Waffe, Utility, Ultimate).
   */
  setupLoadoutListener(
    cb: (slot: LoadoutSlot, angle: number, targetX: number, targetY: number) => void,
  ): void {
    this.onLoadoutUse = cb;
  }

  /**
   * Wird von ArenaScene jeden Frame mit dem aktuellen Spieler-Netzwerkstatus gesetzt,
   * damit Stun und Burrow-Zustand für Input-Gating berücksichtigt werden.
   */
  setLocalState(isStunned: boolean, isBurrowed: boolean): void {
    this.localIsStunned  = isStunned;
    this.localIsBurrowed = isBurrowed;
  }

  /**
   * Dash-Cooldown als Fraktion 0 (bereit) – 1 (gerade benutzt) für das HUD.
   */
  getDashCooldownFrac(): number {
    const remaining = this.dashCooldownUntil - Date.now();
    if (remaining <= 0) return 0;
    return Math.min(1, remaining / DASH_COOLDOWN_MS);
  }

  /** Jeden Frame: WASD + Dash + Burrow + Loadout lesen, RPCs senden. */
  update(): void {
    // ── 1. Bewegungs-Input (immer gesendet) ────────────────────────────────
    let dx = 0, dy = 0;
    if (this.keyA.isDown) dx -= 1;
    if (this.keyD.isDown) dx += 1;
    if (this.keyW.isDown) dy -= 1;
    if (this.keyS.isDown) dy += 1;

    const input: PlayerInput = { dx, dy };
    this.bridge.sendLocalInput(input);

    // ── 2. Stun: keine weiteren Aktionen ───────────────────────────────────
    if (this.localIsStunned) return;

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

    if (sprite) {
      const px    = pointer.x;
      const py    = pointer.y;
      const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, px, py);

      // LMB gedrückt halten → weapon1 (Dauerfeuer mit Cooldown-Throttle)
      if (pointer.leftButtonDown()) {
        const cd   = WEAPON_CONFIGS.TEST_WEAPON_1.cooldown;
        const last = this.slotLastFired.get('weapon1') ?? -Infinity;
        if (now - last >= cd) {
          this.onLoadoutUse('weapon1', angle, px, py);
          this.slotLastFired.set('weapon1', now);
        }
      }

      // RMB gedrückt halten → weapon2 (Dauerfeuer mit Cooldown-Throttle)
      if (pointer.rightButtonDown()) {
        const cd   = WEAPON_CONFIGS.TEST_WEAPON_2.cooldown;
        const last = this.slotLastFired.get('weapon2') ?? -Infinity;
        if (now - last >= cd) {
          this.onLoadoutUse('weapon2', angle, px, py);
          this.slotLastFired.set('weapon2', now);
        }
      }

      // E-Taste → utility (Granate, Flanke)
      if (Phaser.Input.Keyboard.JustDown(this.keyE)) {
        this.onLoadoutUse('utility', angle, px, py);
      }
    }

    // Q-Taste → ultimate (keine Positionsdaten nötig)
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.onLoadoutUse('ultimate', 0, 0, 0);
    }
  }
}
