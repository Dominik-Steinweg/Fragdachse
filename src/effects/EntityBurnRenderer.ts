import * as Phaser from 'phaser';
import { DEPTH, VOID_FIRE_COLOR } from '../config';
import type { EntityBurnGpuController } from './EntityBurnGpuController';
import type { LightingSystem } from './LightingSystem';
import type { GroundFireVisualStyle } from '../types';
import {
  ensureFlameTextures,
  ensureVoidFlameTextures,
  TEX_FLAME_GLOW,
  TEX_VOID_FLAME_GLOW,
} from './FlameShared';

const DEPTH_BURN_GLOW = DEPTH.PLAYERS + 0.18;
const VOID_ENTITY_BURN_LIGHT_COLOR = 0xe8c8ff;
/**
 * Obergrenze der visuell unterscheidbaren Brandstacks. Sie steht hier und nicht im
 * `EntityBurnGpuController`, damit dieses Modul – und mit ihm jede Entity – nicht am gesamten
 * GPUFX-Stack haengt; der Controller holt sie sich von hier.
 */
export const MAX_VISUAL_BURN_STACKS = 32;

/**
 * Gemeinsamer, stackabhängiger Brand-Effekt für Spieler und Gegner.
 *
 * Glow und Licht gehören weiterhin dieser Instanz – beides ist genau ein Objekt je Entity.
 * Die Partikel liegen dagegen beim szenenweiten `EntityBurnGpuController`: früher entstanden
 * hier drei eigene `ParticleEmitter` je brennender Entity, jetzt hält der Controller nur noch
 * Zustand und emittiert alle Brände in einem gemeinsamen GPUFX-Tick.
 */
export class EntityBurnRenderer {
  private readonly glowImage: Phaser.GameObjects.Image;
  private active = false;
  private visualStyle: GroundFireVisualStyle = 'normal';
  private lighting: LightingSystem | null = null;
  /** Handle beim gemeinsamen Controller; `-1`, solange keiner verdrahtet ist. */
  private readonly burnHandle: number;
  /**
   * Anders als die zentralen Renderer gehört eine Instanz zu genau einer Entity. Der
   * Licht-Key ist deshalb fest und wird einmal von außen gesetzt, statt ihn bei jedem
   * `sync()` mitzuschleppen.
   */
  private lightKey = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly burnGpu: EntityBurnGpuController | null = null,
  ) {
    ensureFlameTextures(scene);
    ensureVoidFlameTextures(scene);
    this.burnHandle = burnGpu ? burnGpu.acquire() : -1;

    this.glowImage = scene.add.image(0, 0, TEX_FLAME_GLOW)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH_BURN_GLOW)
      .setTint(0xff8a24)
      .setVisible(false);
  }

  setLightingSystem(lighting: LightingSystem | null, lightKey: string): void {
    this.lighting = lighting;
    this.lightKey = lightKey;
  }

  sync(
    x: number,
    y: number,
    bodySize: number,
    stacks: number,
    visible: boolean,
    visualStyle: GroundFireVisualStyle = 'normal',
  ): void {
    this.applyVisualStyle(visualStyle);
    const activeStacks = Math.max(0, Math.floor(stacks));
    if (activeStacks <= 0 || !visible) {
      this.setActive(false);
      this.releaseLight();
      return;
    }

    const clampedStacks = Math.min(activeStacks, MAX_VISUAL_BURN_STACKS);
    const intensity = Phaser.Math.Clamp(Math.log2(clampedStacks + 1) / 5, 0.2, 1);
    this.setActive(true);

    this.glowImage.setPosition(x, y + bodySize * 0.03);
    // Streuung, Frequenz, Menge und Alpha der Partikel leitet der Controller aus denselben
    // Stacks ab; hier bleibt nur das, was ein Objekt je Entity ist.
    if (this.burnHandle >= 0) {
      this.burnGpu?.update(this.burnHandle, x, y, bodySize, clampedStacks, visualStyle);
    }

    const pulse = 0.88 + Math.sin(this.scene.time.now * 0.018 + activeStacks * 0.7) * 0.12;
    this.glowImage
      .setVisible(true)
      .setAlpha((0.18 + intensity * 0.38) * pulse)
      .setScale(Math.max(bodySize / 48 * (1.3 + intensity * 1.15) * pulse, 0.42));

    // Ein brennender Körper leuchtet wie ein brennendes Projektil, nur größer und mit
    // der Stack-Intensität als Regler. `visible` ist hier bereits geprüft – wer nicht
    // sichtbar auf dem Feld steht, leuchtet auch nicht.
    if (this.lightKey) {
      this.lighting?.setLight(this.lightKey, 'entityBurn', x, y + bodySize * 0.05, {
        radiusPx: 70 + bodySize * 1.1 + intensity * 40,
        intensity: 0.55 + intensity * 0.45,
        color: this.visualStyle === 'void' ? VOID_ENTITY_BURN_LIGHT_COLOR : undefined,
      });
    }
  }

  /**
   * Nur noch Glow und Licht: die Partikel tragen ihr Motiv pro Member, ein Stilwechsel muss
   * dort nichts mehr umfärben und auch keine lebenden Partikel wegräumen.
   */
  private applyVisualStyle(visualStyle: GroundFireVisualStyle): void {
    if (this.visualStyle === visualStyle) return;
    this.visualStyle = visualStyle;

    const isVoid = visualStyle === 'void';
    this.glowImage
      .setTexture(isVoid ? TEX_VOID_FLAME_GLOW : TEX_FLAME_GLOW)
      .setTint(isVoid ? VOID_FIRE_COLOR : 0xff8a24);
  }

  private releaseLight(): void {
    if (this.lightKey) this.lighting?.releaseLight(this.lightKey);
  }

  destroy(): void {
    this.releaseLight();
    if (this.burnHandle >= 0) this.burnGpu?.release(this.burnHandle);
    this.glowImage.destroy();
  }

  private setActive(active: boolean): void {
    if (this.active === active) {
      if (!active) this.glowImage.setVisible(false);
      return;
    }

    this.active = active;
    if (active) {
      this.glowImage.setVisible(true);
      return;
    }

    // Entspricht dem fruehreren `stop(true)`: lebende Partikel verschwinden sofort.
    if (this.burnHandle >= 0) this.burnGpu?.setInactive(this.burnHandle);
    this.glowImage.setVisible(false);
  }
}
