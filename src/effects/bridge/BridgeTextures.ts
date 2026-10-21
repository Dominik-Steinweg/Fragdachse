import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import { getPipelineAsset } from '../../config/pipelineAssets';
import { ensureCanvasTexture } from '../EffectUtils';
import { BRIDGE_KIT_ABUTMENT_PX, BRIDGE_KIT_CANVAS_PX, BRIDGE_KIT_RAIL_PX, drawBridgeKit, planBridgeKitPieces } from './BridgeKit';

/** Stone abutment band drawn onto the bank at both deck ends, in px. */
export const BRIDGE_ABUTMENT_OVERHANG_PX = BRIDGE_KIT_ABUTMENT_PX;
/** Railing beams overhang the deck edges slightly, in px. */
export const BRIDGE_RAIL_OVERHANG_PX = BRIDGE_KIT_RAIL_PX;
/** Soft contact shadow margin around the deck, in px. */
export const BRIDGE_SHADOW_MARGIN_PX = 10;

/** Pipeline assets of the demolition bridges (scripts/asset-pipeline/catalog-v2/assets). */
export const BRIDGE_PIPELINE_ASSET_IDS = {
  /** Kit masters the decks are cut from (BridgeKit.ts). */
  standing: 'bridge-wood', ruin: 'bridge-wood-ruin',
  /** Open dynamite crate, on the ground and carried. */
  crate: 'explosive-crate',
  /** Planted bundle; its fuse ends where the renderer's spark burns. */
  charge: 'bridge-charge',
} as const;

export function preloadBridgeAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const id of Object.values(BRIDGE_PIPELINE_ASSET_IDS)) {
    const asset = getPipelineAsset(id);
    loader.image(asset.textureKey, asset.idlePath);
  }
}

type KitImage = CanvasImageSource & { width: number };

/** Loaded kit masters; an absent master falls back to a plain drawn deck. */
export interface BridgeKitMasters {
  readonly standing: KitImage | null;
  readonly ruin: KitImage | null;
}

export function resolveBridgeKitMasters(textures: Phaser.Textures.TextureManager): BridgeKitMasters {
  const source = (id: string) => {
    const key = getPipelineAsset(id).textureKey;
    return textures.exists(key) ? textures.get(key).getSourceImage() as KitImage : null;
  };
  return { standing: source(BRIDGE_PIPELINE_ASSET_IDS.standing), ruin: source(BRIDGE_PIPELINE_ASSET_IDS.ruin) };
}

/** Display size of a bridge texture drawn for horizontal travel (rotated for vertical bridges). */
export function bridgeTextureSize(spanCells: number, deckWidthCells: number): { width: number; height: number } {
  return {
    width: spanCells * CELL_SIZE + BRIDGE_ABUTMENT_OVERHANG_PX * 2,
    height: deckWidthCells * CELL_SIZE + BRIDGE_RAIL_OVERHANG_PX * 2,
  };
}

/** Plain stand-in when a kit master did not load: boards, rails and stone ends without detail. */
function drawFallback(ctx: CanvasRenderingContext2D, width: number, height: number, collapsed: boolean): void {
  const over = BRIDGE_ABUTMENT_OVERHANG_PX, rail = BRIDGE_RAIL_OVERHANG_PX;
  ctx.fillStyle = '#77736a';
  ctx.fillRect(0, 0, over + 4, height);
  ctx.fillRect(width - over - 4, 0, over + 4, height);
  if (collapsed) {
    ctx.fillStyle = '#3a2d21';
    ctx.fillRect(over + 4, rail + 4, 10, height - rail * 2 - 8);
    ctx.fillRect(width - over - 14, rail + 4, 10, height - rail * 2 - 8);
    return;
  }
  for (let x = over; x < width - over; x += 6) {
    ctx.fillStyle = (x / 6) % 2 ? '#7a6550' : '#6f5c48';
    ctx.fillRect(x, rail, 5, height - rail * 2);
  }
  ctx.fillStyle = '#5a4634';
  ctx.fillRect(over - 2, 0, width - over * 2 + 4, 4);
  ctx.fillRect(over - 2, height - 4, width - over * 2 + 4, 4);
}

function ensureKitTexture(textures: Phaser.Textures.TextureManager, key: string, spanCells: number, deckWidthCells: number,
  seedText: string, master: KitImage | null, collapsed: boolean): void {
  const { width, height } = bridgeTextureSize(spanCells, deckWidthCells);
  // Assemble at the master's own resolution; the image is shown at display size.
  const scale = master ? master.width / BRIDGE_KIT_CANVAS_PX : 1;
  ensureCanvasTexture(textures, key, Math.round(width * scale), Math.round(height * scale), (ctx) => {
    if (master) drawBridgeKit(ctx, master, planBridgeKitPieces(spanCells, deckWidthCells, seedText), scale);
    else drawFallback(ctx, width, height, collapsed);
  });
}

/** Standing deck: weathered boards between masonry abutments, railings along both edges. */
export function ensureBridgeDeckTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number, seedText: string, masters: BridgeKitMasters): void {
  ensureKitTexture(textures, key, spanCells, deckWidthCells, seedText, masters.standing, false);
}

/** Collapsed bridge: charred stubs on both abutments, broken piles and drifting boards in between. */
export function ensureBridgeRuinTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number, seedText: string, masters: BridgeKitMasters): void {
  // The same seed keeps the ruin's middle cells under the deck cells they replace.
  ensureKitTexture(textures, key, spanCells, deckWidthCells, seedText, masters.ruin, true);
}

/** Soft contact shadow the deck throws onto the water around it. */
export function ensureBridgeShadowTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number): void {
  const { width, height } = bridgeTextureSize(spanCells, deckWidthCells);
  const margin = BRIDGE_SHADOW_MARGIN_PX;
  ensureCanvasTexture(textures, key, width + margin * 2, height + margin * 2, (ctx) => {
    ctx.filter = 'blur(5px)';
    ctx.fillStyle = 'rgba(6,10,12,0.85)';
    ctx.fillRect(margin + BRIDGE_ABUTMENT_OVERHANG_PX, margin - 1, width - BRIDGE_ABUTMENT_OVERHANG_PX * 2, height + 2);
    ctx.filter = 'none';
  });
}
