/**
 * Gemalte Artwork des Utility-Rads: Waldboden-Ring, passender Nabenring und die Icons der
 * Verwaltungsaktionen, die kein eigenes Loadout-Icon besitzen.
 *
 * Der Atlas entsteht mit `scripts/export-radial-wheel.mjs` aus den Generator-Sheets unter
 * `output/imagegen/radial-wheel/`. Die Ringgeometrie (Mittelpunkt, Innen- und Außenkante des
 * Holzbands) ist dort gemessen und wird hier nur weitergereicht.
 */
import type * as Phaser from 'phaser';
import type { RadialManagementAction } from '../systems/RadialActionModel';
import exports from './radialWheelExports.json';

export const RADIAL_WHEEL_TEXTURE = 'radial_wheel';
export const RADIAL_RING_FRAME = 'ring';
export const RADIAL_HUB_FRAME = 'hub';

export interface RadialRingGeometry {
  /** Kantenlänge des quadratischen Frames in Quellpixeln. */
  readonly size: number;
  readonly centerX: number;
  readonly centerY: number;
  /** Innenkante des Bands inklusive farbigem Innensaum. */
  readonly innerRadius: number;
  /** Außenkante des Bands ohne einzelne Ornamente. */
  readonly outerRadius: number;
}

export const RADIAL_RING_GEOMETRY: RadialRingGeometry = exports.ring;
export const RADIAL_HUB_GEOMETRY: RadialRingGeometry = exports.hub;
export const RADIAL_ICON_SOURCE_SIZE = exports.iconSize;

export function preloadRadialWheelAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.atlas(RADIAL_WHEEL_TEXTURE, './assets/ui/radial-wheel/' + exports.file, exports.atlas);
}

export function radialManagementIconFrame(action: RadialManagementAction): string {
  return `icon-${action}`;
}
