import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { ensureCanvasTexture } from './EffectUtils';

/**
 * Geteilte Optik der Reparaturdrohnen.
 *
 * Der spielergebundene {@link RepairDroneRenderer} und die missionsgebundenen Drohnen der
 * Nebenmissionen sollen als dieselbe Technik erkennbar sein, ohne ihre Fachlogik zu teilen: Der eine
 * folgt einem Spieler samt Upgrade und repliziert seine Position, der andere ist eine rein lokale
 * Präsentation aus dem Objective-Zustand. Gemeinsam sind nur Textur, Tiefe und Strahlrezept.
 */
export const REPAIR_DRONE_TEXTURE_KEY = '__repair_drone';
export const REPAIR_DRONE_DEPTH = DEPTH.PROJECTILES + 0.4;
/** Zeitkonstante der Positionsglättung in Millisekunden. */
export const REPAIR_DRONE_SMOOTH_TIME_MS = 48;

/** Idempotent: Beide Renderer dürfen die Textur anfordern. */
export function ensureRepairDroneTexture(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, REPAIR_DRONE_TEXTURE_KEY, 32, 32, (ctx) => {
    ctx.translate(16, 16);
    ctx.fillStyle = '#26343c';
    ctx.strokeStyle = '#bcebd4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7fffc1';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8297a1';
    ctx.lineWidth = 3;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 6, Math.sin(angle) * 6);
      ctx.lineTo(Math.cos(angle) * 12, Math.sin(angle) * 12);
      ctx.stroke();
    }
    ctx.strokeStyle = '#d5f5e6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-12, 0, 3, 0, Math.PI * 2);
    ctx.moveTo(15, 0);
    ctx.arc(12, 0, 3, 0, Math.PI * 2);
    ctx.moveTo(3, -12);
    ctx.arc(0, -12, 3, 0, Math.PI * 2);
    ctx.moveTo(3, 12);
    ctx.arc(0, 12, 3, 0, Math.PI * 2);
    ctx.stroke();
  });
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
