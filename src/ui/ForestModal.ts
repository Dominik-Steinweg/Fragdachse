import type * as Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS, toCssColor as baseToCssColor } from '../config';
import type { BackdropSurface } from '../effects/postfx/BackdropBlur';
import { FOREST, skinTextColor } from './UiSkin';
import { BORDER as BASE_BORDER, SURFACE as BASE_SURFACE, TEXT as BASE_TEXT, INTENT, textStyle as baseTextStyle } from './uiTheme';
import { ensureRoundedTexture } from './uiTextures';
import { ensureForestButton } from './forestTextures';

export const MODAL_FRAME_ASSET = { key: 'forest_modal_frame_kit', file: './assets/ui/forest-modals/frame-kit.png' } as const;
export const SURFACE = { ...BASE_SURFACE, modal: FOREST.glass, raised: 0x293027, sunken: 0x141c18 };
export const BORDER = { ...BASE_BORDER, subtle: 0x575848, default: FOREST.border };
export const TEXT = { ...BASE_TEXT, primary: FOREST.text, secondary: FOREST.text, muted: FOREST.muted };
export function textStyle(...args: Parameters<typeof baseTextStyle>): ReturnType<typeof baseTextStyle> {
  const style = baseTextStyle(...args);
  if (typeof style.color === 'string' && /^#[0-9a-f]{6}$/i.test(style.color)) {
    style.color = '#' + skinTextColor('forest', parseInt(style.color.slice(1), 16)).toString(16).padStart(6, '0');
  }
  return style;
}

export function preloadForestModalAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.image(MODAL_FRAME_ASSET.key, MODAL_FRAME_ASSET.file);
}

/** Uniform source-to-display scale for every corner and every cropped rail repeat. */
export function drawModalFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement, w: number, h: number): void {
  const corner = image.width / 5;
  const cap = Math.min(120, w / 3, h / 3), scale = cap / corner;
  const sx = [0, corner, image.width - corner], sy = [0, corner, image.height - corner];
  const sw = [corner, image.width - corner * 2, corner], sh = [corner, image.height - corner * 2, corner];
  const dx = [0, cap, w - cap], dy = [0, cap, h - cap];
  const dw = [cap, w - cap * 2, cap], dh = [cap, h - cap * 2, cap];
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    if (row === 1 && col === 1) continue;
    for (let y = 0; y < dh[row]; y += sh[row] * scale) for (let x = 0; x < dw[col]; x += sw[col] * scale) {
      const width = Math.min(sw[col] * scale, dw[col] - x), height = Math.min(sh[row] * scale, dh[row] - y);
      ctx.drawImage(image, sx[col], sy[row], width / scale, height / scale, dx[col] + x, dy[row] + y, width, height);
    }
  }
}

export function ensureModalFrame(scene: Phaser.Scene, w: number, h: number): string {
  const key = `_forest_modal_frame_${MODAL_FRAME_ASSET.key}_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w * 2, h * 2)!;
  texture.context.scale(2, 2);
  if (scene.textures.exists(MODAL_FRAME_ASSET.key)) drawModalFrame(texture.context,
    scene.textures.get(MODAL_FRAME_ASSET.key).getSourceImage() as HTMLImageElement, w, h);
  texture.refresh();
  return key;
}

/** Same signature as the old surface helper, but isolated keys and no changes to lobby textures. */
export function ensureModalPanelTexture(scene: Phaser.Scene, _key: string, w: number, h: number,
  _base?: number, _accent?: number): string {
  return ensureRoundedTexture(scene, { key: `_forest_modal_glass_${w}x${h}`, w: w - 80, h: h - 80, radius: 24,
    topColor: FOREST.glass, bottomColor: SURFACE.sunken, fillAlpha: 0.92,
    strokeColor: FOREST.border, strokeAlpha: 0, strokeWidth: 0, highlightAlpha: 0.015 });
}

/** Existing image-button event/animation contracts are retained by using their forest face. */
export function ensureGlossyButtonTexture(scene: Phaser.Scene, _key: string, w: number, h: number,
  base: number, stroke?: number): string {
  const danger = base === INTENT.danger.fill || stroke === INTENT.danger.stroke;
  const attention = base === INTENT.primary.fill || base === INTENT.accent.fill || stroke === COLORS.GOLD_1;
  return ensureForestButton(scene, w, h, danger ? 'danger' : attention ? 'attention' : 'neutral', 'rest');
}

type ModalRecord = { root: Phaser.GameObjects.Container; w: number; h: number; backdrop: 'panel' | 'screen' };
const modalSurfaces = new WeakMap<Phaser.Scene, Set<ModalRecord>>();

/** Decoration is a sibling above content. Callers supply transient layers to keep above the frame. */
export function mountForestModal(scene: Phaser.Scene, root: Phaser.GameObjects.Container, w: number, h: number,
  transient: Phaser.GameObjects.GameObject[] = [], backdrop: 'panel' | 'screen' = 'panel'): Phaser.GameObjects.Image {
  const frame = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, ensureModalFrame(scene, w, h))
    .setDisplaySize(w, h).setScrollFactor(0);
  root.add(frame);
  for (const child of transient) root.bringToTop(child);
  const records = modalSurfaces.get(scene) ?? new Set<ModalRecord>();
  modalSurfaces.set(scene, records);
  const record = { root, w, h, backdrop };
  records.add(record);
  root.once('destroy', () => records.delete(record));
  return frame;
}

export function getForestModalSurfaces(scene: Phaser.Scene): BackdropSurface[] {
  return [...(modalSurfaces.get(scene) ?? [])].filter(({ root }) => root.visible && root.alpha > 0)
    .map(({ root, w, h, backdrop }) => backdrop === 'screen'
      ? { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT, radius: 0, alpha: root.alpha }
      : { x: (GAME_WIDTH - w) / 2 + 40 + root.x, y: (GAME_HEIGHT - h) / 2 + 40 + root.y,
        width: w - 80, height: h - 80, radius: 24, alpha: root.alpha });
}

export function toCssColor(color: number): string { return baseToCssColor(skinTextColor('forest', color)); }

export function ensureTintedSectionTexture(scene: Phaser.Scene, _key: string, w: number, h: number, accent: number, _base?: number): string {
  return ensureRoundedTexture(scene, { key: `_forest_section_${w}x${h}_${accent}`, w, h, radius: 16,
    topColor: SURFACE.raised, bottomColor: SURFACE.sunken, fillAlpha: .84, strokeColor: accent, strokeAlpha: .45,
    strokeWidth: 1.5, highlightAlpha: .02 });
}
