import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { getPipelineAsset } from '../config/pipelineAssets';

/**
 * Geteilte Optik der Reparaturdrohnen.
 *
 * Der spielergebundene {@link RepairDroneRenderer} und die missionsgebundenen Drohnen der
 * Nebenmissionen sollen als dieselbe Technik erkennbar sein, ohne ihre Fachlogik zu teilen: Der eine
 * folgt einem Spieler samt Upgrade und repliziert seine Position, der andere ist eine rein lokale
 * Präsentation aus dem Objective-Zustand. Gemeinsam sind Artwork, Rotorclip, Tiefe und Strahlrezept.
 */
const ASSET = getPipelineAsset('repair-drone');
const FLIGHT_CLIP = ASSET.clips.find(clip => clip.name === 'move')!;
export const REPAIR_DRONE_DEPTH = DEPTH.PROJECTILES + 0.4;
/** Zeitkonstante der Positionsglättung in Millisekunden. */
export const REPAIR_DRONE_SMOOTH_TIME_MS = 48;

export function preloadRepairDroneAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.spritesheet(ASSET.sheetTextureKey, ASSET.sheetPath, ASSET.layout);
}

export function createRepairDroneBody(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, ASSET.sheetTextureKey, ASSET.idleFrame)
    .setOrigin(ASSET.pivot[0], ASSET.pivot[1])
    .setDisplaySize(32, 32)
    .setDepth(REPAIR_DRONE_DEPTH);
}

/** Sample the Blender impellers without rotating the hull or creating pooled animation timers. */
export function updateRepairDroneRotors(body: Phaser.GameObjects.Image, now: number, phaseOffsetMs = 0): void {
  const index = Math.floor(Math.max(0, now + phaseOffsetMs) * FLIGHT_CLIP.frameRate / 1000) % FLIGHT_CLIP.frames.length;
  body.setFrame(FLIGHT_CLIP.frames[index]);
}

/**
 * Zweilagiger Reparaturstrahl: breiter, kaum sichtbarer Streuanteil plus harter Kern. Der Aufrufer
 * hat die Grafik vorher geleert.
 */
export function drawRepairBeam(
  graphics: Phaser.GameObjects.Graphics,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  alpha = 1,
): void {
  graphics
    .lineStyle(7, 0x5dffac, 0.12 * alpha)
    .lineBetween(fromX, fromY, toX, toY)
    .lineStyle(2, 0xc8ffe4, 0.9 * alpha)
    .lineBetween(fromX, fromY, toX, toY);
}
