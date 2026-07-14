import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import { configureAdditiveImage, fillRadialGradientTexture } from './EffectUtils';

const TEX_MINI_DOME_FIELD = '__enemy_mini_tesla_field';
const TEX_MINI_DOME_SPARK = '__enemy_mini_tesla_spark';

interface MiniDomeVisual {
  field: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Ellipse;
  arcs: Phaser.GameObjects.Graphics;
  radius: number;
  phase: number;
  lastSparkAt: number;
}

/** Kleine, satt violette Tesla-Variante fuer Teleporter-Gegner. */
export class MiniTeslaDomeRenderer {
  private readonly visuals = new Map<string, MiniDomeVisual>();
  private readonly particles = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_MINI_DOME_FIELD, 192, [
      [0, 'rgba(245,220,255,0.22)'],
      [0.35, 'rgba(185,70,255,0.24)'],
      [0.72, 'rgba(112,24,220,0.2)'],
      [1, 'rgba(44,0,100,0.0)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_MINI_DOME_SPARK, 14, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.3, 'rgba(234,176,255,0.95)'],
      [0.72, 'rgba(166,54,255,0.5)'],
      [1, 'rgba(92,0,190,0.0)'],
    ]);
  }

  syncEnemies(enemies: readonly EnemyEntity[]): void {
    const activeIds = new Set<string>();
    const weapon = WEAPON_CONFIGS.MINI_TESLA_DOME;
    if (weapon.fire.type !== 'tesla_dome') return;

    for (const enemy of enemies) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      if (!getCoopDefenseEnemyConfig(enemy.kind).weapons.some(entry => entry.weaponId === 'MINI_TESLA_DOME')) continue;
      activeIds.add(enemy.id);
      this.syncDome(enemy, weapon.fire.radius);
    }

    for (const [enemyId, visual] of this.visuals) {
      if (activeIds.has(enemyId)) continue;
      visual.field.destroy();
      visual.ring.destroy();
      visual.arcs.destroy();
      this.visuals.delete(enemyId);
    }
  }

  update(_delta: number): void {
    const now = this.scene.time.now;
    for (const visual of this.visuals.values()) {
      const pulse = 1 + Math.sin(now * 0.005 + visual.phase) * 0.045;
      visual.field.setScale((visual.radius * 2 / 192) * pulse);
      visual.field.setAlpha(0.8 + Math.sin(now * 0.006 + visual.phase) * 0.12);
      visual.ring.setScale(pulse).setAlpha(0.72 + Math.sin(now * 0.007 + visual.phase) * 0.18);
      this.drawArcs(visual, now);
      if (now - visual.lastSparkAt >= 95) {
        visual.lastSparkAt = now;
        this.spawnRimSpark(visual);
      }
    }
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) {
      visual.field.destroy();
      visual.ring.destroy();
      visual.arcs.destroy();
    }
    for (const particle of this.particles) {
      this.scene.tweens.killTweensOf(particle);
      particle.destroy();
    }
    this.visuals.clear();
    this.particles.clear();
  }

  private syncDome(enemy: EnemyEntity, radius: number): void {
    let visual = this.visuals.get(enemy.id);
    if (!visual) {
      const field = configureAdditiveImage(
        this.scene.add.image(enemy.sprite.x, enemy.sprite.y, TEX_MINI_DOME_FIELD),
        DEPTH.PLAYERS - 0.14,
        0.82,
        0xb14cff,
      );
      const ring = this.scene.add.ellipse(enemy.sprite.x, enemy.sprite.y, radius * 2, radius * 2)
        .setStrokeStyle(3, 0xd279ff, 0.82)
        .setFillStyle(0x7b20d4, 0.05)
        .setDepth(DEPTH.PLAYERS - 0.13);
      const arcs = this.scene.add.graphics().setDepth(DEPTH.PLAYERS + 0.12);
      visual = {
        field,
        ring,
        arcs,
        radius,
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
        lastSparkAt: 0,
      };
      this.visuals.set(enemy.id, visual);
    }

    visual.radius = radius;
    visual.field.setPosition(enemy.sprite.x, enemy.sprite.y);
    visual.ring.setPosition(enemy.sprite.x, enemy.sprite.y).setSize(radius * 2, radius * 2);
    visual.arcs.setPosition(enemy.sprite.x, enemy.sprite.y);
  }

  private drawArcs(visual: MiniDomeVisual, now: number): void {
    visual.arcs.clear();
    for (let arcIndex = 0; arcIndex < 3; arcIndex += 1) {
      const angle = now * 0.0017 + visual.phase + arcIndex * Math.PI * 0.66;
      const reach = visual.radius * (0.55 + 0.12 * Math.sin(now * 0.006 + arcIndex));
      visual.arcs.lineStyle(arcIndex === 0 ? 2.2 : 1.3, arcIndex === 0 ? 0xf0c4ff : 0xb347ff, 0.76);
      visual.arcs.beginPath();
      visual.arcs.moveTo(0, 0);
      for (let segment = 1; segment <= 5; segment += 1) {
        const fraction = segment / 5;
        const jitter = Math.sin(now * 0.02 + segment * 2.3 + arcIndex) * 6;
        visual.arcs.lineTo(
          Math.cos(angle) * reach * fraction + Math.cos(angle + Math.PI * 0.5) * jitter,
          Math.sin(angle) * reach * fraction + Math.sin(angle + Math.PI * 0.5) * jitter,
        );
      }
      visual.arcs.strokePath();
    }
  }

  private spawnRimSpark(visual: MiniDomeVisual): void {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const particle = configureAdditiveImage(
      this.scene.add.image(
        visual.field.x + Math.cos(angle) * visual.radius,
        visual.field.y + Math.sin(angle) * visual.radius,
        TEX_MINI_DOME_SPARK,
      ),
      DEPTH.PLAYERS + 0.18,
      0.95,
      0xc15cff,
    ).setScale(Phaser.Math.FloatBetween(0.5, 0.9));
    this.particles.add(particle);
    this.scene.tweens.add({
      targets: particle,
      alpha: 0,
      scale: particle.scale * 1.8,
      duration: 240,
      onComplete: () => {
        this.particles.delete(particle);
        particle.destroy();
      },
    });
  }
}
