import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, GRID_COLS, GRID_ROWS } from '../config';
import type { DecalCell, DirtCell } from '../types';
import type { ArenaVisualGridMetrics } from './ArenaVisualFactory';
import { hashSeededCell01 } from './CellHash';
import {
  GROUND_COVER_TIERS,
  getGroundCoverPlacementBudget,
  getGroundCoverTextureKey,
  getGroundCoverVariantsForAnchor,
} from './GroundCoverConfig';
import type {
  GroundCoverAnchor, GroundCoverClusterConfig, GroundCoverLayerConfig, GroundCoverVariantConfig,
} from './GroundCoverConfig';
import {
  FOREST_VEGETATION_CONFIG, GRASS_DECAL_GROWTH_THRESHOLD, GRASS_DECAL_OPEN_GROUND_KEEP,
} from './GroundCoverConfig';

/**
 * Platzierung der Ground-Cover-Schicht: deterministisch aus Seed und Dirt-Geometrie, ohne jede
 * Phaser-Abhaengigkeit und damit direkt testbar.
 *
 * Die Schicht ist bewusst kein Teil von `ArenaLayout.decals`. Decals sind zellgebundene 16-px-
 * Marken mit eigenem Netzwerk- und Rehydrierungsvertrag; diese Bueschel variieren in ihrer Groesse,
 * liegen absichtlich neben ihrer Ankerzelle und werden auf jedem Peer beim Backen neu abgeleitet.
 * `layout.seed` und `layout.dirt` stehen dafuer ueberall zur Verfuegung, am Wire-Format aendert
 * sich nichts.
 */

/** Gemeinsame Geometrie fuer alle deterministischen Texture-Stamps im Ground-Surface-Bake. */
export interface GroundCoverStampPlacement {
  textureKey: string;
  worldX: number;
  worldY: number;
  /** Laengere Kante in Weltpixeln; die kuerzere folgt dem Seitenverhaeltnis der Textur. */
  sizePx: number;
  rotation: number;
  alpha: number;
  mirrorX: boolean;
  mirrorY: boolean;
}

export interface GroundCoverPlacement extends GroundCoverStampPlacement {
  /** Ankerklasse der Platzierung. Nur fuer Tests und Diagnose. */
  anchor: GroundCoverAnchor;
}

export interface GroundCoverFieldOptions {
  seed: number;
  dirt: readonly DirtCell[];
  /** Rahmen und Gittergroesse. Ohne Angabe gilt der globale Kompatibilitaetsrahmen. */
  metrics?: ArenaVisualGridMetrics;
  config?: GroundCoverLayerConfig;
  /** Zellen, auf denen kein Anker liegen darf (z. B. UI-Reservezonen der LobbyWorld). */
  excludeCell?: (gridX: number, gridY: number) => boolean;
  /**
   * Authored Felszellen. Auf ihnen liegt kein Anker (der Fels verdeckt ihn ohnehin); ihre freien
   * Nachbarzellen bilden den Anker `rockFoot` fuer Stufen, die ihn konfigurieren.
   */
  rocks?: readonly { gridX: number; gridY: number }[];
  /**
   * Water cells. They carry no anchor; their dry neighbours form the anchor `bank` for tiers
   * that configure it.
   */
  water?: readonly { gridX: number; gridY: number }[];
}

/** Abstand in Zellen, ab dem Gras als Innenflaeche gilt. Dazwischen liegt ein bewusstes Totband. */
const GRASS_INTERIOR_DISTANCE_CELLS = 2;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Without an explicit config: every tier of GROUND_COVER_TIERS, in draw order. */
export function generateGroundCoverPlacements(options: GroundCoverFieldOptions): GroundCoverPlacement[] {
  if (!options.config) return GROUND_COVER_TIERS.flatMap(config => generateTier(options, config));
  return generateTier(options, options.config);
}

