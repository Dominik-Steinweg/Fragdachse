import type * as Phaser from 'phaser';

/**
 * Ground cover tiers above the authored materials, in draw order (GROUND_COVER_TIERS): feathered
 * moss patches, flat forest litter, fine blade tufts and upright forest vegetation. Litter and
 * vegetation variants carry their own physical size; 1 cell = 32 px = 1 m.
 * Sources and reproducible export: scripts/generate-ground-cover-textures.mjs.
 *
 * Keep this module free of value imports: the export script reads the variant tables directly.
 */

const GROUND_COVER_ASSET_PATH = './assets/sprites/groundcover';

/**
 * Ankerklasse einer Platzierung.
 *
 * - `seam`     – beidseitig des Dirt/Gras-Uebergangs; der Schwerpunkt der Schicht.
 * - `dirt`     – Dirt-Innenflaeche.
 * - `grass`    – Gras-Innenflaeche, weit genug vom Dirt entfernt.
 * - `rockFoot` – freie Zelle direkt neben einem Felsen; nur fuer Stufen, die ihn konfigurieren.
 * - `bank`     – trockene Zelle direkt am Wasser (Uferboeschung); nur fuer Stufen, die ihn
 *                konfigurieren. Hat Vorrang vor `rockFoot`.
 */
export type GroundCoverAnchor = 'seam' | 'dirt' | 'grass' | 'rockFoot' | 'bank';

export interface GroundCoverVariantConfig {
  fileName: string;
  /** Relatives Gewicht innerhalb der fuer eine Ankerklasse zugelassenen Varianten. */
  frequencyPercent: number;
  /** Erlaubte Ankerklassen. Ohne Angabe: alle. */
  anchors?: readonly GroundCoverAnchor[];
  /** Eigene physische Groesse [min, max] in Zellen; ersetzt die Groesse der Ankerklasse. */
  sizeCells?: readonly [number, number];
  /** Quellserie unter tools/source-art/forest-detail; nur fuer den Export. */
  sourceSet?: string;
}

/**
 * Gruppierter Wuchs: Ein weltfestes, niederfrequentes Wachstumsfeld bildet unregelmaessige Inseln
 * und Baender. Dort entsteht je Anker ein Cluster aus mehreren Stempeln, meist derselben Art; in
 * den Freiflaechen dazwischen hoechstens vereinzelte Einzelstempel.
 */
export interface GroundCoverClusterConfig {
  /** Salt des Wachstumsfelds. Stufen mit demselben Salt wachsen in denselben Inseln. */
  fieldSalt: number;
  /** Typische Groesse der Inseln, in Zellen. */
  fieldCells: number;
  /** Wachstumsniveau, ab dem Cluster entstehen, und die Breite dieses Uebergangs. */
  threshold: number;
  softness: number;
  /** Mindestniveau an Felsfuss und Ufer: Strukturkanten bleiben verlaesslich bewachsen. */
  edgeFloor: number;
  /** Anteil der Anker, die in Freiflaechen noch einen Einzelstempel tragen. */
  sparse: number;
  /** Stempel je Cluster bei vollem Wachstum [min, max]. */
  members: readonly [number, number];
  /** Streuradius der Stempel um die Clustermitte, in Zellen. */
  radiusCells: number;
  /** Wahrscheinlichkeit, dass ein Stempel die Art des Clusters wiederholt. */
  coherence: number;
  /** Folgt den Freiflaechen statt den Inseln (z. B. offene Erde zwischen dem Bewuchs). */
  invert?: boolean;
}

export interface GroundCoverAnchorConfig {
  /** Erwartete Stempelzahl je Ankerblock; der Nachkommaanteil ist Wahrscheinlichkeit. */
  perBlock: number;
  minSizeCells: number;
  maxSizeCells: number;
  /** Exponent auf dem Groessen-Hash. Werte > 1 ziehen die Verteilung zur Untergrenze. */
  sizeBias: number;
  minAlpha: number;
  maxAlpha: number;
}

