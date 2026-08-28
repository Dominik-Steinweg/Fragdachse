import * as Phaser from 'phaser';
import {
  TEX_AIRSTRIKE_BOMB,
  TEX_AIRSTRIKE_SPARK,
  TEX_ROCKET_EXHAUST,
  TEX_ROCKET_SMOKE,
  TEX_STINK_PUFF,
  TEX_GROUND_FIRE_SMOKE,
  TEX_LEAF_DEBRIS,
  TEX_LEAF_BLOWER_DUST,
  TEX_EXPLOSION_SPARK,
  TEX_EXPLOSION_EMBER,
  TEX_EXPLOSION_FIREBALL_A,
  TEX_EXPLOSION_FIREBALL_B,
  TEX_EXPLOSION_CORE,
  TEX_EXPLOSION_SMOKE,
  TEX_EXPLOSION_STREAK,
  TEX_EXPLOSION_CHUNK,
  TEX_EXPLOSION_RING,
  TEX_DEATH_FRAGMENT,
  TEX_DEATH_MORPH_COMPACT,
  TEX_DEATH_MORPH_FRAYED,
  TEX_DEATH_MORPH_POROUS,
  TEX_DEATH_MORPH_FRAGMENTED,
  TEX_DEATH_MORPH_DUST,
  TEX_DEATH_MORPH_FINE_DUST,
  TEX_DEATH_DUST_MOTE_A,
  TEX_DEATH_DUST_MOTE_B,
  TEX_DEATH_DUST_MOTE_C,
  TEX_DEATH_GLOW,
  TEX_MUZZLE_FLASH,
  TEX_MUZZLE_ENERGY,
  TEX_MUZZLE_SPARK,
  ensureAirstrikeBombTexture,
  ensureAirstrikeSparkTexture,
  ensureRocketExhaustTexture,
  ensureRocketSmokeTexture,
  ensureStinkPuffTexture,
  ensureGroundFireSmokeTexture,
  ensureLeafDebrisTexture,
  ensureLeafBlowerDustTexture,
  ensureExplosionSparkTexture,
  ensureExplosionEmberTexture,
  ensureExplosionFireballTextures,
  ensureExplosionCoreTexture,
  ensureExplosionSmokeTexture,
  ensureExplosionStreakTexture,
  ensureExplosionChunkTexture,
  ensureExplosionRingTexture,
  ensureDeathFragmentTexture,
  ensureDeathMorphTextures,
  ensureDeathDustMoteTextures,
  ensureDeathGlowTexture,
  ensureMuzzleFlashTexture,
  ensureMuzzleEnergyTexture,
  ensureMuzzleSparkTexture,
} from './GpuVfxSourceTextures';
import {
  TEX_BLOOD_DROPLET,
  TEX_BLOOD_STAIN,
  TEX_BLOOD_STREAK,
  ensureBloodHitTextures,
} from '../BloodEffectShared';
import {
  GROUND_FIRE_BED_SIZE,
  GROUND_FIRE_SURFACE_SIZE,
  TEX_GROUND_FIRE_BED,
  TEX_GROUND_FIRE_BED_B,
  TEX_GROUND_FIRE_SURFACE,
  TEX_GROUND_FIRE_SURFACE_B,
  TEX_GROUND_FIRE_SURFACE_C,
  ensureGroundFireTextures,
} from '../GroundFireTextures';
import {
  TEX_FLAME_BILLOW,
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_SPARK,
  TEX_FLAME_TONGUE,
  TEX_VOID_FLAME_CORE,
  TEX_VOID_FLAME_EMBER,
  TEX_VOID_FLAME_SPARK,
  ensureFlameJetTextures,
  ensureFlameTextures,
  ensureVoidFlameTextures,
} from '../FlameShared';

