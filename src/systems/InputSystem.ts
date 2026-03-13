import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { PlayerInput } from '../types';

export class InputSystem {
  private scene:           Phaser.Scene;
  private bridge:          NetworkBridge;
  private getLocalSprite:  () => Phaser.GameObjects.Rectangle | undefined;

  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;

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
    const kb  = this.scene.input.keyboard!;
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
  }

  /** Jeden Frame: WASD lesen und als Input an den Host senden. */
  update(): void {
    let dx = 0, dy = 0;
    if (this.keyA.isDown) dx -= 1;
    if (this.keyD.isDown) dx += 1;
    if (this.keyW.isDown) dy -= 1;
    if (this.keyS.isDown) dy += 1;
    const input: PlayerInput = { dx, dy };
    this.bridge.sendLocalInput(input);
  }

  /**
   * Registriert den Linksklick-Handler.
   * Der Winkel wird aus der aktuellen Sprite-Position berechnet –
   * kein Playroom-State-Lesezugriff nötig.
   */
  setupShootListener(onShoot: (angle: number) => void): void {
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return;
      const sprite = this.getLocalSprite();
      if (!sprite) return;
      const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, pointer.x, pointer.y);
      onShoot(angle);
    });
  }
}