export interface GroundCoverLayerConfig {
  /** Hash salt of this tier, so tiers never share placement rolls. */
  seedSalt: number;
  /** Kantenlaenge eines Ankerblocks in Zellen. */
  blockCells: number;
  /** Maximale Zahl lokaler Anker-Slots je Block; der Gesamtumfang folgt aus dem Map-Raster. */
  maxPerBlock: number;
  /** Streuung des Ankers innerhalb seines Blocks, in Zellen. */
  jitterCells: number;
  seam: GroundCoverAnchorConfig;
  dirt: GroundCoverAnchorConfig;
  grass: GroundCoverAnchorConfig;
  /** Optional: eigene Dichte direkt am Felsfuss. Ohne Angabe gelten die Bodenklassen. */
  rockFoot?: GroundCoverAnchorConfig;
  /** Optional: eigene Dichte auf der Uferboeschung. Ohne Angabe gelten die Bodenklassen. */
  bank?: GroundCoverAnchorConfig;
  /** Optional: gruppierter Wuchs statt gleichmaessig verteilter Einzelstempel. */
  cluster?: GroundCoverClusterConfig;
  variants: readonly GroundCoverVariantConfig[];
}

/** Shared growth field of the clustered tiers: undergrowth, tufts and litter gather together. */
const GROWTH_FIELD_SALT = 0x51a7;

/** Compact blade tufts. Bounded placement density, independent of chunk residency and camera. */
export const GROUND_COVER_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0,
  blockCells: 2,
  maxPerBlock: 1,
  jitterCells: 1,
  seam: { perBlock: .45, minSizeCells: .5, maxSizeCells: 1.35, sizeBias: 1.5, minAlpha: .8, maxAlpha: 1 },
  dirt: { perBlock: .05, minSizeCells: .4, maxSizeCells: .9, sizeBias: 1.8, minAlpha: .7, maxAlpha: .95 },
  grass: { perBlock: .6, minSizeCells: .45, maxSizeCells: 1.1, sizeBias: 1.6, minAlpha: .75, maxAlpha: 1 },
  cluster: {
    fieldSalt: GROWTH_FIELD_SALT, fieldCells: 9, threshold: .5, softness: .1, edgeFloor: .7, sparse: .06,
    members: [3, 6], radiusCells: 1.2, coherence: .4,
  },
  variants: Array.from({ length: 8 }, (_, index) => ({
    fileName: `ground_cover_${String(index + 1).padStart(2, '0')}.png`, frequencyPercent: 12.5,
  })),
};

/**
 * Medium moss patches: thicker growth around the undergrowth that softens soil borders. They
 * follow the growth islands instead of dotting the lawn.
 */
export const GROUND_PATCH_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0x6a1d,
  blockCells: 4,
  maxPerBlock: 1,
  jitterCells: 2,
  seam: { perBlock: .6, minSizeCells: 2, maxSizeCells: 4, sizeBias: 1.4, minAlpha: .6, maxAlpha: .85 },
  dirt: { perBlock: .08, minSizeCells: 1.5, maxSizeCells: 2.6, sizeBias: 1.6, minAlpha: .5, maxAlpha: .75 },
  grass: { perBlock: .5, minSizeCells: 2, maxSizeCells: 4.5, sizeBias: 1.3, minAlpha: .55, maxAlpha: .85 },
  cluster: {
    fieldSalt: GROWTH_FIELD_SALT, fieldCells: 9, threshold: .44, softness: .12, edgeFloor: .6, sparse: .1,
    members: [1, 1], radiusCells: 0, coherence: 1,
  },
  variants: Array.from({ length: 16 }, (_, index) => ({
    fileName: `ground_patch_${String(index + 1).padStart(2, '0')}.png`, frequencyPercent: 6.25,
  })),
};