function generateTier(options: GroundCoverFieldOptions, config: GroundCoverLayerConfig): GroundCoverPlacement[] {
  const metrics = options.metrics;
  const offsetX = metrics?.offsetX ?? ARENA_OFFSET_X;
  const offsetY = metrics?.offsetY ?? ARENA_OFFSET_Y;
  const cols = metrics?.gridCols ?? GRID_COLS;
  const rows = metrics?.gridRows ?? GRID_ROWS;
  if (cols <= 0 || rows <= 0) return [];

  const dirtSet = new Set<number>();
  for (const { gridX, gridY } of options.dirt) dirtSet.add(gridY * cols + gridX);
  const rockSet = new Set<number>();
  for (const { gridX, gridY } of options.rocks ?? []) rockSet.add(gridY * cols + gridX);
  const isRock = (gridX: number, gridY: number): boolean =>
    gridX >= 0 && gridY >= 0 && gridX < cols && gridY < rows && rockSet.has(gridY * cols + gridX);
  const waterSet = new Set<number>();
  for (const { gridX, gridY } of options.water ?? []) waterSet.add(gridY * cols + gridX);
  const isWater = (gridX: number, gridY: number): boolean =>
    gridX >= 0 && gridY >= 0 && gridX < cols && gridY < rows && waterSet.has(gridY * cols + gridX);
  const besideWater = (gridX: number, gridY: number): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx || dy) && isWater(gridX + dx, gridY + dy)) return true;
    }
    return false;
  };
  const besideRock = (gridX: number, gridY: number): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx || dy) && isRock(gridX + dx, gridY + dy)) return true;
    }
    return false;
  };

  /**
   * Ausserhalb des Gitters wird die Randzelle fortgesetzt (Edge-Clamp).
   *
   * Weder "aussen ist Dirt" noch "aussen ist Gras" waere richtig: Beides macht den Arenarahmen
   * selbst zu einer Materialgrenze und legt einen umlaufenden Moossaum genau auf die Spielfeld-
   * kante. Mit dem Clamp ist der Rand neutral, und eine Karte ganz ohne Dirt bleibt durchgehend
   * Grasinnenflaeche.
   */
  const isDirt = (gridX: number, gridY: number): boolean => {
    const clampedX = Math.min(cols - 1, Math.max(0, gridX));
    const clampedY = Math.min(rows - 1, Math.max(0, gridY));
    return dirtSet.has(clampedY * cols + clampedX);
  };

  /**
   * Nicht-Dirt-Zellen im Abstand von genau `GRASS_INTERIOR_DISTANCE_CELLS` bleiben absichtlich
   * unklassifiziert. Ohne dieses Totband liefen Saum- und Grasbevoelkerung ineinander und die
   * Deckung waere ueberall gleich, der geforderte Schwerpunkt am Uebergang ginge verloren.
   */
  const classify = (gridX: number, gridY: number): GroundCoverAnchor | null => {
    let sawDirt = false;
    let sawGrass = false;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (isDirt(gridX + dx, gridY + dy)) sawDirt = true;
        else sawGrass = true;
      }
    }
    if (sawDirt && sawGrass) return 'seam';
    if (sawDirt) return 'dirt';

    const reach = GRASS_INTERIOR_DISTANCE_CELLS;
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        if (isDirt(gridX + dx, gridY + dy)) return null;
      }
    }
    return 'grass';
  };

  const anchorAt = (cellX: number, cellY: number): GroundCoverAnchor | null => {
    if (isRock(cellX, cellY) || isWater(cellX, cellY)) return null;
    if (options.excludeCell?.(cellX, cellY)) return null;
    return config.bank && besideWater(cellX, cellY) ? 'bank'
      : config.rockFoot && besideRock(cellX, cellY) ? 'rockFoot' : classify(cellX, cellY);
  };
  const pickVariant = (variants: readonly GroundCoverVariantConfig[], roll01: number): GroundCoverVariantConfig => {
    let totalWeight = 0;
    for (const variant of variants) totalWeight += variant.frequencyPercent;
    let roll = roll01 * totalWeight;
    for (const variant of variants) {
      roll -= variant.frequencyPercent;
      if (roll <= 0) return variant;
    }
    return variants[variants.length - 1];
  };

  const placements: GroundCoverPlacement[] = [];
  const blockCols = Math.ceil(cols / config.blockCells);
  const blockRows = Math.ceil(rows / config.blockCells);
  const placementBudget = getGroundCoverPlacementBudget(cols, rows, config);
  const cluster = config.cluster;

  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockCols; blockX += 1) {
      for (let slot = 0; slot < config.maxPerBlock; slot += 1) {
        // Das Budget stammt aus genau dem Blockraster, das dieser Lauf verarbeitet. Es kann daher
        // nur als defensive Konsistenzgrenze wirken und nie einen spaeteren Kartenabschnitt
        // abschneiden.
        if (placements.length >= placementBudget) return placements;
        const salt = config.seedSalt + slot * 997;
        const random = (offset: number): number => hashSeededCell01(options.seed, blockX, blockY, salt + offset);
        const jitterX = (random(1) - 0.5) * 2 * config.jitterCells;
        const jitterY = (random(2) - 0.5) * 2 * config.jitterCells;
        // Bewusst ungeklemmt: Ein Anker darf knapp neben dem Gitter liegen, sein Fleck laeuft dann
        // ueber die Arenakante hinaus und wird von der RenderTexture beschnitten. Ein Clamp auf
        // 0 bzw. `cols` wuerde die Position dort auf ganze Zellen runden, ausgerechnet die
        // Rasterbindung, die diese Schicht aufloesen soll.
        const anchorX = (blockX + 0.5) * config.blockCells + jitterX;
        const anchorY = (blockY + 0.5) * config.blockCells + jitterY;

        const cellX = Math.min(cols - 1, Math.max(0, Math.floor(anchorX)));
        const cellY = Math.min(rows - 1, Math.max(0, Math.floor(anchorY)));
        const anchor = anchorAt(cellX, cellY);
        if (!anchor) continue;
        const anchorConfig = config[anchor];
        if (!anchorConfig) continue;

        // Growth decides between a cluster on an island or band and calm open ground.
        let growth = 1;
        if (cluster) {
          const grown = groundGrowthLevel(options.seed, anchorX, anchorY, cluster);
          const level = cluster.invert ? 1 - grown : grown;
          const floor = anchor === 'rockFoot' || anchor === 'bank' ? cluster.edgeFloor : 0;
          growth = smoothstep(cluster.threshold - cluster.softness, cluster.threshold + cluster.softness,
            Math.max(level, floor));
        }
        // Idiom aus `stampBlobSurfaceMottle`: ganzzahliger Anteil garantiert, Rest als Chance.
        const chance = anchorConfig.perBlock * (cluster ? Math.max(growth, cluster.sparse) : 1);
        const guaranteed = Math.floor(chance);
        const extra = random(3) < chance - guaranteed ? 1 : 0;
        if (slot >= guaranteed + extra) continue;

        const variants = getGroundCoverVariantsForAnchor(anchor, config);
        if (variants.length === 0) continue;
        const species = pickVariant(variants, random(4));
        const members = cluster
          ? 1 + Math.round((cluster.members[0] - 1 + random(10) * (cluster.members[1] - cluster.members[0])) * growth)
          : 1;

        for (let member = 0; member < members; member += 1) {
          if (placements.length >= placementBudget) return placements;
          const memberRandom = (offset: number): number => member === 0 ? random(offset) : random(20 + member * 13 + offset);
          // Members scatter around the cluster centre, denser inside, smaller towards the rim.
          let x = anchorX, y = anchorY, rim = 0;
          if (member > 0 && cluster) {
            const angle = memberRandom(0) * Math.PI * 2;
            rim = Math.sqrt(memberRandom(1));
            const radius = cluster.radiusCells * (.6 + .4 * growth) * rim;
            x += Math.cos(angle) * radius;
            y += Math.sin(angle) * radius;
          }
          const memberCellX = Math.min(cols - 1, Math.max(0, Math.floor(x)));
          const memberCellY = Math.min(rows - 1, Math.max(0, Math.floor(y)));
          const memberAnchor = member === 0 ? anchor : anchorAt(memberCellX, memberCellY);
          if (!memberAnchor) continue;
          const memberConfig = config[memberAnchor];
          if (!memberConfig) continue;
          let picked = species;
          if (member > 0 && cluster && memberRandom(2) >= cluster.coherence) {
            picked = pickVariant(getGroundCoverVariantsForAnchor(memberAnchor, config), memberRandom(3));
          }
          if (picked.anchors && !picked.anchors.includes(memberAnchor)) continue;

          const sizeRoll = (memberRandom(5) ** memberConfig.sizeBias) * (1 - .6 * rim);
          // Motive mit eigener physischer Groesse (Steine, Farne, Blueten) behalten sie ueberall.
          const [minSizeCells, maxSizeCells] = picked.sizeCells ?? [memberConfig.minSizeCells, memberConfig.maxSizeCells];
          placements.push({
            textureKey: getGroundCoverTextureKey(picked.fileName),
            worldX: offsetX + x * CELL_SIZE,
            worldY: offsetY + y * CELL_SIZE,
            sizePx: CELL_SIZE * lerp(minSizeCells, maxSizeCells, sizeRoll),
            rotation: memberRandom(6) * Math.PI * 2,
            alpha: lerp(memberConfig.minAlpha, memberConfig.maxAlpha, memberRandom(7)),
            // Spiegeln vervierfacht die unterscheidbaren Erscheinungen der Vorlagen ohne
            // Texturkosten, wie bei den Mottle-Stempeln, die ebenfalls keine Nahtbedingung haben.
            mirrorX: memberRandom(8) < 0.5,
            mirrorY: memberRandom(9) < 0.5,
            anchor: memberAnchor,
          });
        }
      }
    }
  }

  return placements;
}

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Smooth value noise on the seeded cell hash; frame-local cell coordinates. */
function growthNoise(seed: number, x: number, y: number, period: number, salt: number): number {
  const u = x / period, v = y / period, i = Math.floor(u), j = Math.floor(v);
  const tx = u - i, ty = v - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hashSeededCell01(seed, i, j, salt), b = hashSeededCell01(seed, i + 1, j, salt);
  const c = hashSeededCell01(seed, i, j + 1, salt), d = hashSeededCell01(seed, i + 1, j + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/**
 * World-fixed growth level 0..1 at a frame-local cell position: warped islands plus ridge bands
 * along the noise's contour lines. Tiers sharing a field salt gather in the same places.
 */
export function groundGrowthLevel(seed: number, x: number, y: number, cluster: GroundCoverClusterConfig): number {
  const size = cluster.fieldCells, salt = cluster.fieldSalt;
  const wx = x + (growthNoise(seed, x, y, size * 1.3, salt + 1) - .5) * size * .9;
  const wy = y + (growthNoise(seed, x, y, size * 1.3, salt + 2) - .5) * size * .9;
  const islands = growthNoise(seed, wx, wy, size, salt + 3) * .65 + growthNoise(seed, wx, wy, size * .45, salt + 4) * .35;
  const ridge = 1 - Math.abs(growthNoise(seed, wx, wy, size * 1.7, salt + 5) * 2 - 1);
  return islands * .62 + ridge * ridge * .38;
}

/**
 * Presentation filter for layout grass decals: they stay in and around the vegetation islands,
 * while open ground keeps only a small share. Soil and rock decals are unaffected.
 */
export function isGroundDecalInGrowth(seed: number, decal: DecalCell): boolean {
  const cluster = FOREST_VEGETATION_CONFIG.cluster;
  if (decal.terrain !== 'grass' || !cluster) return true;
  const x = decal.gridX + .5 + decal.offsetX / CELL_SIZE, y = decal.gridY + .5 + decal.offsetY / CELL_SIZE;
  if (groundGrowthLevel(seed, x, y, cluster) >= GRASS_DECAL_GROWTH_THRESHOLD) return true;
  return hashSeededCell01(seed, decal.gridX, decal.gridY, 0x5d11) < GRASS_DECAL_OPEN_GROUND_KEEP;
}
