import { CELL_SIZE } from '../config';
import { terrainSnapshotTexel } from './TerrainSnapshotSampling';
import type { ArenaTrackColumnSpec } from './ArenaVisualFactory';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import { hashSeededCell01 } from './CellHash';
import { SeededValueNoise } from './SeededValueNoise';
import { groundMaterialPhase } from './GroundMaterialConfig';
import type { GrassHeightMap, GroundMaterialPixels, GroundMaterialSamples } from './GroundMaterialSamples';
import { TRACK_BALLAST_REACH_PX, TRACK_GRAVEL_CONFIG as CONFIG } from './TrackGravelConfig';

export interface TrackBallastMaterials {
  readonly gravel: GroundMaterialPixels;
  readonly soil: GroundMaterialPixels;
  /** Weathered wood with its grain along x; without it the sleepers keep a plain wood tone. */
  readonly wood?: GroundMaterialPixels;
  /** Grass blade height of the ground below; without it the foot ends without blades. */
  readonly grassHeight?: GrassHeightMap;
}

/** The bed's materials from the shared ground samples; chunk bakes and snapshots use the same. */
export function trackBallastMaterials(samples: GroundMaterialSamples, gravel: GroundMaterialPixels): TrackBallastMaterials {
  return { gravel, soil: samples.dirt, wood: samples.sleeperWood, grassHeight: samples.grassHeight };
}

/** Rail-local lateral profile, in world pixels from the column's left edge. */
export interface TrackBallastProfile {
  /** Outer ends of the sloped shoulder. */
  readonly footLeft: number;
  /** Flat crest of the bed beyond the sleeper ends. */
  readonly crestLeft: number;
  readonly crestRight: number;
  readonly footRight: number;
  /** Loose stones beyond each foot (0 = the bed ends at its foot). */
  readonly spillLeft: number;
  readonly spillRight: number;
}