/** A variant from tools/source-art/forest-detail, exported as `forest_<source>.png`. */
function forestVariant(
  source: string,
  metres: number,
  frequencyPercent: number,
  anchors?: readonly GroundCoverAnchor[],
  sourceSet = 'candidates-01',
): GroundCoverVariantConfig {
  // Sources state the visible silhouette; the stamp adds a soft contact-shadow margin.
  return {
    fileName: `forest_${source}.png`, frequencyPercent, anchors, sizeCells: [metres * .95, metres * 1.3], sourceSet,
  };
}

/** Saturated forest-green set, painted for the current grass (candidates-02-green). */
function greenVariant(source: string, metres: number, frequencyPercent: number,
  anchors?: readonly GroundCoverAnchor[]): GroundCoverVariantConfig {
  return forestVariant(source, metres, frequencyPercent, anchors, 'candidates-02-green');
}

const LITTER_GROUND: readonly GroundCoverAnchor[] = ['dirt', 'seam', 'grass', 'bank'];
const STONE_GROUND: readonly GroundCoverAnchor[] = ['dirt', 'seam', 'rockFoot', 'bank'];

/** Flat forest litter: pebbles, twigs and leaves, mostly on soil and at rock feet. */
export const FOREST_LITTER_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0x1f7b,
  blockCells: 2,
  maxPerBlock: 1,
  jitterCells: 1,
  seam: { perBlock: .32, minSizeCells: .3, maxSizeCells: .6, sizeBias: 1, minAlpha: .95, maxAlpha: 1 },
  dirt: { perBlock: .45, minSizeCells: .3, maxSizeCells: .6, sizeBias: 1, minAlpha: .95, maxAlpha: 1 },
  grass: { perBlock: .05, minSizeCells: .3, maxSizeCells: .6, sizeBias: 1, minAlpha: .9, maxAlpha: 1 },
  rockFoot: { perBlock: .75, minSizeCells: .3, maxSizeCells: .6, sizeBias: 1, minAlpha: 1, maxAlpha: 1 },
  // Washed-up pebbles and drift twigs along the waterline.
  bank: { perBlock: .6, minSizeCells: .3, maxSizeCells: .6, sizeBias: 1, minAlpha: 1, maxAlpha: 1 },
  // Litter gathers under and around the undergrowth, a little wider than the plants themselves.
  cluster: {
    fieldSalt: GROWTH_FIELD_SALT, fieldCells: 9, threshold: .42, softness: .12, edgeFloor: .7, sparse: .15,
    members: [2, 4], radiusCells: 1.1, coherence: .5,
  },
  variants: [
    // Pebbles about 1.6x their source size: at game zoom and night light a true 10 cm stone
    // is a single dark pixel.
    forestVariant('stone-01-round', .2, 9, STONE_GROUND),
    forestVariant('stone-02-angular', .42, 9, STONE_GROUND),
    forestVariant('stone-03-pair', .38, 8, STONE_GROUND),
    forestVariant('stone-04-flat', .34, 8, STONE_GROUND),
    forestVariant('stone-05-small-group', .46, 8, STONE_GROUND),
    forestVariant('twig-01-fork', .65, 6, LITTER_GROUND),
    forestVariant('twig-02-bent', .45, 6, LITTER_GROUND),
    forestVariant('twig-03-crossing', .8, 4, LITTER_GROUND),
    forestVariant('twig-04-small-branch', 1, 4, LITTER_GROUND),
    forestVariant('twig-05-splinter', .3, 6, LITTER_GROUND),
    forestVariant('leaf-01-oak', .18, 7, LITTER_GROUND),
    forestVariant('leaf-02-pair', .3, 7, LITTER_GROUND),
    forestVariant('leaf-03-fragments', .4, 6, LITTER_GROUND),
    forestVariant('leaf-04-folded', .22, 6, LITTER_GROUND),
    forestVariant('leaf-05-mixed', .5, 6, LITTER_GROUND),
  ],
};

const PLANT_GROUND: readonly GroundCoverAnchor[] = ['grass', 'seam', 'rockFoot'];
const FLOWER_GROUND: readonly GroundCoverAnchor[] = ['grass', 'seam'];

/**
 * Upright forest vegetation: grass clumps, ferns and herbs, flower groups. Grows in clusters on
 * the shared growth islands and bands, with calm open ground in between.
 */