/**
 * GpuVfxAtlas – ein gemeinsames Bild fuer alle GPU-VFX-Partikel.
 *
 * `SpriteGPULayer` nimmt genau eine Textur ("must be sourced from a single image; a multi atlas
 * will not work"). Solange jeder Effekt seine eigene Textur mitbringt, ist die Textur ein
 * Trennkriterium fuer physische Layer und Lane-Sharing unmoeglich. Der Atlas nimmt dieses
 * Kriterium heraus: alle Lanes benutzen dasselbe Bild und waehlen ihr Motiv pro Member ueber
 * `frame`.
 *
 * ## Warum kopiert und nicht neu gezeichnet
 *
 * Die Frames werden aus den bestehenden prozeduralen Texturen geblittet, nicht nachgezeichnet.
 * Das haelt die Bilder garantiert pixelgleich und die Zeichenlogik an genau einer Stelle.
 *
 * ## Regeln, die aus Phasers Quellcode folgen
 *
 * - **`__void` muss der erste Frame sein.** `Texture.add()` befoerdert den ersten hinzugefuegten
 *   Frame zu `firstFrame`, und `SpriteGPULayer._setMemberData` faellt ohne `member.frame` auf
 *   `layer.frame` zurueck. Ohne `__void` waere der Default der *gesamte Atlas* – ein
 *   bildschirmfuellendes Quad pro vergessenem Frame.
 * - **Der Atlas muss fertig sein, bevor die erste Lane entsteht.** `frameDataTexture` wird im
 *   Konstruktor des Layers gebaut; spaeter ergaenzte Frames existieren fuer den Shader nicht.
 * - **Padding.** Das Spiel laeuft mit `smoothPixelArt: true`, der Shader klemmt die
 *   Sample-Position auf `seam ± 0.5` Texel. Zwei Pixel transparenter Rand reichen damit sicher.
 * - **Der Blit muss bit-exakt sein**: Smoothing aus, `source-over`, ganzzahlige Zielkoordinaten.
 */

export const GPU_VFX_ATLAS_KEY = '__gpu_vfx_atlas';

/**
 * Stabile Manifest-IDs. Bewusst *nicht* Phasers interne Frame-Indizes: die haengen an der
 * Einfuegereihenfolge in die Textur, diese hier nicht.
 */
export const GpuVfxFrameId = {
  Void:            0,
  AirstrikeBomb:   1,
  AirstrikeSpark:  2,
  RocketExhaust:   3,
  RocketSmoke:     4,
  StinkPuff:       5,
  FlameCore:       6,
  FlameCoreVoid:   7,
  FlameOuter:      8,
  FlameOuterVoid:  9,
  FlameSpark:      10,
  FlameSparkVoid:  11,
  GroundFireSmoke: 12,
  LeafDebris:      13,
  LeafBlowerDust:  14,
  /** Weisse Jet-Motive; der Stil steckt allein im Tint, deshalb ohne Void-Zwilling. */
  FlameBillow:     15,
  FlameTongue:     16,
  ExplosionSpark:  17,
  ExplosionEmber:  18,
  /** Default-Motive des Bodenfeuers; weitere organische Varianten stehen am Manifestende. */
  GroundFireSurface: 19,
  GroundFireBed:     20,
  ExplosionFireballA: 21,
  ExplosionFireballB: 22,
  ExplosionCore:      23,
  ExplosionSmoke:     24,
  ExplosionStreak:    25,
  ExplosionChunk:     26,
  ExplosionRing:      27,
  GroundFireSurfaceB: 28,
  GroundFireSurfaceC: 29,
  GroundFireBedB:     30,
  DeathFragment:      31,
  DeathGlow:          32,
  BloodStreak:        33,
  BloodDroplet:       34,
  BloodStain:         35,
  MuzzleFlash:         36,
  MuzzleEnergy:        37,
  MuzzleSpark:         38,
  /** One-Shot-Death-Morph; neue IDs werden nur angehaengt, damit bestehende IDs stabil bleiben. */
  DeathMorphCompact:    39,
  DeathMorphFrayed:     40,
  DeathMorphPorous:     41,
  DeathMorphFragmented: 42,
  DeathMorphDust:       43,
  DeathMorphFineDust:   44,
  DeathDustMoteA:        45,
  DeathDustMoteB:        46,
  DeathDustMoteC:        47,
} as const;

