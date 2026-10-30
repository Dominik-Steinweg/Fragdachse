import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../../config';
import { getCoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';
import { enemyEmissionTextureKey } from '../../config/enemyEmission';
import type { EnemyVisualSource } from '../../entities/EnemyVisualSource';
import { emissiveAlpha } from '../EmissiveScale';
import { graveGlowLevel } from './graveLightModel';

/** The grave light inside the titan's fissures: its emission sheet, tinted, just above the light map. */
const EMISSION_DEPTH = DEPTH_LIGHTING + 0.08;
/** Saturated: a paler tint added over the green fissure light and crown whitens the cross. */
const GRAVE_LIGHT_TINT = 0x52ff6e;
/** The smoulder shows as authored; flares above it are compressed, or the additive cross and crown clip to white. */
const SMOULDER = 0.45;
const FLARE_GAIN = 0.25;
/** Volley-carrying bosses with an emission sheet glow along their grave fissures. */
export class GraveTitanGlowPresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private readonly overlays = new Map<string, Phaser.GameObjects.Sprite>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: volley and melee timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }

  clear(): void {
    for (const overlay of this.overlays.values()) overlay.destroy();
    this.overlays.clear();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear();
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<string>();
    for (const enemy of this.enemies()) {
      const volley = enemy.getVolleyState?.();
      if (!volley || !getCoopDefenseEnemyConfig(enemy.kind).weapons.some(weapon => weapon.salvo?.chargeMs)) continue;
      const sprite = enemy.sprite, key = enemyEmissionTextureKey(sprite.texture.key);
      if (!this.scene.textures.exists(key)) continue;
      live.add(enemy.id);
      let overlay = this.overlays.get(enemy.id);
      if (!overlay || overlay.texture.key !== key) {
        overlay?.destroy();
        overlay = this.scene.add.sprite(sprite.x, sprite.y, key, sprite.frame.name).setBlendMode(Phaser.BlendModes.ADD).setDepth(EMISSION_DEPTH);
        this.overlays.set(enemy.id, overlay);
      }
      const visible = sprite.visible && sprite.active && enemy.getHp() > 0;
      overlay.setVisible(visible);
      if (!visible) continue;
      if (overlay.frame.name !== sprite.frame.name && overlay.texture.has(sprite.frame.name)) overlay.setFrame(sprite.frame.name);
      const level = graveGlowLevel(volley, enemy.getClawAttackState?.().attack ?? null, now);
      const glow = level <= SMOULDER ? level : SMOULDER + (level - SMOULDER) * FLARE_GAIN;
      overlay.setOrigin(sprite.originX, sprite.originY).setPosition(sprite.x, sprite.y).setRotation(sprite.rotation)
        .setScale(sprite.scaleX, sprite.scaleY).setFlip(sprite.flipX, sprite.flipY)
        .setTint(GRAVE_LIGHT_TINT).setAlpha(emissiveAlpha(glow * sprite.alpha));
    }
    for (const [id, overlay] of this.overlays) {
      if (live.has(id)) continue;
      overlay.destroy();
      this.overlays.delete(id);
    }
  }
}
