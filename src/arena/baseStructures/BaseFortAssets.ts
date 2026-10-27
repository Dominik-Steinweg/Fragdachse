import type * as Phaser from 'phaser';
import manifest from '../../assets/manifests/base-structures.json';

/** Runtime emission layers of the fort: torch embers and lantern glass. */
export type BaseFortLayer = 'forge' | 'lamp';
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

const STRUCTURES = manifest.structures as Readonly<Record<string, BaseFortAsset>>;

/** The art of the persistent base core, or null before it has been published. */
export function baseFortCoreAsset(): BaseFortAsset | null {
  return STRUCTURES['persistent-core'] ?? null;
}

export function baseFortTextureKey(asset: BaseFortAsset, pass: BaseFortPass): string {
  return `base-fort:${asset.asset}:${pass}`;
}

function passes(asset: BaseFortAsset): BaseFortPass[] {
  return ['beauty', 'albedo', 'elevation', 'solid', 'caster-height', 'ground', ...asset.layers.map(layer => `emission-${layer}` as const)];
}

/** Same contract as the lobby structures: elevation and emission are data, read by the shaders. */
export function preloadBaseFortAssets(loader: Phaser.Loader.LoaderPlugin): void {
  const asset = baseFortCoreAsset();
  if (!asset) return;
  for (const pass of passes(asset)) loader.image(baseFortTextureKey(asset, pass), `./assets/sprites/pipeline-v2/${asset.asset}/${pass}.png`);
}

/** True once every pass of the core is loaded into the scene's texture manager. */
export function isBaseFortLoaded(scene: Phaser.Scene): boolean {
  const asset = baseFortCoreAsset();
  return !!asset && !!scene.textures && passes(asset).every(pass => scene.textures.exists(baseFortTextureKey(asset, pass)));
}
