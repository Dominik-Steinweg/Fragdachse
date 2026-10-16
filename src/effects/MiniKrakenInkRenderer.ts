import * as Phaser from 'phaser';
import { KrakenEffects } from './kraken/KrakenRenderer';
import type { KrakenInkCloud } from '../systems/KrakenState';

/** The small ink cone of a melee ink weapon stays this long after its confirmed hit (travel, hold, dissolve). */
const MINI_INK_LIFETIME_MS = 950;
const MAX_CLOUDS = 24;

interface MiniInkCloud { readonly cloud: KrakenInkCloud; readonly localSpitAt: number }

/**
 * Local presentation of melee ink spits (Mini-Kraken): the confirmed swing becomes a short-lived small
 * version of the boss's ink cloud. Reuses the kraken FX quads and shader; gameplay is the melee swing.
 */
export class MiniKrakenInkRenderer {
  private readonly effects: KrakenEffects;
  private readonly clouds: MiniInkCloud[] = [];
  private serial = 0;

  constructor(private readonly scene: Phaser.Scene, waterAt: (x: number, y: number) => number = () => 0) {
    this.effects = new KrakenEffects(scene, waterAt);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.update, this);
  }

  spit(x: number, y: number, angle: number, range: number, arcDegrees: number): void {
    const now = this.scene.time.now;
    if (this.clouds.length >= MAX_CLOUDS) this.clouds.shift();
    this.clouds.push({ localSpitAt: now, cloud: {
      attackId: `mini-ink:${++this.serial}`, spitAt: now, cloudEndsAt: now + MINI_INK_LIFETIME_MS,
      pose: { originX: x, originY: y, angle, geometry: { kind: 'sector', range, arcDegrees } },
    } });
  }

  update(): void {
    const now = this.scene.time.now;
    this.effects.begin();
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const entry = this.clouds[i]!;
      if (now >= entry.cloud.cloudEndsAt) { this.clouds.splice(i, 1); continue; }
      this.effects.ink(entry.cloud, now);
    }
  }

  clear(): void { this.clouds.length = 0; this.effects.clear(); }
  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.update, this);
    this.clouds.length = 0; this.effects.destroy();
  }
}
