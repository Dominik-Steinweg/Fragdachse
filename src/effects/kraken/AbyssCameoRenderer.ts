import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, DEPTH_LIGHTING } from '../../config';
import type { CoopDefenseMapAbyssCameoConfig } from '../../config/coopDefenseMapAuthoring';
import { WaterDisturbanceField } from '../../arena/WaterDisturbanceField';
import type { WorldMetrics } from '../../world/WorldMetrics';
import { fillRadialGradientTexture, registerGraphicsObject } from '../EffectUtils';
import { emissiveAlpha } from '../EmissiveScale';
import { EnemyEyeBatch } from '../EnemyEyeBatch';

const SHADOW = '__abyss_cameo_shadow', EYE = '__abyss_cameo_eye';
/** Presentation tuning only. The cue itself is the authored mission time. */
const LOOK = {
  mantle: { length: 250, width: 150, alpha: .6 },
  arms: { count: 6, length: 230, width: 46, spread: .9, alpha: .38 },
  eyes: { forward: 70, pairs: [[0, 22], [-20, 40]] as const, size: 38, alpha: .75, color: 0xff3a1a, pulseHz: .45 },
  wake: { radius: 120, length: 420, strength: .55 },
};

/** 0..1 envelope: fade in over the first fifth, out over the last quarter. */
export function abyssCameoEnvelope(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
  return smooth(progress / .2) * (1 - smooth((progress - .75) / .25));
}

/**
 * The abyssal kraken heralds itself on earlier maps: a giant dark shape with ember eyes glides once under
 * the water surface. Every peer derives it from the shared mission clock and the authored path; it has
 * no gameplay and uses no boss assets.
 */
export class AbyssCameoRenderer {
  private readonly parts: Phaser.GameObjects.Image[] = [];
  private readonly eyes: EnemyEyeBatch;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    fillRadialGradientTexture(scene.textures, SHADOW, 64, [[0, 'rgba(255,255,255,1)'], [.55, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, EYE, 32, [[0, 'rgba(255,255,255,1)'], [.3, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]);
    for (let i = 0; i < 1 + LOOK.arms.count; i++) {
      const part = scene.add.image(0, 0, SHADOW).setDepth(DEPTH.WATER + .03).setTint(0x060209).setVisible(false);
      registerGraphicsObject(scene, 'bossIntro', part);
      this.parts.push(part);
    }
    this.eyes = new EnemyEyeBatch(scene, EYE, 8, DEPTH_LIGHTING + .085);
    this.eyes.layer.setBlendMode(Phaser.BlendModes.ADD).setName('abyss-cameo-eyes');
    registerGraphicsObject(scene, 'bossIntro', this.eyes.layer);
  }

  sync(config: CoopDefenseMapAbyssCameoConfig | null, elapsedMs: number, metrics: WorldMetrics | null): void {
    if (this.destroyed) return;
    const progress = config ? (elapsedMs - config.atMs) / config.durationMs : -1;
    const envelope = abyssCameoEnvelope(progress);
    if (!config || !metrics || envelope <= 0) { this.hide(); return; }
    const at = (p: { gridX: number; gridY: number }) => ({ x: metrics.offsetX + (p.gridX + .5) * CELL_SIZE, y: metrics.offsetY + (p.gridY + .5) * CELL_SIZE });
    const from = at(config.from), to = at(config.to), eased = progress * progress * (3 - 2 * progress);
    const x = from.x + (to.x - from.x) * eased, y = from.y + (to.y - from.y) * eased, heading = Math.atan2(to.y - from.y, to.x - from.x);
    const c = Math.cos(heading), s = Math.sin(heading), seconds = elapsedMs / 1000;
    const m = LOOK.mantle, a = LOOK.arms;
    this.parts[0]!.setPosition(x, y).setRotation(heading).setDisplaySize(m.length, m.width).setAlpha(m.alpha * envelope).setVisible(true);
    for (let i = 0; i < a.count; i++) {
      // Arms trail behind the mantle and sway slowly (fanned around the heading).
      const fan = (i / (a.count - 1) - .5) * a.spread + Math.sin(seconds * 1.3 + i * 1.7) * .12;
      const angle = heading + Math.PI + fan, reach = m.length * .35 + a.length * .5;
      this.parts[1 + i]!.setPosition(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach).setRotation(angle)
        .setDisplaySize(a.length, a.width).setAlpha(a.alpha * envelope).setVisible(true);
    }
    const e = LOOK.eyes, pulse = .7 + .3 * Math.sin(seconds * e.pulseHz * Math.PI * 2);
    this.eyes.begin(e.pairs.length * 2);
    for (const [ahead, side] of e.pairs) for (const sign of [-1, 1]) {
      const fx = e.forward + ahead, lx = side * sign;
      this.eyes.write(x + c * fx - s * lx, y + s * fx + c * lx, e.size, e.size, 0, e.color, emissiveAlpha(e.alpha * envelope * pulse));
    }
    WaterDisturbanceField.for(this.scene)?.submit({ kind: 'wake', x, y, age: seconds % 600, radius: LOOK.wake.radius,
      strength: LOOK.wake.strength * envelope, angle: heading, param: LOOK.wake.length });
  }

  hide(): void { for (const part of this.parts) part.setVisible(false); this.eyes.begin(0); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const part of this.parts) part.destroy();
    this.parts.length = 0; this.eyes.destroy();
  }
}
