import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import { DAWN_ELITE_AFFIX_IDS, type DawnEliteAffixId } from '../../dawn/contracts/DawnContentIds';
import type { EnemyVisualSource } from '../../entities/EnemyVisualSource';
import { getPipelineSpriteScale } from '../../config/pipelineAssets';
import { configureGpuLayerCameraTransform } from '../../graphics/GpuLayerCameraTransform';
import { getVisibleWorldView } from '../../ui/HostileBaseIndicator';
import { ensureCanvasTexture, registerGraphicsObject } from '../EffectUtils';
import { eliteMarkerGeometry, ELITE_MARKERS } from './EliteMarkerModel';

const ATLAS = '__dawn_elite_markers';
const CELL = 64;
const RING_DEPTH = DEPTH.PLAYERS - 0.07;
const GLYPH_DEPTH = DEPTH_LIGHTING + 0.13;

/** Two shared GPU batches for all fallback markers; no per-enemy objects, timers or particles. */
export class EliteMarkerRenderer {
  private readonly rings: Phaser.GameObjects.SpriteGPULayer;
  private readonly glyphs: Phaser.GameObjects.SpriteGPULayer;
  private readonly icons = new Map<string, Phaser.GameObjects.SpriteGPULayer>();
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureAtlas(scene.textures);
    this.rings = this.createLayer(ATLAS, RING_DEPTH);
    this.glyphs = this.createLayer(ATLAS, GLYPH_DEPTH);
  }

  sync(enemies: readonly EnemyVisualSource[]): void {
    if (this.destroyed) return;
    for (const layer of [this.rings, this.glyphs, ...this.icons.values()]) {
      layer.memberCount = 0;
      layer.setVisible(false);
    }
    const view = getVisibleWorldView(this.scene.cameras.main);
    for (const enemy of enemies) {
      const affix = enemy.eliteAffixId, sprite = enemy.sprite;
      if (!affix || !sprite.active || !sprite.visible || sprite.alpha <= 0 || enemy.getHp() <= 0) continue;
      const size = Math.max(Math.abs(sprite.displayWidth), Math.abs(sprite.displayHeight)) / getPipelineSpriteScale(sprite.texture.key);
      const model = eliteMarkerGeometry(affix, sprite.x, sprite.y, size);
      const margin = Math.max(size, model.glyphSize * 2);
      if (sprite.x + margin < view.x || sprite.x - margin > view.x + view.width
        || sprite.y + margin < view.y || sprite.y - margin > view.y + view.height) continue;
      this.write(this.rings, this.scene.textures.getFrame(ATLAS, 'ring-' + affix),
        model.x, model.y, model.ringDiameter, sprite.alpha * 0.65);
      // Asset production can supply the contracted texture key without changing the enemy contract.
      let glyphLayer = this.glyphs;
      let frame = this.scene.textures.getFrame(ATLAS, 'glyph-' + affix);
      if (this.scene.textures.exists(model.iconKey)) {
        let icon = this.icons.get(model.iconKey);
        if (!icon) { icon = this.createLayer(model.iconKey, GLYPH_DEPTH); this.icons.set(model.iconKey, icon); }
        glyphLayer = icon; frame = icon.frame;
      }
      this.write(glyphLayer, frame, model.glyphX, model.glyphY, model.glyphSize, sprite.alpha);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.rings.destroy(); this.glyphs.destroy();
    for (const layer of this.icons.values()) layer.destroy();
    this.icons.clear();
  }

  private createLayer(key: string, depth: number): Phaser.GameObjects.SpriteGPULayer {
    const layer = new Phaser.GameObjects.SpriteGPULayer(this.scene, this.scene.textures.get(key), 32);
    configureGpuLayerCameraTransform(layer);
    layer.setDepth(depth).setVisible(false);
    this.scene.add.existing(layer);
    registerGraphicsObject(this.scene, 'enemyStatus', layer);
    return layer;
  }

  private write(layer: Phaser.GameObjects.SpriteGPULayer, frame: Phaser.Textures.Frame,
    x: number, y: number, size: number, alpha: number): void {
    if (layer.memberCount === layer.size) layer.resize(layer.size * 2, false);
    layer.setVisible(true);
    layer.addMember({ frame, x, y, originX: 0.5, originY: 0.5,
      scaleX: size / frame.realWidth, scaleY: size / frame.realHeight, alpha });
  }
}

function ensureAtlas(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, ATLAS, CELL * DAWN_ELITE_AFFIX_IDS.length, CELL * 2, ctx => {
    DAWN_ELITE_AFFIX_IDS.forEach((id, i) => {
      ctx.save(); ctx.translate(i * CELL, 0);
      const { color, segments } = ELITE_MARKERS[id];
      ctx.lineCap = 'round';
      for (const [width, stroke] of [[6, '#19202a'], [2.5, color]] as const) {
        ctx.strokeStyle = stroke; ctx.lineWidth = width;
        for (let part = 0; part < segments; part++) {
          const start = part * Math.PI * 2 / segments + 0.09;
          ctx.beginPath(); ctx.arc(32, 32, 27, start, (part + 1) * Math.PI * 2 / segments - 0.09); ctx.stroke();
        }
      }
      ctx.translate(0, CELL);
      ctx.fillStyle = '#17212e'; ctx.beginPath(); ctx.roundRect(5, 5, 54, 54, 12); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      drawGlyph(ctx, id);
      ctx.restore();
    });
  });
  const texture = textures.get(ATLAS);
  DAWN_ELITE_AFFIX_IDS.forEach((id, i) => {
    if (!texture.has('ring-' + id)) texture.add('ring-' + id, 0, i * CELL, 0, CELL, CELL);
    if (!texture.has('glyph-' + id)) texture.add('glyph-' + id, 0, i * CELL, CELL, CELL, CELL);
  });
}

function drawGlyph(ctx: CanvasRenderingContext2D, id: DawnEliteAffixId): void {
  ctx.strokeStyle = '#f4f7f2'; ctx.fillStyle = '#f4f7f2'; ctx.lineWidth = 5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const path = (points: readonly (readonly [number, number])[], close = false) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath(); ctx.stroke();
  };
  switch (id) {
    case 'swift':
      path([[19, 23], [32, 16], [45, 23]]); path([[19, 40], [32, 33], [45, 40]]); break;
    case 'armored':
      path([[20, 17], [44, 17], [48, 33], [39, 47], [25, 47], [16, 33]], true);
      path([[22, 31], [42, 31]]); break;
    case 'volatile':
      path([[32, 13], [37, 25], [50, 25], [40, 34], [44, 48], [32, 40],
        [20, 48], [24, 34], [14, 25], [27, 25]], true); break;
    case 'regenerating':
      ctx.fillRect(27, 15, 10, 34); ctx.fillRect(15, 27, 34, 10); break;
    case 'shielding':
      path([[17, 18], [32, 14], [47, 18], [44, 37], [32, 49], [20, 37]], true);
      path([[32, 21], [32, 40]]); break;
  }
}
