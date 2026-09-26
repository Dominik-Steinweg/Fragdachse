/**
 * Flächen des Coop-Defense-Tutorialfensters im Forest-Stil der Menüs.
 *
 * Rahmen und Glas stammen aus demselben Kit wie die modalen Overlays (`ForestModal`), werden
 * hier aber mit fester Eckgröße komponiert: Starthinweis und Steuerungstafel haben
 * unterschiedliche Höhen und sollen trotzdem gleich starkes Holz tragen.
 */
import type * as Phaser from 'phaser';
import { COLORS } from '../config';
import { rgbStr } from './LivingBarEffect';
import { BORDER, MODAL_FRAME_ASSET, SURFACE, drawModalFrame } from './ForestModal';
import { FOREST } from './UiSkin';
import { ensureRoundedTexture, lerpColor, roundRectPath } from './uiTextures';

/** Angezeigte Eckgröße des Rahmen-Kits. */
const FRAME_CAP = 64;
/** Die Glasfläche endet unter der Holzleiste, damit zwischen Rahmen und Glas keine Fuge bleibt. */
const GLASS_INSET = 22;
const GLASS_RADIUS = 14;
/** Innenkante des Holzrahmens bei {@link FRAME_CAP}; Inhalte bleiben innerhalb. */
export const TUTORIAL_FRAME_INNER = 30;
/** Mittellinie der oberen Holzleiste, auf der das Titelschild sitzt. */
export const TUTORIAL_TOP_RAIL_Y = 24;
/** Doppelte Auflösung wie die modalen Rahmen: das Fenster ist ein Weltobjekt und wird mitgezoomt. */
const TEXTURE_SCALE = 2;

export function ensureTutorialPanelTexture(scene: Phaser.Scene, w: number, h: number): string {
  const key = `_tutorial_panel_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w * TEXTURE_SCALE, h * TEXTURE_SCALE);
  if (!texture) return key;
  const ctx = texture.context;
  ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
  const gw = w - GLASS_INSET * 2;
  const gh = h - GLASS_INSET * 2;

  // Glas mit weichem Schlagschatten: hebt die Tafel vom Felsuntergrund ab, ohne harte Kante.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 5;
  roundRectPath(ctx, GLASS_INSET, GLASS_INSET, gw, gh, GLASS_RADIUS);
  const glass = ctx.createLinearGradient(0, GLASS_INSET, 0, GLASS_INSET + gh);
  glass.addColorStop(0, rgbStr(lerpColor(FOREST.glass, COLORS.GREY_10, 0.18), 0.94));
  glass.addColorStop(1, rgbStr(SURFACE.sunken, 0.96));
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.restore();

  // Warmer Lichtschein unter dem Titelschild und dunklere Ränder lenken den Blick auf den Text.
  ctx.save();
  roundRectPath(ctx, GLASS_INSET, GLASS_INSET, gw, gh, GLASS_RADIUS);
  ctx.clip();
  const glowRadius = Math.max(gw, gh) * 0.55;
  const glow = ctx.createRadialGradient(w / 2, GLASS_INSET, 0, w / 2, GLASS_INSET, glowRadius);
  glow.addColorStop(0, rgbStr(COLORS.GOLD_4, 0.2));
  glow.addColorStop(1, rgbStr(COLORS.GOLD_4, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const vignette = ctx.createLinearGradient(GLASS_INSET, 0, GLASS_INSET + gw, 0);
  vignette.addColorStop(0, 'rgba(0,0,0,0.22)');
  vignette.addColorStop(0.12, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.88, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  if (scene.textures.exists(MODAL_FRAME_ASSET.key)) {
    drawModalFrame(ctx, scene.textures.get(MODAL_FRAME_ASSET.key).getSourceImage() as HTMLImageElement,
      w, h, FRAME_CAP);
  }
  texture.refresh();
  return key;
}

/** Tastenkappe der Steuerungstafel: dieselbe Materialwahl wie im Hilfe-Fenster. */
export function ensureTutorialKeycapTexture(scene: Phaser.Scene, w: number, h: number): string {
  return ensureRoundedTexture(scene, {
    key: `_tutorial_keycap_${w}x${h}`, w, h, radius: 6,
    topColor: SURFACE.raised, bottomColor: SURFACE.sunken, fillAlpha: 0.92,
    strokeColor: BORDER.subtle, strokeAlpha: 0.85, strokeWidth: 1, highlightAlpha: 0.05,
  });
}
