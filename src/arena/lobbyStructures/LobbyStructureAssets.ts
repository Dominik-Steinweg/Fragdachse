import type * as Phaser from 'phaser';
import manifest from '../../assets/manifests/lobby-structures.json';

/** Runtime emission layers; each has its own gate (the forge burns by day, lamps follow the night). */
export type LobbyStructureLayer = 'forge' | 'lamp' | 'cyan';
export type LobbyStructurePass = 'beauty' | 'albedo' | 'elevation' | 'solid' | `emission-${LobbyStructureLayer}`;

export interface LobbyStructureSocket { readonly x: number; readonly y: number; readonly z: number }

/** One exported structure; positions are game pixels local to the structure's grid origin. */
export interface LobbyStructureAsset {
  readonly asset: string;
  readonly sourceSize: number;
  readonly displaySize: number;
  /** Top-left of the square canvas relative to the structure origin. */
  readonly canvasOffset: { readonly x: number; readonly y: number };
  readonly turn: number;
  readonly heightPx: { readonly min: number; readonly max: number };
  readonly layers: readonly LobbyStructureLayer[];
  readonly sockets: Readonly<Record<string, LobbyStructureSocket>>;
  readonly sha256: Readonly<Record<string, string>>;
}

export const LOBBY_STRUCTURE_ASSETS = manifest.structures as Readonly<Record<string, LobbyStructureAsset>>;

export function lobbyStructureAsset(structureId: string): LobbyStructureAsset | null {
  return LOBBY_STRUCTURE_ASSETS[structureId] ?? null;
}

export function lobbyStructureTextureKey(asset: LobbyStructureAsset, pass: LobbyStructurePass): string {
  return `lobby-structure:${asset.asset}:${pass}`;
}

function passes(asset: LobbyStructureAsset): LobbyStructurePass[] {
  return ['beauty', 'albedo', 'elevation', 'solid', ...asset.layers.map(layer => `emission-${layer}` as const)];
}

/** The elevation and emission PNGs are data: the shaders unpremultiply them themselves. */
export function preloadLobbyStructureAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of Object.values(LOBBY_STRUCTURE_ASSETS)) {
    for (const pass of passes(asset)) {
      loader.image(lobbyStructureTextureKey(asset, pass), `./assets/sprites/pipeline-v2/${asset.asset}/${pass}.png`);
    }
  }
}
