import type * as Phaser from 'phaser';
import { getPipelineAsset } from '../../config/pipelineAssets';
import manifest from '../../assets/manifests/base-structures.json';

/** Runtime emission layers of the fort: the glowing torch heads and fire-bowl coals. */
export type BaseFortLayer = 'forge';
export type BaseFortPass = 'beauty' | 'albedo' | 'elevation' | 'solid' | 'caster-height' | 'ground' | `emission-${BaseFortLayer}`;

export interface BaseFortSocket { readonly x: number; readonly y: number; readonly z: number }

/** The exported persistent base core; positions are game pixels relative to the centre cell's centre. */
export interface BaseFortAsset {
  readonly asset: string;
  readonly sourceSize: number;
  readonly displaySize: number;
  readonly heightPx: { readonly min: number; readonly max: number };
  /** Height of the decks turrets stand on, in px above the ground. */
  readonly deckPx?: number;
  readonly layers: readonly BaseFortLayer[];
  readonly sockets: Readonly<Record<string, BaseFortSocket>>;
  readonly sha256: Readonly<Record<string, string>>;
}

/** One kit sheet: a frame per corner-suppressed mask; frame sockets are display px from the cell centre. */
export interface BaseFortKitVariant {
  readonly asset: string;
  readonly frames: readonly { readonly mask: number; readonly sockets: Readonly<Record<string, BaseFortSocket>> }[];
  readonly sha256: Readonly<Record<string, string>>;
}

/**
 * The outpost kit: every variant sheet holds one 2 m frame per corner-suppressed cell mask in the same
 * order, `columns` frames per row, the cell centred in its frame. Cells pick their variant by position.
 */
export interface BaseFortKitAsset extends Omit<BaseFortAsset, 'sockets' | 'asset' | 'sha256'> {
  readonly columns: number;
  readonly framePx: number;
  readonly variants: readonly BaseFortKitVariant[];
}

const STRUCTURES = manifest.structures as unknown as Readonly<Record<string, unknown>>;

/** The art of the persistent base core, or null before it has been published. */
export function baseFortCoreAsset(): BaseFortAsset | null {
  return (STRUCTURES['persistent-core'] as BaseFortAsset | undefined) ?? null;
}

/** The outpost kit, or null before it has been published. */
export function baseFortKitAsset(): BaseFortKitAsset | null {
  return (STRUCTURES['outpost-kit'] as BaseFortKitAsset | undefined) ?? null;
}

export function baseFortTextureKey(asset: Pick<BaseFortAsset, 'asset'>, pass: BaseFortPass): string {
  return `base-fort:${asset.asset}:${pass}`;
}

function passes(asset: Pick<BaseFortAsset, 'layers'>, ground: boolean): BaseFortPass[] {
  return ['beauty', 'albedo', 'elevation', 'solid', 'caster-height', ...(ground ? ['ground' as const] : []),
    ...asset.layers.map(layer => `emission-${layer}` as const)];
}

function published(): { asset: Pick<BaseFortAsset, 'asset' | 'layers'>; ground: boolean }[] {
  const core = baseFortCoreAsset(), kit = baseFortKitAsset();
  return [...(core ? [{ asset: core, ground: true }] : []),
    ...(kit ? kit.variants.map(variant => ({ asset: { asset: variant.asset, layers: kit.layers }, ground: false })) : [])];
}

/** Same contract as the lobby structures: elevation and emission are data, read by the shaders. */
/** The stone plinth the fort lays under a turret on its deck (pipeline asset turret-plinth). */
export const TURRET_PLINTH = getPipelineAsset('turret-plinth');

export function preloadBaseFortAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const { asset, ground } of published()) for (const pass of passes(asset, ground)) {
    loader.image(baseFortTextureKey(asset, pass), `./assets/sprites/pipeline-v2/${asset.asset}/${pass}.png`);
  }
  loader.image(TURRET_PLINTH.textureKey, TURRET_PLINTH.idlePath);
}

/** True once every pass of the core and the outpost kit is loaded into the scene's texture manager. */
export function isBaseFortLoaded(scene: Phaser.Scene): boolean {
  const all = published();
  return all.length > 0 && !!scene.textures && scene.textures.exists(TURRET_PLINTH.textureKey)
    && all.every(({ asset, ground }) => passes(asset, ground).every(pass => scene.textures.exists(baseFortTextureKey(asset, pass))));
}
