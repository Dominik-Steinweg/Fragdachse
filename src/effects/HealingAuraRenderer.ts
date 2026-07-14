import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import { WEAPON_CONFIGS, type HealingAuraWeaponFireConfig } from '../loadout/LoadoutConfig';
import { configureAdditiveImage, fillRadialGradientTexture } from './EffectUtils';

const TEX_HEAL_FIELD = '__enemy_heal_aura_field';
const TEX_HEAL_PARTICLE = '__enemy_heal_aura_particle';

interface HealingAuraVisual {
  field: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Ellipse;
  radius: number;
  phase: number;
}

/** Gruene, bewusst eigenstaendige Darstellung der gegnerischen Heil-Aura. */
export class HealingAuraRenderer {
  private readonly visuals = new Map<string, HealingAuraVisual>();
  private readonly knownHp = new Map<string, number>();
  private readonly particles = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_HEAL_FIELD, 256, [
      [0, 'rgba(210,255,220,0.26)'],
      [0.38, 'rgba(84,255,132,0.18)'],
      [0.72, 'rgba(24,190,88,0.11)'],
      [1, 'rgba(0,90,40,0.0)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_HEAL_PARTICLE, 18, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.28, 'rgba(150,255,175,0.95)'],
      [0.68, 'rgba(48,255,108,0.48)'],
      [1, 'rgba(20,180,70,0.0)'],
    ]);
  }

  syncEnemies(enemies: readonly EnemyEntity[]): void {
    const activeAuraIds = new Set<string>();
    const activeEnemyIds = new Set<string>();

    for (const enemy of enemies) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      activeEnemyIds.add(enemy.id);

      const previousHp = this.knownHp.get(enemy.id);
      if (previousHp !== undefined && enemy.getHp() > previousHp + 0.01) {
        this.spawnHealingBurst(enemy.sprite.x, enemy.sprite.y, Math.min(8, 3 + Math.ceil((enemy.getHp() - previousHp) / 10)));
      }
      this.knownHp.set(enemy.id, enemy.getHp());

      const enemyConfig = getCoopDefenseEnemyConfig(enemy.kind);
      if (!enemyConfig.weapons.some(weapon => weapon.weaponId === 'HEALING_AURA')) continue;
      const weapon = WEAPON_CONFIGS.HEALING_AURA;
      if (weapon.fire.type !== 'healing_aura') continue;

      activeAuraIds.add(enemy.id);
      this.syncAura(enemy, weapon.fire);
    }

    for (const [enemyId, visual] of this.visuals) {
      if (activeAuraIds.has(enemyId)) continue;
      visual.field.destroy();
      visual.ring.destroy();
      this.visuals.delete(enemyId);
    }
    for (const enemyId of this.knownHp.keys()) {
      if (!activeEnemyIds.has(enemyId)) this.knownHp.delete(enemyId);
    }
  }

  update(_delta: number): void {
    const now = this.scene.time.now;
    for (const visual of this.visuals.values()) {
      const pulse = 1 + Math.sin(now * 0.004 + visual.phase) * 0.035;
      visual.field.setScale((visual.radius * 2 / 256) * pulse);
      visual.field.setAlpha(0.72 + Math.sin(now * 0.005 + visual.phase) * 0.1);
      visual.ring.setScale(pulse);
      visual.ring.setAlpha(0.62 + Math.sin(now * 0.006 + visual.phase) * 0.18);
    }
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) {
      visual.field.destroy();
      visual.ring.destroy();
    }
    for (const particle of this.particles) {
      this.scene.tweens.killTweensOf(particle);
      particle.destroy();
    }
    this.visuals.clear();
    this.knownHp.clear();
    this.particles.clear();
  }

  private syncAura(enemy: EnemyEntity, fire: HealingAuraWeaponFireConfig): void {
    let visual = this.visuals.get(enemy.id);
    if (!visual) {
      const field = configureAdditiveImage(
        this.scene.add.image(enemy.sprite.x, enemy.sprite.y, TEX_HEAL_FIELD),
        DEPTH.PLAYERS - 0.18,
        0.75,
        0x66ff99,
      );
      const ring = this.scene.add.ellipse(enemy.sprite.x, enemy.sprite.y, fire.radius * 2, fire.radius * 2)
        .setStrokeStyle(3, 0x73ff9f, 0.72)
        .setFillStyle(0x20b85a, 0.035)
        .setDepth(DEPTH.PLAYERS - 0.17);
      visual = { field, ring, radius: fire.radius, phase: Phaser.Math.FloatBetween(0, Math.PI * 2) };
      this.visuals.set(enemy.id, visual);
    }

    visual.radius = fire.radius;
    visual.field.setPosition(enemy.sprite.x, enemy.sprite.y);
    visual.ring.setPosition(enemy.sprite.x, enemy.sprite.y).setSize(fire.radius * 2, fire.radius * 2);
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