export const FOREST_VEGETATION_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0x3c55,
  blockCells: 3,
  maxPerBlock: 1,
  jitterCells: 1.2,
  seam: { perBlock: 1, minSizeCells: 1, maxSizeCells: 2, sizeBias: 1, minAlpha: 1, maxAlpha: 1 },
  dirt: { perBlock: .12, minSizeCells: 1, maxSizeCells: 2, sizeBias: 1, minAlpha: 1, maxAlpha: 1 },
  grass: { perBlock: 1, minSizeCells: 1, maxSizeCells: 2, sizeBias: 1, minAlpha: 1, maxAlpha: 1 },
  rockFoot: { perBlock: .8, minSizeCells: 1, maxSizeCells: 2, sizeBias: 1, minAlpha: 1, maxAlpha: 1 },
  // Grass clumps and sedges fringe the water; ferns and flowers stay on firmer ground.
  bank: { perBlock: 1, minSizeCells: 1, maxSizeCells: 2, sizeBias: 1, minAlpha: 1, maxAlpha: 1 },
  cluster: {
    fieldSalt: GROWTH_FIELD_SALT, fieldCells: 9, threshold: .52, softness: .08, edgeFloor: .75, sparse: .05,
    members: [4, 9], radiusCells: 1.6, coherence: .7,
  },
  variants: [
    // Green set: the main undergrowth. Grass clumps carry the clusters, herbs and ferns vary them.
    greenVariant('grass-01-compact-fans', 1, 2.7),
    greenVariant('grass-02-open-clump', .85, 3.3),
    greenVariant('grass-03-wide-fan', 1.45, 2.75),
    greenVariant('grass-04-split-crown', 1.5, 2.75),
    greenVariant('grass-05-swept-blades', 1.25, 2.75),
    greenVariant('grass-06-small-crescent', .9, 3.3),
    greenVariant('grass-07-soft-sedge', 1.6, 2.75),
    greenVariant('grass-08-low-mat', 1.35, 2.75),
    greenVariant('grass-09-young-tuft', .65, 3.3),
    greenVariant('grass-10-three-fans', 1.75, 2.2),
    greenVariant('grass-11-curling-blades', 1.2, 2.75),
    greenVariant('grass-12-short-rosette', 1, 3.3),
    greenVariant('grass-13-edge-tuft', 1.55, 2.75),
    greenVariant('grass-14-cross-growth', 1.3, 2.75),
    greenVariant('grass-15-lush-compact', 1.4, 3.3),
    greenVariant('grass-16-long-open', 1.9, 2.2),
    greenVariant('fern-01-uneven-star', 1.6, 1.3, PLANT_GROUND),
    greenVariant('fern-02-side-spread', 1.9, 0.9, PLANT_GROUND),
    greenVariant('fern-03-young-four', .85, 1.65, PLANT_GROUND),
    greenVariant('fern-04-twin-growth', 1.75, 0.9, PLANT_GROUND),
    greenVariant('fern-05-curving', 1.5, 1.3, PLANT_GROUND),
    greenVariant('fern-06-broad-fronds', 2.1, 0.55, PLANT_GROUND),
    greenVariant('fern-07-low-fan', 1.25, 1.3, PLANT_GROUND),
    greenVariant('fern-08-narrow-fronds', 1.55, 1.1, PLANT_GROUND),
    greenVariant('plant-01-lance-leaves', 1.1, 2.2, PLANT_GROUND),
    greenVariant('plant-02-round-leaves', .85, 2.75, PLANT_GROUND),
    greenVariant('plant-03-lobed-leaves', 1.3, 2.2, PLANT_GROUND),
    greenVariant('plant-04-long-rosette', 1.2, 2.2, PLANT_GROUND),
    greenVariant('plant-05-creeping', 1.4, 2.2, PLANT_GROUND),
    greenVariant('plant-06-three-leaf', .75, 2.75, PLANT_GROUND),
    greenVariant('plant-07-broad-asymmetric', 1.5, 1.65, PLANT_GROUND),
    greenVariant('plant-08-small-paired', .7, 2.75, PLANT_GROUND),
    // First set: kept for variety, now secondary.
    forestVariant('grass-01-compact', 1.1, 1.65),
    forestVariant('grass-02-wide-fan', 1.8, 1.1),
    forestVariant('grass-03-star', 1.6, 1.1),
    forestVariant('grass-04-leaning', 1.5, 1.1),
    forestVariant('grass-05-sedge', 2, 1.1),
    forestVariant('grass-06-small-open', 1, 1.65),
    forestVariant('grass-07-dry-tips', 1.7, 1.1),
    forestVariant('grass-08-two-crowns', 1.9, 1.1),
    forestVariant('grass-09-curled', 1.4, 1.1),
    forestVariant('grass-10-forest-green', 1.8, 1.65),
    forestVariant('plant-01-fern-star', 1.8, 0.55, PLANT_GROUND),
    forestVariant('plant-02-fern-asymmetric', 2.3, 0.35, PLANT_GROUND),
    forestVariant('plant-03-fern-young', 1.1, 0.9, PLANT_GROUND),
    forestVariant('plant-04-fern-spreading', 2.5, 0.35, PLANT_GROUND),
    forestVariant('plant-05-lance-rosette', 1.4, 1.1, PLANT_GROUND),
    forestVariant('plant-06-broad-rosette', 1.7, 1.1, PLANT_GROUND),
    forestVariant('plant-07-split-leaves', 2, 0.9, PLANT_GROUND),
    forestVariant('plant-08-narrow-star', 1.3, 1.1, PLANT_GROUND),
    forestVariant('flowers-01-white-three', .45, 1.65, FLOWER_GROUND),
    forestVariant('flowers-02-white-five', .75, 1.1, FLOWER_GROUND),
    forestVariant('flowers-03-yellow-three', .35, 1.65, FLOWER_GROUND),
    forestVariant('flowers-04-yellow-five', .65, 1.1, FLOWER_GROUND),
    forestVariant('flowers-05-pink-three', .4, 1.1, FLOWER_GROUND),
    forestVariant('flowers-06-pink-five', .8, 1.1, FLOWER_GROUND),
  ],
};