export type GpuVfxFrameId = (typeof GpuVfxFrameId)[keyof typeof GpuVfxFrameId];

interface GpuVfxAtlasEntry {
  readonly id: GpuVfxFrameId;
  /** Frame-Name im Atlas. Erscheint in der Diagnose und in Phasers `frameDataIndices`. */
  readonly frame: string;
  /** Quelltextur, aus der geblittet wird; `null` beim leeren Platzhalter. */
  readonly sourceTextureKey: string | null;
  readonly width: number;
  readonly height: number;
  /** Erzeugt die Quelltextur, falls der zustaendige Renderer noch nicht gelaufen ist. */
  readonly ensure: ((scene: Phaser.Scene) => void) | null;
}

/**
 * Reihenfolge egal fuer die IDs, aber `Void` muss zuerst *eingefuegt* werden – das erledigt
 * `buildGpuVfxAtlas`, indem es nach `id` sortiert und `Void` die 0 hat.
 */
export const GPU_VFX_ATLAS: readonly GpuVfxAtlasEntry[] = [
  { id: GpuVfxFrameId.Void, frame: '__void', sourceTextureKey: null, width: 1, height: 1, ensure: null },
  {
    id: GpuVfxFrameId.AirstrikeBomb, frame: 'airstrike-bomb',
    sourceTextureKey: TEX_AIRSTRIKE_BOMB, width: 8, height: 20, ensure: ensureAirstrikeBombTexture,
  },
  {
    id: GpuVfxFrameId.AirstrikeSpark, frame: 'airstrike-spark',
    sourceTextureKey: TEX_AIRSTRIKE_SPARK, width: 8, height: 8, ensure: ensureAirstrikeSparkTexture,
  },
  {
    id: GpuVfxFrameId.RocketExhaust, frame: 'rocket-exhaust',
    sourceTextureKey: TEX_ROCKET_EXHAUST, width: 18, height: 18, ensure: ensureRocketExhaustTexture,
  },
  {
    id: GpuVfxFrameId.RocketSmoke, frame: 'rocket-smoke',
    sourceTextureKey: TEX_ROCKET_SMOKE, width: 24, height: 24, ensure: ensureRocketSmokeTexture,
  },
  {
    id: GpuVfxFrameId.StinkPuff, frame: 'stink-puff',
    sourceTextureKey: TEX_STINK_PUFF, width: 40, height: 40, ensure: ensureStinkPuffTexture,
  },
  {
    id: GpuVfxFrameId.FlameCore, frame: 'flame-core',
    sourceTextureKey: TEX_FLAME_CORE, width: 24, height: 24, ensure: ensureFlameTextures,
  },
  {
    id: GpuVfxFrameId.FlameCoreVoid, frame: 'flame-core-void',
    sourceTextureKey: TEX_VOID_FLAME_CORE, width: 24, height: 24, ensure: ensureVoidFlameTextures,
  },
  {
    id: GpuVfxFrameId.FlameOuter, frame: 'flame-outer',
    sourceTextureKey: TEX_FLAME_EMBER, width: 16, height: 16, ensure: ensureFlameTextures,
  },
  {
    id: GpuVfxFrameId.FlameOuterVoid, frame: 'flame-outer-void',
    sourceTextureKey: TEX_VOID_FLAME_EMBER, width: 16, height: 16, ensure: ensureVoidFlameTextures,
  },
  {
    id: GpuVfxFrameId.FlameSpark, frame: 'flame-spark',
    sourceTextureKey: TEX_FLAME_SPARK, width: 6, height: 6, ensure: ensureFlameTextures,
  },
  {
    id: GpuVfxFrameId.FlameSparkVoid, frame: 'flame-spark-void',
    sourceTextureKey: TEX_VOID_FLAME_SPARK, width: 6, height: 6, ensure: ensureVoidFlameTextures,
  },
  {
    id: GpuVfxFrameId.GroundFireSmoke, frame: 'ground-fire-smoke',
    sourceTextureKey: TEX_GROUND_FIRE_SMOKE, width: 48, height: 48, ensure: ensureGroundFireSmokeTexture,
  },
  {
    id: GpuVfxFrameId.LeafDebris, frame: 'leaf-debris',
    sourceTextureKey: TEX_LEAF_DEBRIS, width: 24, height: 18, ensure: ensureLeafDebrisTexture,
  },
  {
    id: GpuVfxFrameId.LeafBlowerDust, frame: 'leaf-blower-dust',
    sourceTextureKey: TEX_LEAF_BLOWER_DUST, width: 18, height: 18, ensure: ensureLeafBlowerDustTexture,
  },
  {
    id: GpuVfxFrameId.FlameBillow, frame: 'flame-billow',
    sourceTextureKey: TEX_FLAME_BILLOW, width: 32, height: 32, ensure: ensureFlameJetTextures,
  },
  {
    id: GpuVfxFrameId.FlameTongue, frame: 'flame-tongue',
    sourceTextureKey: TEX_FLAME_TONGUE, width: 32, height: 16, ensure: ensureFlameJetTextures,
  },
  {
    id: GpuVfxFrameId.ExplosionSpark, frame: 'explosion-spark',
    sourceTextureKey: TEX_EXPLOSION_SPARK, width: 6, height: 6, ensure: ensureExplosionSparkTexture,
  },
  {
    id: GpuVfxFrameId.ExplosionEmber, frame: 'explosion-ember',
    sourceTextureKey: TEX_EXPLOSION_EMBER, width: 4, height: 4, ensure: ensureExplosionEmberTexture,
  },
  {
    id: GpuVfxFrameId.GroundFireSurface, frame: 'ground-fire-surface',
    sourceTextureKey: TEX_GROUND_FIRE_SURFACE,
    width: GROUND_FIRE_SURFACE_SIZE, height: GROUND_FIRE_SURFACE_SIZE, ensure: ensureGroundFireTextures,
  },
  {
    id: GpuVfxFrameId.GroundFireBed, frame: 'ground-fire-bed',
    sourceTextureKey: TEX_GROUND_FIRE_BED,
    width: GROUND_FIRE_BED_SIZE, height: GROUND_FIRE_BED_SIZE, ensure: ensureGroundFireTextures,
  },
  {
    id: GpuVfxFrameId.ExplosionFireballA, frame: 'explosion-fireball-a',
    sourceTextureKey: TEX_EXPLOSION_FIREBALL_A, width: 48, height: 48, ensure: ensureExplosionFireballTextures,
  },
  {
    id: GpuVfxFrameId.ExplosionFireballB, frame: 'explosion-fireball-b',
    sourceTextureKey: TEX_EXPLOSION_FIREBALL_B, width: 48, height: 48, ensure: ensureExplosionFireballTextures,
  },
  {
    id: GpuVfxFrameId.ExplosionCore, frame: 'explosion-core',
    sourceTextureKey: TEX_EXPLOSION_CORE, width: 32, height: 32, ensure: ensureExplosionCoreTexture,
  },
  {
    id: GpuVfxFrameId.ExplosionSmoke, frame: 'explosion-smoke',
    sourceTextureKey: TEX_EXPLOSION_SMOKE, width: 56, height: 56, ensure: ensureExplosionSmokeTexture,
  },
  {
    id: GpuVfxFrameId.ExplosionStreak, frame: 'explosion-streak',
    sourceTextureKey: TEX_EXPLOSION_STREAK, width: 24, height: 8, ensure: ensureExplosionStreakTexture,
  },
  {
    id: GpuVfxFrameId.ExplosionChunk, frame: 'explosion-chunk',
    sourceTextureKey: TEX_EXPLOSION_CHUNK, width: 16, height: 16, ensure: ensureExplosionChunkTexture,
  },
  {
    id: GpuVfxFrameId.ExplosionRing, frame: 'explosion-ring',
    sourceTextureKey: TEX_EXPLOSION_RING, width: 64, height: 64, ensure: ensureExplosionRingTexture,
  },
  {
    id: GpuVfxFrameId.GroundFireSurfaceB, frame: 'ground-fire-surface-b',
    sourceTextureKey: TEX_GROUND_FIRE_SURFACE_B,
    width: GROUND_FIRE_SURFACE_SIZE, height: GROUND_FIRE_SURFACE_SIZE, ensure: ensureGroundFireTextures,
  },
  {
    id: GpuVfxFrameId.GroundFireSurfaceC, frame: 'ground-fire-surface-c',
    sourceTextureKey: TEX_GROUND_FIRE_SURFACE_C,
    width: GROUND_FIRE_SURFACE_SIZE, height: GROUND_FIRE_SURFACE_SIZE, ensure: ensureGroundFireTextures,
  },
  {
    id: GpuVfxFrameId.GroundFireBedB, frame: 'ground-fire-bed-b',
    sourceTextureKey: TEX_GROUND_FIRE_BED_B,
    width: GROUND_FIRE_BED_SIZE, height: GROUND_FIRE_BED_SIZE, ensure: ensureGroundFireTextures,
  },
  {
    id: GpuVfxFrameId.DeathFragment, frame: 'death-fragment',
    sourceTextureKey: TEX_DEATH_FRAGMENT, width: 4, height: 4, ensure: ensureDeathFragmentTexture,
  },
  {
    id: GpuVfxFrameId.DeathGlow, frame: 'death-glow',
    sourceTextureKey: TEX_DEATH_GLOW, width: 24, height: 24, ensure: ensureDeathGlowTexture,
  },
  {
    id: GpuVfxFrameId.BloodStreak, frame: 'blood-streak',
    sourceTextureKey: TEX_BLOOD_STREAK, width: 36, height: 16, ensure: ensureBloodHitTextures,
  },
  {
    id: GpuVfxFrameId.BloodDroplet, frame: 'blood-droplet',
    sourceTextureKey: TEX_BLOOD_DROPLET, width: 14, height: 14, ensure: ensureBloodHitTextures,
  },
  {
    id: GpuVfxFrameId.BloodStain, frame: 'blood-stain',
    sourceTextureKey: TEX_BLOOD_STAIN, width: 42, height: 42, ensure: ensureBloodHitTextures,
  },
  {
    id: GpuVfxFrameId.MuzzleFlash, frame: 'muzzle-flash',
    sourceTextureKey: TEX_MUZZLE_FLASH, width: 32, height: 18, ensure: ensureMuzzleFlashTexture,
  },
  {
    id: GpuVfxFrameId.MuzzleEnergy, frame: 'muzzle-energy',
    sourceTextureKey: TEX_MUZZLE_ENERGY, width: 36, height: 24, ensure: ensureMuzzleEnergyTexture,
  },
  {
    id: GpuVfxFrameId.MuzzleSpark, frame: 'muzzle-spark',
    sourceTextureKey: TEX_MUZZLE_SPARK, width: 8, height: 8, ensure: ensureMuzzleSparkTexture,
  },
  {
    id: GpuVfxFrameId.DeathMorphCompact, frame: 'death-morph-compact',
    sourceTextureKey: TEX_DEATH_MORPH_COMPACT, width: 24, height: 24, ensure: ensureDeathMorphTextures,
  },
  {
    id: GpuVfxFrameId.DeathMorphFrayed, frame: 'death-morph-frayed',
    sourceTextureKey: TEX_DEATH_MORPH_FRAYED, width: 24, height: 24, ensure: ensureDeathMorphTextures,
  },
  {
    id: GpuVfxFrameId.DeathMorphPorous, frame: 'death-morph-porous',
    sourceTextureKey: TEX_DEATH_MORPH_POROUS, width: 24, height: 24, ensure: ensureDeathMorphTextures,
  },
  {
    id: GpuVfxFrameId.DeathMorphFragmented, frame: 'death-morph-fragmented',
    sourceTextureKey: TEX_DEATH_MORPH_FRAGMENTED, width: 24, height: 24, ensure: ensureDeathMorphTextures,
  },
  {
    id: GpuVfxFrameId.DeathMorphDust, frame: 'death-morph-dust',
    sourceTextureKey: TEX_DEATH_MORPH_DUST, width: 24, height: 24, ensure: ensureDeathMorphTextures,
  },
  {
    id: GpuVfxFrameId.DeathMorphFineDust, frame: 'death-morph-fine-dust',
    sourceTextureKey: TEX_DEATH_MORPH_FINE_DUST, width: 24, height: 24, ensure: ensureDeathMorphTextures,
  },
  {
    id: GpuVfxFrameId.DeathDustMoteA, frame: 'death-dust-mote-a',
    sourceTextureKey: TEX_DEATH_DUST_MOTE_A, width: 24, height: 24, ensure: ensureDeathDustMoteTextures,
  },
  {
    id: GpuVfxFrameId.DeathDustMoteB, frame: 'death-dust-mote-b',
    sourceTextureKey: TEX_DEATH_DUST_MOTE_B, width: 24, height: 24, ensure: ensureDeathDustMoteTextures,
  },
  {
    id: GpuVfxFrameId.DeathDustMoteC, frame: 'death-dust-mote-c',
    sourceTextureKey: TEX_DEATH_DUST_MOTE_C, width: 24, height: 24, ensure: ensureDeathDustMoteTextures,
  },
];

