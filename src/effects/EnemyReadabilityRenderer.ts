import * as Phaser from 'phaser';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { configureGpuLayerCameraTransform } from '../graphics/GpuLayerCameraTransform';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { getEmissiveScale } from './EmissiveScale';
import { registerGraphicsObject } from './EffectUtils';
import { ENEMY_READABILITY, enemyContourStrength } from './EnemyReadabilityConfig';
import { ENEMY_CONTOUR_FRAGMENT, ENEMY_CONTOUR_POSE } from './enemyContourShader';

/** One instanced draw per displayed sheet/depth, no per-enemy filters or offscreen targets. */
export class EnemyReadabilityRenderer {
  private readonly layers = new Map<string, Phaser.GameObjects.SpriteGPULayer>();
  private readonly counts = new Map<string, number>();
  private readonly visible: EnemyVisualSource[] = [];
  private readonly member: Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member> = {};
  private suppressed = false;
  private destroyed = false;
  private warmupLayer: Phaser.GameObjects.SpriteGPULayer | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    if (suppressed) this.clear();
  }

  sync(enemies: readonly EnemyVisualSource[]): void {
    if (this.destroyed) return;
    this.clear();
    if (this.suppressed) return;
    const view = getVisibleWorldView(this.scene.cameras.main);
    for (const enemy of enemies) {
      const s = enemy.sprite;
      if (!s.active || !s.visible || s.alpha <= 0 || enemy.getHp() <= 0) continue;
      const margin = Math.max(Math.abs(s.displayWidth), Math.abs(s.displayHeight)) + 12;
      if (s.x + margin < view.x || s.x - margin > view.x + view.width ||
          s.y + margin < view.y || s.y - margin > view.y + view.height) continue;
      this.visible.push(enemy);
      const key = this.key(enemy);
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
      if (!this.layers.has(key)) this.layers.set(key, this.createLayer(s));
    }
    for (const [key, count] of this.counts) {
      const layer = this.layers.get(key)!;
      if (count > layer.size) layer.resize(2 ** Math.ceil(Math.log2(count)), true);
      layer.setVisible(true);
    }
    const strength = enemyContourStrength(getEmissiveScale());
    for (const enemy of this.visible) {
      const s = enemy.sprite, m = this.member;
      m.x = s.x; m.y = s.y; m.rotation = s.rotation;
      m.scaleX = s.scaleX * (s.flipX ? -1 : 1); m.scaleY = s.scaleY * (s.flipY ? -1 : 1);
      m.originX = s.originX; m.originY = s.originY; m.frame = s.frame;
      // Status effects remain on the original body; the contour never replaces its tint/shader.
      // Phaser's setAlpha already writes all four corner alphas; do not square it.
      m.alpha = strength;
      m.alphaTopLeft = s.alphaTopLeft; m.alphaTopRight = s.alphaTopRight;
      m.alphaBottomLeft = s.alphaBottomLeft; m.alphaBottomRight = s.alphaBottomRight;
      this.layers.get(this.key(enemy))!.addMember(m);
    }
  }

  getDiagnostics() {
    return { suppressed: this.suppressed, instances: this.visible.length,
      draws: [...this.layers.values()].filter(layer => layer.visible && layer.memberCount > 0).length,
      strength: enemyContourStrength(getEmissiveScale()), low: getGraphicsQualityProfile(this.scene).level === 'low' };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    if (this.warmupLayer) {
      disposeShaderWarmupNode(this.warmupLayer.submitterNode);
      this.warmupLayer.destroy(); this.warmupLayer = null;
    }
    for (const layer of this.layers.values()) layer.destroy();
    this.layers.clear(); this.destroyed = true;
  }

  private clear(): void {
    this.visible.length = 0; this.counts.clear();
    for (const layer of this.layers.values()) { layer.memberCount = 0; layer.setVisible(false); }
  }

  private key(enemy: EnemyVisualSource): string { return `${enemy.sprite.texture.key}:${enemy.sprite.depth}`; }

  /** Same submitter/features as a live enemy; sheet, depth and pose only change data/uniforms. */
  prepareShader(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    if (!this.warmupLayer) {
      this.warmupLayer = this.createLayer({ texture: this.scene.textures.get('__WHITE'), depth: 0 }).setVisible(false);
      this.warmupLayer.addMember({ x: 0, y: 0, scaleX: 1, scaleY: 1, alpha: 0 });
    }
    const node = this.warmupLayer.submitterNode;
    node.run(context);
    return !!node.programManager.getCurrentProgramSuite();
  }

  private createLayer(s: Pick<Phaser.GameObjects.Sprite, 'texture' | 'depth'>): Phaser.GameObjects.SpriteGPULayer {
    const layer = new Phaser.GameObjects.SpriteGPULayer(this.scene, s.texture, 32);
    configureGpuLayerCameraTransform(layer);
    layer.setDepth(s.depth - 0.001).setName(`enemy-contour:${s.texture.key}`).setBlendMode(Phaser.BlendModes.NORMAL);
    const node = layer.submitterNode;
    const vertex = (node.config as { vertexSource: string }).vertexSource;
    node.programManager.setBaseShader('EnemyContourV1', vertex, ENEMY_CONTOUR_FRAGMENT);
    node.programManager.addAddition(ENEMY_CONTOUR_POSE);
    const setup = node.setupUniforms;
    const scene = this.scene;
    node.setupUniforms = function(context) {
      setup.call(this, context);
      const c = ENEMY_READABILITY, low = getGraphicsQualityProfile(scene).level === 'low';
      this.programManager.setUniform('uContourWidths', [c.darkWidth, low ? 0 : c.lightWidth]);
      this.programManager.setUniform('uContourAlphas', [c.darkAlpha, low ? 0 : c.lightAlpha]);
      this.programManager.setUniform('uContourDark', c.darkColor);
      this.programManager.setUniform('uContourLight', c.lightColor);
      this.programManager.setUniform('uContourBridge', c.bridgeFraction);
    };
    this.scene.add.existing(layer);
    registerGraphicsObject(this.scene, 'enemyStatus', layer);
    return layer;
  }
}
