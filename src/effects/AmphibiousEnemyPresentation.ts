import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { WaterDisturbanceField } from '../arena/WaterDisturbanceField';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { fillRadialGradientTexture, registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import { EnemyEyeBatch } from './EnemyEyeBatch';

const EYE = '__amphibious_eye_glow';
/** Visual tuning only; the replicated `submerged` flag is the sole input. */
const LOOK = {
  wake: { radius: 22, length: 120, strength: .32 },
  dive: { kind: 'ring' as const, radius: 34, strength: .5, lifetimeMs: 700 },
  surface: { kind: 'splat' as const, radius: 30, strength: .6, lifetimeMs: 650 },
  /** Four ember points just ahead of the hidden body (kin of the abyssal kraken). */
  eyes: { forward: 6, pairs: [[2.5, 3.2], [1.0, 5.6]] as const, size: 9, alpha: .42, pulseHz: .9, color: 0xff4a1c },
};

interface Splash { readonly kind: 'ring' | 'splat'; readonly x: number; readonly y: number; readonly at: number }

/**
 * Shows what betrays an amphibious enemy under water: a small wake on the pond surface, dim ember eyes
 * and a ring when it dives or a splash when it surfaces. Host and clients read the same replicated flag;
 * nothing here decides gameplay. Wakes stay weak so a boss keeps its disturbance slots.
 */
export class AmphibiousEnemyPresentation {
  private readonly eyes: EnemyEyeBatch;
  private readonly submerged = new Map<string, boolean>();
  private readonly splashes: Splash[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    fillRadialGradientTexture(scene.textures, EYE, 32, [[0, 'rgba(255,255,255,1)'], [.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);
    this.eyes = new EnemyEyeBatch(scene, EYE, 64, DEPTH_LIGHTING + .085);
    this.eyes.layer.setBlendMode(Phaser.BlendModes.ADD).setName('amphibious-eyes');
    registerGraphicsObject(scene, 'enemyStatus', this.eyes.layer);
  }

  sync(enemies: readonly EnemyVisualSource[], now: number): void {
    if (this.destroyed) return;
    const water = WaterDisturbanceField.for(this.scene), seen = new Set<string>(), eyes: [number, number, number][] = [];
    for (const enemy of enemies) {
      if (!getCoopDefenseEnemyConfig(enemy.kind).amphibious || enemy.getHp() <= 0) continue;
      seen.add(enemy.id);
      const submerged = !!enemy.getNetSnapshot().submerged, previous = this.submerged.get(enemy.id);
      const x = enemy.sprite.x, y = enemy.sprite.y;
      if (previous !== undefined && previous !== submerged) this.splashes.push({ kind: submerged ? 'ring' : 'splat', x, y, at: now });
      this.submerged.set(enemy.id, submerged);
      if (!submerged) continue;
      const heading = enemy.getNetSnapshot().rot;
      water?.submit({ kind: 'wake', x, y, age: (now / 1000) % 600, radius: LOOK.wake.radius, strength: LOOK.wake.strength,
        angle: heading, param: LOOK.wake.length });
      const e = LOOK.eyes, c = Math.cos(heading), s = Math.sin(heading);
      for (const [ahead, side] of e.pairs) for (const sign of [-1, 1]) {
        const fx = e.forward + ahead, lx = side * sign;
        eyes.push([x + c * fx - s * lx, y + s * fx + c * lx, enemy.id.charCodeAt(enemy.id.length - 1)]);
      }
    }
    for (const id of this.submerged.keys()) if (!seen.has(id)) this.submerged.delete(id);
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const splash = this.splashes[i]!, look = splash.kind === 'ring' ? LOOK.dive : LOOK.surface, age = now - splash.at;
      if (age >= look.lifetimeMs || age < 0) { this.splashes.splice(i, 1); continue; }
      water?.submit({ kind: look.kind, x: splash.x, y: splash.y, age: age / 1000, radius: look.radius, strength: look.strength });
    }
    this.eyes.begin(eyes.length);
    const e = LOOK.eyes;
    for (const [x, y, phase] of eyes) {
      const pulse = .75 + .25 * Math.sin(now / 1000 * e.pulseHz * Math.PI * 2 + phase);
      this.eyes.write(x, y, e.size, e.size, 0, e.color, emissiveAlpha(e.alpha * pulse));
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.eyes.destroy(); this.submerged.clear(); this.splashes.length = 0;
  }
}
