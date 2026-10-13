import type * as Phaser from 'phaser';
import { getPipelineAsset } from '../../config/pipelineAssets';

export const FIRE_CONTROL_RELAY = getPipelineAsset('fire-control-relay');
export const FIRE_CONTROL_RELAY_SIZE = 24;

/** Shared texture cache; the shader warmup requests this before the first deployment. */
export function ensureFireControlRelayAssets(scene: Phaser.Scene): boolean {
  const asset = FIRE_CONTROL_RELAY;
  if (scene.textures.exists(asset.sheetTextureKey)) return true;
  scene.load.spritesheet(asset.sheetTextureKey, asset.sheetPath, {
    ...asset.layout, endFrame: asset.layout.frameCount - 1,
  });
  if (!scene.load.isLoading()) scene.load.start();
  return false;
}

/** Host age also handles late snapshots and frame stepping without scene-clock drift. */
export function fireControlRelayFrame(ageMs: number): number {
  const deploy = FIRE_CONTROL_RELAY.clips.find(c => c.name === 'deploy')!;
  const age = Math.max(0, ageMs), duration = deploy.frames.length / deploy.frameRate * 1000;
  if (age < duration) return deploy.frames[Math.floor(age * deploy.frameRate / 1000)];
  const idle = FIRE_CONTROL_RELAY.clips.find(c => c.name === 'idle')!;
  return idle.frames[Math.floor((age - duration) * idle.frameRate / 1000) % idle.frames.length];
}
