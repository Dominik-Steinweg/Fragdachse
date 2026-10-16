import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { configureAdditiveImage, fillRadialGradientTexture } from './EffectUtils';

const TEX_HEAL_PARTICLE = '__enemy_heal_aura_particle';

/**
 * Rising green motes wherever a body regains health (enemy heal links, regeneration, player rocket
 * heal). Healing is read from the observed HP rise, never invented; the heal source draws its own
 * cause (tendrils, beams).
 */
export class HealingAuraRenderer {
  private readonly knownHp = new Map<string, number>();
  private readonly particles = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_HEAL_PARTICLE, 18, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.28, 'rgba(150,255,175,0.95)'],
      [0.68, 'rgba(48,255,108,0.48)'],
      [1, 'rgba(20,180,70,0.0)'],
    ]);
  }

  playHealingBurst(x: number, y: number): void {
    this.generateTextures();
    this.spawnHealingBurst(x, y, 5);
  }

  syncEnemies(enemies: readonly EnemyVisualSource[]): void {
    const activeEnemyIds = new Set<string>();
    for (const enemy of enemies) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      activeEnemyIds.add(enemy.id);
      const previousHp = this.knownHp.get(enemy.id);
      if (previousHp !== undefined && enemy.getHp() > previousHp + 0.01) {
        this.spawnHealingBurst(enemy.sprite.x, enemy.sprite.y, Math.min(8, 3 + Math.ceil((enemy.getHp() - previousHp) / 10)));
      }
      this.knownHp.set(enemy.id, enemy.getHp());
    }
    for (const enemyId of this.knownHp.keys()) {
      if (!activeEnemyIds.has(enemyId)) this.knownHp.delete(enemyId);
    }
  }

  destroyAll(): void {
    for (const particle of this.particles) {
      this.scene.tweens.killTweensOf(particle);
      particle.destroy();
    }
    this.knownHp.clear();
    this.particles.clear();
  }

  private spawnHealingBurst(x: number, y: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.FloatBetween(4, 20);
      const particle = configureAdditiveImage(
        this.scene.add.image(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, TEX_HEAL_PARTICLE),
        DEPTH.PLAYERS + 0.3,
        0.95,
        0x58ff8b,
      ).setScale(Phaser.Math.FloatBetween(0.45, 0.85));
      this.particles.add(particle);
      this.scene.tweens.add({
        targets: particle,
        x: particle.x + Phaser.Math.FloatBetween(-10, 10),
        y: particle.y - Phaser.Math.FloatBetween(24, 48),
        alpha: 0,
        scale: particle.scale * 0.35,
        duration: Phaser.Math.Between(420, 720),
        ease: 'Quad.easeOut',
        onComplete: () => {
          this.particles.delete(particle);
          particle.destroy();
        },
      });
    }
  }
}
