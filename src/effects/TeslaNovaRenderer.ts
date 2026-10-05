import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { mixColors, registerGraphicsObject } from './EffectUtils';
import { getEmissiveScale } from './EmissiveScale';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import type { LightingSystem } from './LightingSystem';
import { TESLA_ELECTRIC_RECIPE, createTeslaPalette, hasWebGl, writeTeslaPalette, type TeslaPalette } from './TeslaFieldVisual';
import { TESLA_NOVA_FRAGMENT_SOURCE, TESLA_NOVA_OUTER_REACH, TESLA_NOVA_SHADER_NAME } from './teslaDomeShader';

/** Eine laufende Welle. Sie lebt unabhängig von der Kuppel und räumt sich selbst ab. */
interface NovaWave {
  x: number;
  y: number;
  maxRadius: number;
  startedAt: number;
  durationMs: number;
  lightColor: number;
  seed: number;
  quad: Phaser.GameObjects.Shader | null;
  uniforms: { radius: number; fade: number; time: number; pixelSize: number; emission: number };
  palette: TeslaPalette;
  lightKey: string;
}

const WAVE_DURATION_MS = 420;
/** Weißanteil der Nova: sie ist ein kurzer Schlag und darf heißer glühen als die Kuppel. */
const NOVA_WHITENESS = 0.7;

/**
 * Blitznova der Tesla-Kuppel.
 *
 * Die Welle liest sich wie eine Frostnova in ihrer Kontur – ein klar begrenzter, schnell nach
 * außen laufender Ring bis zum aktuellen Kuppelrand – trägt aber durchgehend die elektrische
 * Sprache der Kuppel: eine gezackte, weißglühende Blitzfront, dahinter kurz aufglimmendes
 * Adernetz und davor radiale Überschläge. Alles entsteht in einem Shader-Quad je Welle.
 */
export class TeslaNovaRenderer {
  private readonly waves: NovaWave[] = [];
  private lighting: LightingSystem | null = null;
  private nextWaveId = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  /** Startet eine Welle, die in einem Zug bis `maxRadius` läuft. */
  play(x: number, y: number, maxRadius: number, color: number): void {
    const radius = Math.max(24, maxRadius);
    this.nextWaveId += 1;
    const palette = createTeslaPalette();
    writeTeslaPalette(palette, color, TESLA_ELECTRIC_RECIPE, NOVA_WHITENESS);
    const wave: NovaWave = {
      x,
      y,
      maxRadius: radius,
      startedAt: this.scene.time.now,
      durationMs: WAVE_DURATION_MS,
      lightColor: mixColors(color, 0xffffff, 0.65),
      seed: (this.nextWaveId * 97) % 997,
      quad: null,
      uniforms: { radius: 0, fade: 0, time: 0, pixelSize: 1, emission: 1 },
      palette,
      lightKey: `teslanova:${this.nextWaveId}`,
    };
    wave.quad = this.createQuad(wave);
    this.waves.push(wave);
  }

  update(): void {
    const time = this.scene.time.now;
    const camera = this.scene.cameras?.main;
    const pixelSize = camera ? 1 / Math.max(0.001, Math.min(camera.zoomX, camera.zoomY)) : 1;
    const emission = getEmissiveScale();

    for (let index = this.waves.length - 1; index >= 0; index--) {
      const wave = this.waves[index];
      const progress = (time - wave.startedAt) / wave.durationMs;
      if (progress >= 1) {
        this.destroyWave(wave);
        this.waves.splice(index, 1);
        continue;
      }

      // Schnell heraus, dann auslaufen: die Front ist im ersten Drittel am deutlichsten.
      const eased = 1 - (1 - progress) ** 2.4;
      const radius = wave.maxRadius * eased;
      const fade = Phaser.Math.Clamp(progress < 0.1 ? progress / 0.1 : 1 - (progress - 0.1) / 0.9, 0, 1);

      const uniforms = wave.uniforms;
      uniforms.radius = radius;
      uniforms.fade = fade;
      uniforms.time = (time - wave.startedAt) / 1000;
      uniforms.pixelSize = pixelSize;
      uniforms.emission = emission;
      wave.quad?.setVisible(fade > 0.001);

      this.lighting?.setLight(
        wave.lightKey,
        'electricField',
        wave.x,
        wave.y,
        {
          radiusPx: Math.max(radius * 1.1, 60),
          color: wave.lightColor,
          intensity: 0.75 * fade,
        },
      );
    }
  }

  destroyAll(): void {
    for (const wave of this.waves) this.destroyWave(wave);
    this.waves.length = 0;
  }

  private createQuad(wave: NovaWave): Phaser.GameObjects.Shader | null {
    // Headless-Präsentation darf keine GPU-Ressourcen anlegen.
    if (!hasWebGl(this.scene)) return null;
    const size = Math.ceil((wave.maxRadius + TESLA_NOVA_OUTER_REACH + 16) * 2);
    const { uniforms, palette } = wave;
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: TESLA_NOVA_SHADER_NAME,
      shaderName: TESLA_NOVA_SHADER_NAME,
      fragmentSource: TESLA_NOVA_FRAGMENT_SOURCE,
      setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
        setUniform('uSize', size);
        setUniform('uRadius', uniforms.radius);
        setUniform('uFade', uniforms.fade);
        setUniform('uTime', uniforms.time);
        setUniform('uSeed', wave.seed);
        setUniform('uPixelSize', uniforms.pixelSize);
        setUniform('uEmission', uniforms.emission);
        setUniform('uBody', palette.body);
        setUniform('uHot', palette.hot);
        setUniform('uCore', palette.core);
      },
    }, wave.x, wave.y, size, size);
    quad.setOrigin(0.5).setDepth(DEPTH.FIRE + 0.26).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(false);
    this.scene.add.existing(quad);
    registerGraphicsObject(this.scene, 'teslaNovaEffects', quad);
    return quad;
  }

  private destroyWave(wave: NovaWave): void {
    this.lighting?.releaseLight(wave.lightKey);
    if (wave.quad?.renderNode) disposeShaderWarmupNode(wave.quad.renderNode);
    wave.quad?.destroy();
    wave.quad = null;
  }
}