/**
 * Share of layout grass decals (16-px flowers, bushes, pebbles) kept on open ground outside the
 * growth islands. Their layout density is uniform; presentation gathers them with the undergrowth.
 */
export const GRASS_DECAL_OPEN_GROUND_KEEP = .12;
/** Growth level from which grass decals count as part of an island (about 40 % of the area). */
export const GRASS_DECAL_GROWTH_THRESHOLD = .5;

/** A flat large ground surface from tools/source-art/groundcover, exported as `ground_area_<source>.png`. */
function areaVariant(source: string, diameterMetres: number, frequencyPercent: number): GroundCoverVariantConfig {
  return {
    fileName: `ground_area_${source}.png`, frequencyPercent, sizeCells: [diameterMetres * .85, diameterMetres * 1.1],
    sourceSet: 'candidates-01-large-green',
  };
}

/**
 * Large green surfaces (moss, clover, creeping ground cover, 2-7 m radius) below the undergrowth.
 * They follow the growth field with a lower threshold than the plants, so the vegetation islands
 * stand on a carpet that reaches a little beyond them. Few, large stamps keep the lawn calm.
 */
export const GROUND_AREA_GREEN_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0x2a61,
  blockCells: 8,
  maxPerBlock: 1,
  jitterCells: 3,
  seam: { perBlock: .7, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .7, maxAlpha: .9 },
  dirt: { perBlock: .1, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .6, maxAlpha: .8 },
  grass: { perBlock: .95, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .75, maxAlpha: .95 },
  rockFoot: { perBlock: .7, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .75, maxAlpha: .95 },
  bank: { perBlock: .6, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .75, maxAlpha: .95 },
  cluster: {
    fieldSalt: GROWTH_FIELD_SALT, fieldCells: 9, threshold: .42, softness: .12, edgeFloor: .6, sparse: .06,
    members: [1, 1], radiusCells: 0, coherence: 1,
  },
  variants: [
    areaVariant('moss-01-soft-colony', 5, 9),
    areaVariant('moss-02-broken-islands', 8, 9),
    areaVariant('moss-03-creeping-band', 11, 8),
    areaVariant('moss-04-wide-carpet', 14, 7),
    areaVariant('clover-01-open-colony', 4, 9),
    areaVariant('clover-02-dense-pockets', 7, 8),
    areaVariant('clover-03-creeping-crescent', 10, 7),
    areaVariant('clover-04-broad-mosaic', 13, 6),
    areaVariant('cover-01-round-leaf-runners', 5, 9),
    areaVariant('cover-02-small-lobed-leaves', 8, 8),
    areaVariant('cover-03-moss-and-sorrel', 11, 10),
    areaVariant('cover-04-broad-creeping-mat', 14, 10),
  ],
};