/** Transparenter Rand um jeden Frame, in Pixeln. */
export const GPU_VFX_ATLAS_PADDING = 2;

/** Garantierte WebGL2-Untergrenze fuer `MAX_TEXTURE_SIZE`. */
const MAX_ATLAS_SIZE = 2048;

export interface GpuVfxAtlasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Fuer Diagnose und Tests: wo jeder Frame im fertigen Bild liegt. */
export interface GpuVfxAtlasLayout {
  readonly size: number;
  readonly rects: readonly GpuVfxAtlasRect[];
}

/**
 * Shelf-Packer, absteigend nach Hoehe. Liefert die kleinste passende Zweierpotenz – die
 * Atlasgroesse steht damit nicht im Code, sondern ergibt sich aus dem Manifest.
 */
export function packGpuVfxAtlas(entries: readonly GpuVfxAtlasEntry[] = GPU_VFX_ATLAS): GpuVfxAtlasLayout {
  const pad = GPU_VFX_ATLAS_PADDING;
  const order = entries
    .map((entry, index) => ({ index, entry }))
    .sort((a, b) => (b.entry.height - a.entry.height) || (b.entry.width - a.entry.width));

  for (let size = 16; size <= MAX_ATLAS_SIZE; size *= 2) {
    const rects = tryPack(order, size, pad, entries.length);
    if (rects) return { size, rects };
  }

  throw new Error(`[GpuVfxAtlas] Frames passen in keinen Atlas bis ${MAX_ATLAS_SIZE}px.`);
}

