import type * as Phaser from 'phaser';
import manifest from '../../assets/manifests/portal-generator.json';
import { getPipelineAsset } from '../../config/pipelineAssets';

export const PORTAL_GENERATOR_ASSET = getPipelineAsset('portal-generator');
export const PORTAL_GENERATOR_DISPLAY_SIZE = manifest.displaySize;
export const PORTAL_GENERATOR_EMISSIVE_CORE = manifest.emissive.core.key;
export const PORTAL_GENERATOR_EMISSIVE_FLOW = manifest.emissive.flow.key;

export type PortalGeneratorState = 'intact' | 'damaged' | 'rubble';
export type PortalGeneratorOutlet = 'north' | 'east' | 'south' | 'west';

/** Below this share of its HP the generator shows its damaged frame. */
export const PORTAL_GENERATOR_DAMAGED_HP_SHARE = 0.5;

/** The sheet and both emissive passes share one layout; all three load on first use. */
export function ensurePortalGeneratorAssets(scene: Phaser.Scene): boolean {
  const layout = { ...PORTAL_GENERATOR_ASSET.layout, endFrame: PORTAL_GENERATOR_ASSET.layout.frameCount - 1 };
  const sheets: readonly [string, string][] = [
    [PORTAL_GENERATOR_ASSET.sheetTextureKey, PORTAL_GENERATOR_ASSET.sheetPath],
    [PORTAL_GENERATOR_EMISSIVE_CORE, manifest.emissive.core.path],
    [PORTAL_GENERATOR_EMISSIVE_FLOW, manifest.emissive.flow.path],
  ];
  const missing = sheets.filter(([key]) => !scene.textures.exists(key));
  if (missing.length === 0) return true;
  for (const [key, path] of missing) scene.load.spritesheet(key, path, layout);
  if (!scene.load.isLoading()) scene.load.start();
  return false;
}

export function portalGeneratorFrame(state: PortalGeneratorState, outlet: PortalGeneratorOutlet): number {
  return manifest.states.indexOf(state) * manifest.outlets.length + manifest.outlets.indexOf(outlet);
}

/** Outlet front in world pixels from the generator centre (manifest sockets are frame-normalized). */
export function portalGeneratorOutletOffset(outlet: PortalGeneratorOutlet): { readonly x: number; readonly y: number } {
  const frame = manifest.frames[portalGeneratorFrame('intact', outlet)];
  return { x: (frame.sockets.outlet.x - 0.5) * PORTAL_GENERATOR_DISPLAY_SIZE,
    y: (frame.sockets.outlet.y - 0.5) * PORTAL_GENERATOR_DISPLAY_SIZE };
}

/** The outlet faces the portal entry along the dominant axis. */
export function resolvePortalGeneratorOutlet(from: { x: number; y: number }, toward: { x: number; y: number }): PortalGeneratorOutlet {
  const dx = toward.x - from.x, dy = toward.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

export function resolvePortalGeneratorState(hp: number | null, maxHp: number | null, destroyed: boolean): PortalGeneratorState {
  if (destroyed) return 'rubble';
  return hp !== null && maxHp !== null && maxHp > 0 && hp / maxHp < PORTAL_GENERATOR_DAMAGED_HP_SHARE ? 'damaged' : 'intact';
}