/**
 * Large soil and litter surfaces on the open ground between the growth islands and along soil
 * seams. Translucent, so they only break up wide calm lawn without adding detail noise.
 */
export const GROUND_AREA_SOIL_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0x2a67,
  blockCells: 9,
  maxPerBlock: 1,
  jitterCells: 3.5,
  seam: { perBlock: .6, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .55, maxAlpha: .8 },
  dirt: { perBlock: .45, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .5, maxAlpha: .75 },
  grass: { perBlock: .55, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1, minAlpha: .45, maxAlpha: .7 },
  cluster: {
    fieldSalt: GROWTH_FIELD_SALT, fieldCells: 9, threshold: .5, softness: .1, edgeFloor: 0, sparse: 0,
    members: [1, 1], radiusCells: 0, coherence: 1, invert: true,
  },
  variants: [
    areaVariant('soil-01-worn-earth', 4, 25),
    areaVariant('soil-02-humus-moss', 7, 28),
    areaVariant('soil-03-fine-leaf-litter', 10, 27),
    areaVariant('soil-04-dry-soil-islands', 13, 20),
  ],
};

/** Draw order: large soil and green surfaces, moss patches, litter, blade tufts, vegetation on top. */
export const GROUND_COVER_TIERS: readonly GroundCoverLayerConfig[] = [
  GROUND_AREA_SOIL_CONFIG, GROUND_AREA_GREEN_CONFIG, GROUND_PATCH_CONFIG, FOREST_LITTER_CONFIG,
  GROUND_COVER_CONFIG, FOREST_VEGETATION_CONFIG,
];

/**
 * Obergrenze des Blockrasters fuer eine konkrete Map. Sie skaliert mit der Mapflaeche und ist
 * deshalb keine globale, auf kleine Arenen zugeschnittene Placement-Grenze.
 */
export function getGroundCoverPlacementBudget(
  gridCols: number,
  gridRows: number,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): number {
  if (gridCols <= 0 || gridRows <= 0) return 0;
  return Math.ceil(gridCols / config.blockCells)
    * Math.ceil(gridRows / config.blockCells)
    * Math.ceil(config.maxPerBlock)
    * (config.cluster?.members[1] ?? 1);
}

export function getGroundCoverTextureKey(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** Alle fuer eine Ankerklasse zugelassenen Varianten, in Tabellenreihenfolge. */
export function getGroundCoverVariantsForAnchor(
  anchor: GroundCoverAnchor,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): readonly GroundCoverVariantConfig[] {
  return config.variants.filter((variant) => !variant.anchors || variant.anchors.includes(anchor));
}

export function getGroundCoverAnchorConfig(
  anchor: GroundCoverAnchor,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): GroundCoverAnchorConfig | undefined {
  return config[anchor];
}

export function preloadGroundCoverAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const tier of GROUND_COVER_TIERS) for (const variant of tier.variants) {
    loader.image(getGroundCoverTextureKey(variant.fileName), `${GROUND_COVER_ASSET_PATH}/${variant.fileName}`);
  }
}
