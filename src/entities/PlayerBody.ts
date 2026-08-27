import * as Phaser from 'phaser';
import { PLAYER_SIZE } from '../config';

/**
 * Nicht rendernder Arcade-Koerper einer Spielfigur.
 *
 * Nach demselben Muster wie die Fels- und Baum-Proxies: `Zone` besitzt Transform, Bounds,
 * Rotation und Active, hat aber keinen Renderpfad.
 */
export type PlayerPhysicsProxy = Phaser.GameObjects.Zone;

/**
 * Kanonische Runtime einer Spielfigur: Position, Ausrichtung, Aktivitaet, Bounds und Physik.
 *
 * Sie ist die einzige Quelle dieser Werte. Das sichtbare Sprite folgt ihr und ist ausdruecklich
 * optional - ein Host kann eine World simulieren, ohne eine einzige Figur darzustellen.
 *
 * Der Koerper haengt an einer unsichtbaren `Zone` mit fester Skalierung. Das ist zugleich eine
 * bewusste Entkopplung: frueher trug das Sprite den Koerper, wodurch jede Sprite-Skalierung
 * (Spawn, Burrow) die Hitbox implizit mitskalierte. Der Kollisionsradius wird jetzt
 * ausschliesslich explizit gesetzt - so, wie ihn `HostPhysicsSystem` fuer den Dash ohnehin
 * schon fuehrt.
 */
export class PlayerBody {
  readonly proxy: PlayerPhysicsProxy;

  /** Kollisionsradius in Weltpixeln; die Zone selbst wird nie skaliert. */
  private collisionRadius = PLAYER_SIZE / 2;

  constructor(scene: Phaser.Scene, x: number, y: number, collideWorldBounds: boolean) {
    this.proxy = scene.add.zone(x, y, PLAYER_SIZE, PLAYER_SIZE);
    this.proxy.setOrigin(0.5, 0.5);
    scene.physics.add.existing(this.proxy);
    this.setCollisionRadius(PLAYER_SIZE / 2);
    this.body.setCollideWorldBounds(collideWorldBounds);
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.proxy.body as Phaser.Physics.Arcade.Body;
  }

  get x(): number { return this.proxy.x; }
  get y(): number { return this.proxy.y; }

  /** Sprite-Rotation in Phaser-Konvention; die Aim-Umrechnung bleibt beim Aufrufer. */
  get rotation(): number { return this.proxy.rotation; }
  set rotation(value: number) { this.proxy.rotation = value; }

  /** Solange der Koerper existiert, steht die Figur in der World. */
  get active(): boolean { return this.proxy.active; }

  getBounds(output?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    return this.proxy.getBounds(output);
  }

  /** Setzt Position und Koerper hart - Spawn und Respawn. */
  setPosition(x: number, y: number): void {
    this.proxy.setPosition(x, y);
    this.body.reset(x, y);
  }

  /** Bewegt die Figur ohne den Koerper zurueckzusetzen - Client-Interpolation. */
  moveTo(x: number, y: number): void {
    this.proxy.setPosition(x, y);
  }

  /**
   * Kollisionsradius in Weltpixeln.
   *
   * Ohne Sprite-Skalierung dazwischen ist der gesetzte Wert zugleich der wirksame - die
   * frueher noetige Umrechnung ueber die Texturskalierung entfaellt.
   */
  setCollisionRadius(radius: number): void {
    if (radius <= Number.EPSILON) return;
    this.collisionRadius = radius;
    this.body.setCircle(radius, PLAYER_SIZE / 2 - radius, PLAYER_SIZE / 2 - radius);
  }

  getCollisionRadius(): number {
    return this.collisionRadius;
  }

  destroy(): void {
    this.proxy.destroy();
  }
}