function tryPack(
  order: readonly { index: number; entry: GpuVfxAtlasEntry }[],
  size: number,
  pad: number,
  count: number,
): GpuVfxAtlasRect[] | null {
  const rects = new Array<GpuVfxAtlasRect>(count);
  let shelfY = pad;
  let shelfHeight = 0;
  let cursorX = pad;

  for (const { index, entry } of order) {
    if (cursorX + entry.width + pad > size) {
      // Neues Regal.
      shelfY += shelfHeight + pad;
      shelfHeight = 0;
      cursorX = pad;
    }
    if (shelfY + entry.height + pad > size) return null;

    rects[index] = { x: cursorX, y: shelfY, width: entry.width, height: entry.height };
    cursorX += entry.width + pad;
    shelfHeight = Math.max(shelfHeight, entry.height);
  }

  return rects;
}

/** Aufgeloeste Frame-Objekte, indiziert ueber `GpuVfxFrameId`; einmal beim Bau gefuellt. */
const resolvedFrames: (Phaser.Textures.Frame | null)[] = GPU_VFX_ATLAS.map(() => null);
let built = false;

/**
 * Baut den Atlas vollstaendig und friert ihn ein. Idempotent; muss vor der ersten Lane laufen.
 */
export function buildGpuVfxAtlas(scene: Phaser.Scene): void {
  if (built && scene.textures.exists(GPU_VFX_ATLAS_KEY)) return;

  const entries = [...GPU_VFX_ATLAS].sort((a, b) => a.id - b.id);
  for (const entry of entries) entry.ensure?.(scene);

  const layout = packGpuVfxAtlas();
  const existing = scene.textures.exists(GPU_VFX_ATLAS_KEY)
    ? (scene.textures.get(GPU_VFX_ATLAS_KEY) as Phaser.Textures.CanvasTexture)
    : scene.textures.createCanvas(GPU_VFX_ATLAS_KEY, layout.size, layout.size);
  if (!existing) return;

  const canvas = existing;
  const ctx = canvas.context;
  if (ctx) {
    ctx.clearRect(0, 0, layout.size, layout.size);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    // `layout.rects` liegt in der Reihenfolge von `GPU_VFX_ATLAS`, `resolvedFrames` dagegen
    // unter der stabilen Manifest-Id – die Reihenfolge im Manifest darf keinen Frame verschieben.
    const rect = layout.rects[GPU_VFX_ATLAS.indexOf(entry)];
    if (ctx && entry.sourceTextureKey && scene.textures.exists(entry.sourceTextureKey)) {
      const source = scene.textures.get(entry.sourceTextureKey).getSourceImage();
      // Ganzzahlige Zielkoordinaten: alles andere waere eine resamplete, nicht pixelgleiche Kopie.
      ctx.drawImage(source as CanvasImageSource, rect.x | 0, rect.y | 0);
    }
    // `__void` hat `id === 0` und wird deshalb zuerst eingefuegt: `Texture.add()` befoerdert den
    // ersten Frame zu `firstFrame`, und der ist ab dann der Default fuer Member ohne `frame`.
    if (!canvas.has(entry.frame)) {
      canvas.add(entry.frame, 0, rect.x, rect.y, rect.width, rect.height);
    }
    resolvedFrames[entry.id] = canvas.get(entry.frame);
  }

  canvas.refresh();
  built = true;
}

/**
 * Das aufgeloeste Phaser-Frame zu einer Manifest-ID. `SpriteGPULayer` braucht einen Namen oder
 * ein Frame-Objekt – eine Zahl liefe in `frameDataIndices[undefined]` und damit auf `NaN`.
 */
export function getGpuVfxFrame(id: GpuVfxFrameId): Phaser.Textures.Frame {
  const frame = resolvedFrames[id];
  if (!frame) {
    throw new Error(`[GpuVfxAtlas] Frame ${id} angefragt, bevor der Atlas gebaut wurde.`);
  }
  return frame;
}

/** Nur fuer Tests: den Modulzustand zwischen zwei Szenen zuruecksetzen. */
export function resetGpuVfxAtlasForTests(): void {
  built = false;
  resolvedFrames.fill(null);
}