/** One sleeper of a column, in rail-local coordinates. */
interface Sleeper {
  center: number;
  halfWidth: number;
  left: number;
  right: number;
  skew: number;
  age: number;
  woodX: number;
  woodY: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/** Warm, oiled oak and sun-bleached grey-brown wood; `age` blends between them per sleeper. */
const WOOD_FRESH = [124, 88, 58] as const;
const WOOD_WEATHERED = [158, 137, 110] as const;
const PLATE = [74, 63, 56] as const;
const RUST = [104, 72, 50] as const;
const DUST = [92, 80, 67] as const;
/** Dark bed between the stones: compacted fines, darker and greyer than the soil. */
const BED_DARKEN = 0.42;
/** Pale fines washed down the shoulder; they run out this far past the foot. */
const FINES_LIGHTEN = 0.78;
const FRINGE_PX = 6;

function edgeNoise(seed: number, gridX: number, y: number, period: number, salt: number): number {
  const cell = Math.floor(y / period);
  const t = y / period - cell;
  const weight = t * t * (3 - 2 * t);
  const a = hashSeededCell01(seed, gridX, cell, salt);
  return a + (hashSeededCell01(seed, gridX, cell + 1, salt) - a) * weight;
}

/**
 * Both sides vary independently and continuously along the line; y is measured from the world
 * frame, never a chunk.
 */
export function getTrackBallastProfile(seed: number, gridX: number, y: number): TrackBallastProfile {
  const crest = (salt: number) => CONFIG.minCrestOverhangPx + (CONFIG.maxCrestOverhangPx - CONFIG.minCrestOverhangPx)
    * (0.7 * edgeNoise(seed, gridX, y, 24, salt) + 0.3 * edgeNoise(seed, gridX, y, 7, salt + 1));
  // Long swells of the shoulder plus a short ragged wobble of single stones at its foot.
  const slope = (salt: number) => CONFIG.minSlopePx + (CONFIG.maxSlopePx - CONFIG.minSlopePx)
    * (0.55 * edgeNoise(seed, gridX, y, 61, salt) + 0.3 * edgeNoise(seed, gridX, y, 17, salt + 1)
      + 0.15 * edgeNoise(seed, gridX, y, 4, salt + 2));
  // Mostly a clean foot; now and then a fan of loose stones.
  const spill = (salt: number) => CONFIG.maxSpillPx * Math.pow(
    0.75 * edgeNoise(seed, gridX, y, 47, salt) + 0.25 * edgeNoise(seed, gridX, y, 11, salt + 1), 2.4);
  const crestLeft = CONFIG.sleeperLeftPx - CONFIG.sleeperEndJitterPx / 2 - crest(0x7321);
  const crestRight = CONFIG.sleeperRightPx + CONFIG.sleeperEndJitterPx / 2 + crest(0x7323);
  return {
    footLeft: crestLeft - slope(0x7331),
    crestLeft,
    crestRight,
    footRight: crestRight + slope(0x7333),
    spillLeft: spill(0x7341),
    spillRight: spill(0x7343),
  };
}

function sleeperAt(seed: number, gridX: number, index: number, wood: GroundMaterialPixels | undefined, out: Sleeper): void {
  const h = (salt: number) => hashSeededCell01(seed, gridX, index, 0x7400 + salt);
  out.center = (index + 0.5) * CONFIG.sleeperPitchPx + (h(1) - 0.5) * 2 * CONFIG.sleeperShiftJitterPx;
  out.halfWidth = (CONFIG.sleeperWidthPx + (h(2) - 0.5) * 2 * CONFIG.sleeperWidthJitterPx) / 2;
  out.left = CONFIG.sleeperLeftPx + (h(3) - 0.5) * CONFIG.sleeperEndJitterPx;
  out.right = CONFIG.sleeperRightPx + (h(4) - 0.5) * CONFIG.sleeperEndJitterPx;
  out.skew = (h(5) - 0.5) * 2 * CONFIG.sleeperSkew;
  // A spread from warm oiled wood to bleached grey-brown, with the odd fresh replacement.
  const age = h(6);
  out.age = age < 0.12 ? 0 : Math.pow(age, 0.8) * 0.85;
  out.woodX = wood ? Math.floor(h(7) * wood.width) : 0;
  out.woodY = wood ? Math.floor(h(8) * wood.height) : 0;
}

interface SleeperMetrics { across: number; along: number; dy: number }

/** Sleeper coverage at a rail-local point; also reports the signed distances for shading. */
function sleeperCoverage(s: Sleeper, railX: number, y: number, metrics: SleeperMetrics): number {
  const dy = y - (s.center + s.skew * (railX - 32));
  const across = s.halfWidth - Math.abs(dy);
  const along = Math.min(railX - s.left, s.right - railX);
  metrics.across = across;
  metrics.along = along;
  metrics.dy = dy;
  if (across <= -0.5 || along <= -0.5) return 0;
  // Worn, slightly rounded corners.
  const r = 1.3;
  if (across < r && along < r) return clamp01(r - Math.hypot(r - across, r - along) + 0.5);
  return clamp01(across + 0.5) * clamp01(along + 0.5);
}

const SLEEPER_SLOTS = 3;

/**
 * Writes the railway bed as straight RGBA for one square region at native resolution: a raised
 * grey ballast bed, darker towards its ragged foot and rust-stained around the rails, loose
 * stones beyond the foot, grass blades over it, and the wooden sleepers with their tie plates on
 * top. Pure function of seed, columns, frame and world position, so chunk bakes, gutters and
 * snapshots agree exactly. Overlapping beds keep the more opaque pixel.
 */
export function writeTrackBallast(
  data: Uint8ClampedArray,
  stride: number,
  seed: number,
  columns: readonly ArenaTrackColumnSpec[],
  frame: ChunkWorldFrame,
  region: { worldX: number; worldY: number; size: number },
  materials: TrackBallastMaterials,
  snapshotSamples = false,
): void {
  data.fill(0);
  const { gravel, soil, wood, grassHeight } = materials;
  const noise = new SeededValueNoise(seed);
  const sleepers: Sleeper[] = Array.from({ length: SLEEPER_SLOTS }, () => ({
    center: 0, halfWidth: 0, left: 0, right: 0, skew: 0, age: 0, woodX: 0, woodY: 0,
  }));
  const metrics: SleeperMetrics = { across: 0, along: 0, dy: 0 };
  const [railA, railB] = CONFIG.railCentersPx;
  for (const column of columns) {
    if (column.x - TRACK_BALLAST_REACH_PX >= region.worldX + region.size
      || column.x + column.width + TRACK_BALLAST_REACH_PX <= region.worldX) continue;
    const gridX = Math.round((column.x - frame.offsetX) / CELL_SIZE);
    for (let y = 0; y < region.size; y += 1) {
      if (snapshotSamples && !terrainSnapshotTexel(y)) continue;
      const worldY = region.worldY + y + 0.5;
      if (worldY < column.y || worldY >= column.y + column.height) continue;
      const localY = worldY - frame.offsetY;
      const profile = getTrackBallastProfile(seed, gridX, localY);
      const leftSlope = profile.crestLeft - profile.footLeft;
      const rightSlope = profile.footRight - profile.crestRight;
      const warp = CONFIG.footWarpPx * .73;
      const minX = Math.max(0, Math.floor(column.x + profile.footLeft - Math.max(profile.spillLeft, FRINGE_PX) - warp - region.worldX));
      const maxX = Math.min(region.size, Math.ceil(column.x + profile.footRight + Math.max(profile.spillRight, FRINGE_PX) + warp - region.worldX));
      const gravelRow = groundMaterialPhase(Math.floor(localY), gravel.height) * gravel.width;
      const soilRow = groundMaterialPhase(Math.floor(localY), soil.height) * soil.width;
      const heightRow = grassHeight ? groundMaterialPhase(Math.floor(localY), grassHeight.height) * grassHeight.width : 0;
      // The sleeper nearest to this row and its two neighbours.
      const nearest = Math.floor(localY / CONFIG.sleeperPitchPx);
      for (let k = 0; k < SLEEPER_SLOTS; k += 1) sleeperAt(seed, gridX, nearest - 1 + k, wood, sleepers[k]);

      for (let x = minX; x < maxX; x += 1) {
        if (snapshotSamples && !terrainSnapshotTexel(x)) continue;
        const worldX = region.worldX + x + 0.5;
        const railX = worldX - column.x;
        const localX = worldX - frame.offsetX;

        // ── Ballast ────────────────────────────────────────────────────────
        // 0 on the crest, 1 at the foot; `beyond` is the distance past the foot.
        // The shoulder is measured on a position warped in both axes, so the foot meanders
        // in bays and tongues instead of following the line.
        const warpedX = railX > profile.crestLeft + warp && railX < profile.crestRight - warp ? railX
          : railX + (noise.sample(localX, localY, 13, 7) - .5) * CONFIG.footWarpPx
            + (noise.sample(localX, localY, 5, 8) - .5) * CONFIG.footWarpPx * .45;
        let slope = 0, spill = 0, beyond = 0;
        if (warpedX < profile.crestLeft) {
          slope = (profile.crestLeft - warpedX) / leftSlope;
          spill = profile.spillLeft;
          beyond = profile.footLeft - warpedX;
        } else if (warpedX > profile.crestRight) {
          slope = (warpedX - profile.crestRight) / rightSlope;
          spill = profile.spillRight;
          beyond = warpedX - profile.footRight;
        }
        if (beyond > 0 && beyond >= Math.max(spill, FRINGE_PX)) continue;
        const height = 1 - smooth(slope);

        const g = (gravelRow + groundMaterialPhase(Math.floor(localX), gravel.width)) * 4;
        const gr = gravel.rgba[g], gg = gravel.rgba[g + 1], gb = gravel.rgba[g + 2];
        const luma = (gr * .3 + gg * .59 + gb * .11) / 255;
        const clump = noise.sample(localX, localY, 4, 1);
        const stone = luma * 1.6 - .25 + (clump - .5) * .6;
        // Down the shoulder, broad bays and tongues of ballast break the line of the foot.
        const bays = slope > .3 ? (noise.sample(localX, localY, 11, 2) - .5) * .8 * smooth((slope - .3) / .7) : 0;
        const threshold = beyond <= 0
          ? CONFIG.crestGapThreshold + slope * Math.sqrt(slope) * (.62 - CONFIG.crestGapThreshold) + bays
          : spill > 0 && beyond < spill ? .62 + beyond / spill * .5 + bays : 2;
        let stoneAlpha = smooth((stone - threshold) / CONFIG.stoneSoftness + .5);
        // The dark compacted bed shows between stones on the crest; down the slope it turns into
        // pale fines that run out a little past the foot.
        const fines = beyond <= 0 ? 1 : 1 - smooth(beyond / FRINGE_PX);
        let bedAlpha = (slope <= .55 ? 1 : .55 + .45 * (1 - smooth((slope - .55) / .45))) * fines
          * (beyond > 0 ? .55 + .45 * noise.sample(localX, localY, 6, 3) : 1);

        // Grass reclaims the foot: tall blades and clumps cover the lower slope and loose stones.
        if (grassHeight && slope > .4) {
          const blade = grassHeight.data[heightRow + groundMaterialPhase(Math.floor(localX), grassHeight.width)] / 255;
          const tuft = noise.sample(localX, localY, 7, 4);
          const level = 1.5 - Math.min(slope, 1.6) * 1.05;
          const reclaimed = smooth((level - (blade * .55 + tuft * .45)) / .1 + .5);
          stoneAlpha *= reclaimed;
          bedAlpha *= reclaimed;
        }

        let alpha = stoneAlpha + bedAlpha * (1 - stoneAlpha);
        let r = 0, gn = 0, b = 0;
        if (alpha > 0) {
          const grey = luma * 255;
          const shade = 1 - CONFIG.footShade * (1 - height) * (beyond > 0 ? .5 : 1);
          const s = (soilRow + groundMaterialPhase(Math.floor(localX), soil.width)) * 4;
          // Grey ballast; dark between crest stones, paler dusty fines towards and past the foot.
          const desaturate = CONFIG.ballastDesaturate, stoneGain = CONFIG.ballastGain * stoneAlpha;
          const darken = BED_DARKEN + (FINES_LIGHTEN - BED_DARKEN) * smooth((slope - .15) / .5);
          const bedGain = bedAlpha * (1 - stoneAlpha) * darken, bedGrey = grey * .45;
          const normalize = shade / alpha;
          r = ((gr + (grey - gr) * desaturate) * .98 * stoneGain + (soil.rgba[s] * .55 + bedGrey) * bedGain) * normalize;
          gn = ((gg + (grey - gg) * desaturate) * .99 * stoneGain + (soil.rgba[s + 1] * .55 + bedGrey) * bedGain) * normalize;
          b = ((gb + (grey - gb) * desaturate) * 1.02 * stoneGain + (soil.rgba[s + 2] * .55 + bedGrey) * bedGain) * normalize;

          // Brown dust over the whole crib between the sleeper ends, patchy along the line.
          if (railX > CONFIG.sleeperLeftPx && railX < CONFIG.sleeperRightPx) {
            const dust = CONFIG.cribDust * (.35 + .65 * noise.sample(localX, localY, 23, 6));
            r += (DUST[0] * shade - r) * dust;
            gn += (DUST[1] * shade - gn) * dust;
            b += (DUST[2] * shade - b) * dust;
          }
          // Rust and brake dust settle in the crib around each rail.
          const nearRail = Math.min(Math.abs(railX - railA), Math.abs(railX - railB));
          if (nearRail < 8 && slope === 0) {
            const near = 1 - nearRail / 8;
            const stain = near * Math.sqrt(near) * CONFIG.rustStrength
              * (.45 + .9 * noise.sample(localX, localY, 9, 5));
            r += (RUST[0] * shade - r) * stain;
            gn += (RUST[1] * shade - gn) * stain;
            b += (RUST[2] * shade - b) * stain;
          }
        }

        // ── Sleepers and tie plates ─────────────────────────────────────────
        let cover = 0, contact = 1;
        let sr = 0, sg = 0, sb = 0;
        for (let k = 0; k < SLEEPER_SLOTS; k += 1) {
          const sleeper = sleepers[k];
          const coverage = sleeperCoverage(sleeper, railX, localY, metrics);
          if (coverage <= 0) {
            // Contact shade on the ballast beside the sleeper's long edges.
            if (metrics.along > -1 && metrics.across > -2.4) {
              contact = Math.min(contact, 1 - CONFIG.sleeperContactShade * (1 - smooth(-metrics.across / 2.4)));
            }
            continue;
          }
          const { across, along, dy } = metrics;
          // Weathered wood: grain along the sleeper, bevelled edges and darker end grain.
          let lum = .62;
          if (wood) {
            const wx = groundMaterialPhase(sleeper.woodX + Math.floor(railX - sleeper.left), wood.width);
            const wy = groundMaterialPhase(sleeper.woodY + Math.floor(dy + sleeper.halfWidth), wood.height);
            const w = (wy * wood.width + wx) * 4;
            lum = (wood.rgba[w] * .3 + wood.rgba[w + 1] * .59 + wood.rgba[w + 2] * .11) / 255;
          }
          // The grain only modulates the wood tone; edges and end grain stay a little darker.
          let shade = (.74 + .85 * (lum - .5)) * (.72 + .28 * smooth(Math.min(across, along) / 1.6));
          if (along < 2.5) shade *= .84 + .16 * (along / 2.5);
          let pr = WOOD_FRESH[0] + (WOOD_WEATHERED[0] - WOOD_FRESH[0]) * sleeper.age;
          let pg = WOOD_FRESH[1] + (WOOD_WEATHERED[1] - WOOD_FRESH[1]) * sleeper.age;
          let pb = WOOD_FRESH[2] + (WOOD_WEATHERED[2] - WOOD_FRESH[2]) * sleeper.age;
          // Steel tie plates under the rails, with two spike heads each.
          for (const rail of CONFIG.railCentersPx) {
            const px = Math.abs(railX - rail);
            const plateAcross = CONFIG.tiePlateHalfWidthPx - Math.abs(dy);
            const plateAlong = CONFIG.tiePlateHalfLengthPx - px;
            if (plateAcross <= -.5 || plateAlong <= -.5) continue;
            const plate = clamp01(plateAcross + .5) * clamp01(plateAlong + .5);
            const edge = .78 + .22 * smooth(Math.min(plateAcross, plateAlong) / 1.2);
            const spike = Math.abs(px - 3.3) < .8 && Math.abs(dy) < .9 ? 1.45 : 1;
            const steel = (.85 + .3 * noise.sample(localX, localY, 3, 9)) * edge * spike;
            pr += (PLATE[0] * steel - pr) * plate;
            pg += (PLATE[1] * steel - pg) * plate;
            pb += (PLATE[2] * steel - pb) * plate;
            shade += (1 - shade) * plate;
          }
          // Stones of the crib lap over the long edges of the sleeper.
          const buried = across < 1.2 ? stoneAlpha * (1 - smooth(across / 1.2)) * .75 : 0;
          const visible = coverage * (1 - buried);
          if (visible > cover) {
            cover = visible;
            sr = pr * shade; sg = pg * shade; sb = pb * shade;
          }
        }
        if (cover > 0 || alpha > 0) {
          r *= contact; gn *= contact; b *= contact;
          const total = cover + alpha * (1 - cover);
          r = (sr * cover + r * alpha * (1 - cover)) / total;
          gn = (sg * cover + gn * alpha * (1 - cover)) / total;
          b = (sb * cover + b * alpha * (1 - cover)) / total;
          alpha = total;
        }
        if (alpha <= 0) continue;
        const i = (y * stride + x) * 4;
        if (alpha * 255 <= data[i + 3]) continue;
        data[i] = r;
        data[i + 1] = gn;
        data[i + 2] = b;
        data[i + 3] = Math.round(alpha * 255);
      }
    }
  }
}
