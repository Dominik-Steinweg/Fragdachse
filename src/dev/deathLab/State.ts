import { COLORS, PLAYER_VISUAL_SIZE } from '../../config';
import { getCoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';
import { getPipelineAssetForTexture, getPipelineSpriteScale } from '../../config/pipelineAssets';
import { getWalkingSheetForStaticTexture } from '../../animations/BadgerAnimations';
import type { SyncedDeathEffect } from '../../types';
import type { GraphicsQuality } from '../../graphics/GraphicsQuality';

const enemy = (id: string, kind: string, label: string) => {
  const config = getCoopDefenseEnemyConfig(kind);
  return { id, label, player: false, texture: config.imageKey, size: config.size,
    tint: config.color ?? 0xffffff, targetColor: COLORS.RED_2 };
};
export const FIXTURES = [
  { id: 'player', label: 'Spieler', player: true, texture: 'badger', size: PLAYER_VISUAL_SIZE,
    tint: 0xffffff, targetColor: COLORS.BLUE_2 },
  enemy('small', 'rabid-badger', 'Klein · Rabid Badger'),
  enemy('medium', 'zombie-badger', 'Mittel · Zombie Badger'),
  enemy('large', 'inferno-colossus', 'Groß · Inferno Colossus'),
] as const;

export const LAYERS = ['main', 'micro', 'glows', 'ghost', 'gore', 'postfx'] as const;
export type Layers = Record<typeof LAYERS[number], boolean>;
export interface LabSettings {
  fixture: string; pose: 'idle' | 'move'; frameIndex: number; seed: number;
  direction: number; rotation: number; size: number; zoom: number;
  follow: boolean;
  quality: GraphicsQuality; background: 'dark' | 'light' | 'forest'; layers: Layers;
}
export const INITIAL_SETTINGS: LabSettings = {
  fixture: 'player', pose: 'idle', frameIndex: 0, seed: 305419896,
  direction: 0, rotation: 0, size: PLAYER_VISUAL_SIZE, zoom: 1, follow: false,
  quality: 'high', background: 'dark',
  layers: { main: true, micro: true, glows: true, ghost: true, gore: false, postfx: false },
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Objekt erwartet.');
  return value as Record<string, unknown>;
}
export function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Zahl ${min}–${max} erwartet.`);
  return value;
}
export function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Boolean erwartet.');
  return value;
}
export function keys(raw: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`Unbekanntes Feld: ${key}`);
}
export function resolveSettings(patch: unknown, base: LabSettings): LabSettings {
  const raw = object(patch);
  keys(raw, Object.keys(INITIAL_SETTINGS));
  const next = { ...base, layers: { ...base.layers } };
  if (raw.follow !== undefined) next.follow = bool(raw.follow);
  if (raw.fixture !== undefined) {
    const fixture = FIXTURES.find(f => f.id === raw.fixture);
    if (!fixture) throw new Error('fixture: player, small, medium oder large.');
    next.fixture = fixture.id; next.size = fixture.size; next.frameIndex = 0;
  }
  for (const [key, options] of [['pose', ['idle', 'move']], ['quality', ['high', 'medium', 'low']],
    ['background', ['dark', 'light', 'forest']]] as const) {
    if (raw[key] !== undefined) {
      if (!options.includes(raw[key] as never)) throw new Error(`${key}: ${options.join(', ')}.`);
      Object.assign(next, { [key]: raw[key] });
    }
  }
  for (const [key, min, max] of [['seed', 0, 4294967295], ['frameIndex', 0, 500], ['direction', -360, 360],
    ['rotation', -360, 360], ['size', 8, 160], ['zoom', 0.5, 4]] as const) {
    if (raw[key] !== undefined) next[key] = finite(raw[key], min, max);
  }
  if (!Number.isInteger(next.seed) || !Number.isInteger(next.frameIndex)) throw new Error('Seed und Frameindex müssen ganzzahlig sein.');
  if (raw.layers !== undefined) {
    const layers = object(raw.layers); keys(layers, LAYERS);
    for (const key of LAYERS) if (layers[key] !== undefined) next.layers[key] = bool(layers[key]);
  }
  if (next.frameIndex >= fixtureFrames(next).length) throw new Error(`Frameindex maximal ${fixtureFrames(next).length - 1}.`);
  return next;
}
export function fixtureFrames(settings: LabSettings): readonly number[] {
  const fixture = FIXTURES.find(f => f.id === settings.fixture)!;
  const sheet = getWalkingSheetForStaticTexture(fixture.texture);
  return settings.pose === 'move' ? sheet?.frames ?? [0] : sheet?.idle?.frames ?? [0];
}
export function fixtureSnapshot(settings: LabSettings): SyncedDeathEffect {
  const fixture = FIXTURES.find(f => f.id === settings.fixture)!;
  const sheet = getWalkingSheetForStaticTexture(fixture.texture);
  const textureKey = sheet?.textureKey ?? fixture.texture;
  const displaySize = settings.size * getPipelineSpriteScale(textureKey);
  return { type: 'death', targetId: fixture.id, x: 0, y: 0,
    textureKey, frame: sheet ? fixtureFrames(settings)[settings.frameIndex] : '__BASE',
    displayWidth: displaySize, displayHeight: displaySize, tint: fixture.tint, targetColor: fixture.targetColor,
    rotation: settings.rotation * Math.PI / 180, seed: settings.seed,
    dirX: Math.cos(settings.direction * Math.PI / 180), dirY: Math.sin(settings.direction * Math.PI / 180) };
}
export function fixtureAssets() {
  return FIXTURES.map(f => ({ fixture: f.id, asset: getPipelineAssetForTexture(f.texture)!,
    sheet: getWalkingSheetForStaticTexture(f.texture) }));
}
