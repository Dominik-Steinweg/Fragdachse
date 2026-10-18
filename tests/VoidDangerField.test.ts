import { describe, expect, it } from 'vitest';
import { VoidDangerField, resolveVoidDangerSources, voidHazardSource, type VoidDangerSource } from '../src/arena/VoidDangerField';
import { markVoidPondColonies, type EcologyPlacement } from '../src/arena/WoodlandEcologyField';
import { voidLilyFrame, voidRockFrame } from '../src/arena/VoidFloraAssets';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { toWorldDefinition } from '../src/config/authoring/coopDefenseAuthoringAdapter';
import { getWorldDefinition } from '../src/config/authoring/authoredScenarios';
import { LOBBY_WORLD_DEFINITION_ID } from '../src/config/authoring/lobbyWorld';

const CELL = 32;
/** A hostile main base around cell (20, 20), a spawn zone at cells 60..65 x 10..17, a friendly base. */
const world = (): VoidDangerSource[] => resolveVoidDangerSources({
  config: undefined, offsetX: 0, offsetY: 0,
  bases: [
    { id: 'hive', faction: 'hostile', role: 'main', cells: [{ gridX: 20, gridY: 20 }, { gridX: 21, gridY: 20 }, { gridX: 20, gridY: 21 }, { gridX: 21, gridY: 21 }] },
    { id: 'home', faction: 'friendly', role: 'main', cells: [{ gridX: 100, gridY: 40 }] },
  ],
  spawnZones: [{ id: 'nest', gridX: 60, gridY: 10, widthCells: 6, heightCells: 8 }],
});
const at = (gridX: number, gridY: number): [number, number] => [(gridX + .5) * CELL, (gridY + .5) * CELL];

describe('void danger field (GDD Void-Gefahrenzonen V1)', () => {
  it('carries no void at all without danger: PvP, the lobby and safe ground', () => {
    const empty = new VoidDangerField([], 7);
    expect(empty.empty).toBe(true);
    for (let i = 0; i < 100; i++) {
      expect(empty.intensityAt(i * 97, i * 41)).toBe(0);
      expect(empty.hazeAt(i * 97, i * 41)).toBe(0);
    }
    // PvP worlds have no authored definition; the lobby has no hostile places.
    const lobby = getWorldDefinition(LOBBY_WORLD_DEFINITION_ID)!;
    expect(lobby.bases.some(base => base.faction === 'hostile')).toBe(false);
    expect(lobby.spawnZones ?? []).toEqual([]);
    expect(lobby.krakenHabitat).toBeUndefined();
  });

  it('takes the flora inside dangerous places and fades out over a broken rim', () => {
    const field = new VoidDangerField(world(), 4242);
    expect(field.intensityAt(...at(20.5, 20.5))).toBeGreaterThan(.9);
    expect(field.intensityAt(...at(62, 13))).toBeGreaterThan(.8);
    // Far from any danger, and at the friendly base, nothing is taken.
    expect(field.intensityAt(...at(100, 40))).toBe(0);
    expect(field.intensityAt(...at(40, 60))).toBe(0);
    // The rim is not a circle: at equal distance from the heart the takeover differs.
    const ring = Array.from({ length: 24 }, (_, i) => {
      const a = i / 24 * Math.PI * 2;
      return field.intensityAt((21 + Math.cos(a) * 9) * CELL, (21 + Math.sin(a) * 9) * CELL);
    });
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(.1);
  });

  it('keeps a spawn zone hazy at rest, thinner than a hostile base', () => {
    const field = new VoidDangerField(world(), 1);
    const zone = field.hazeAt(...at(62, 13)), base = field.hazeAt(...at(20.5, 20.5));
    expect(zone).toBeGreaterThan(.3);
    expect(zone).toBeLessThan(base);
  });

  it('lets the haze of a place without presence lift while its plants stay as a scar', () => {
    const field = new VoidDangerField(world(), 9);
    const gone = (id: string) => id === 'base:hive' ? 0 : 1;
    expect(field.hazeAt(...at(20.5, 20.5), gone)).toBe(0);
    expect(field.hazeAt(...at(62, 13), gone)).toBe(field.hazeAt(...at(62, 13)));
    expect(field.intensityAt(...at(20.5, 20.5))).toBeGreaterThan(.9);
    expect(field.reachOf('base:hive')!.width).toBeGreaterThan(0);
    expect(field.reachOf('base:nowhere')).toBeNull();
  });

  it('is deterministic and changes its signature only with its sources', () => {
    const a = new VoidDangerField(world(), 777), b = new VoidDangerField(world(), 777);
    for (let i = 0; i < 200; i++) {
      const x = 400 + i * 13.7, y = 400 + i * 7.9;
      expect(a.intensityAt(x, y)).toBe(b.intensityAt(x, y));
      expect(a.hazeAt(x, y)).toBe(b.hazeAt(x, y));
    }
    expect(a.signature).toBe(b.signature);
    expect(new VoidDangerField(world(), 778).signature).not.toBe(a.signature);
    expect(new VoidDangerField([...world(), voidHazardSource('patch', 0, 0, [{ gridX: 5, gridY: 5 }])], 777).signature).not.toBe(a.signature);
  });

  it('covers the cells of a permanent hazard and its near surroundings only', () => {
    const corridor = Array.from({ length: 30 }, (_, i) => ({ gridX: 10 + i, gridY: 50 }));
    const field = new VoidDangerField([voidHazardSource('corridor', 0, 0, corridor)], 3);
    expect(field.intensityAt(...at(25, 50))).toBeGreaterThan(.85);
    expect(field.intensityAt(...at(25, 51))).toBeGreaterThan(.5);
    expect(field.intensityAt(...at(25, 60))).toBe(0);
  });

  it('marks the kraken pond and its exits on Map 20, and every spawn zone of a zone map', () => {
    const definition = toWorldDefinition(getCoopDefenseMapConfig('20'));
    const sources = resolveVoidDangerSources({ config: definition.voidDanger, offsetX: 0, offsetY: 0, bases: [],
      spawnZones: definition.spawnZones, krakenHabitat: definition.krakenHabitat });
    const habitat = sources.find(source => source.id === 'habitat')!;
    expect(habitat.shapes.filter(shape => shape.kind === 'capsule').length).toBeGreaterThan(0);
    expect(sources.filter(source => source.id.startsWith('zone:')).map(source => source.id.slice(5)))
      .toEqual(definition.spawnZones!.map(zone => zone.id));
  });

  it('keeps neighbours alike: no single infested plant among untouched ones', () => {
    const field = new VoidDangerField(world(), 4242);
    let isolated = 0, taken = 0;
    for (let y = 0; y < 1600; y += 40) for (let x = 0; x < 3200; x += 40) {
      if (field.amountAt(x, y) <= .5) continue;
      taken++;
      if ([[40, 0], [-40, 0], [0, 40], [0, -40]].every(([dx, dy]) => field.amountAt(x + dx, y + dy) < .1)) isolated++;
    }
    expect(taken).toBeGreaterThan(0);
    expect(isolated).toBe(0);
  });

  it('marks lily plants without moving, re-ranking or re-picking any placement; ponds turn together', () => {
    const placements: EcologyPlacement[] = [];
    for (let pond = 0; pond < 6; pond++) for (let colony = 0; colony < 3; colony++) for (let i = 0; i < 6; i++) placements.push({
      kind: 'pond', frame: i ? 'lily-pad-01' : 'lily-group-01', x: 400 + pond * 120 + colony * 30 + i * 4, y: 560 + colony * 20 + i * 3,
      size: 30, rotation: i, alpha: .94, rank: i * .1, floating: true, pond, colony: pond * 8 + colony,
    });
    placements.push({ kind: 'litter', frame: 'leaf-01', x: 3000, y: 1500, size: 20, rotation: 0, alpha: .5, rank: .2, floating: false });
    const before = placements.map(({ void: _void, voidAmount: _amount, ...rest }) => rest);
    const field = new VoidDangerField(world(), 99);
    const taken = markVoidPondColonies(placements, field);
    expect(placements.map(({ void: _void, voidAmount: _amount, ...rest }) => rest)).toEqual(before);
    expect(taken).toBeGreaterThan(0);
    for (let pond = 0; pond < 6; pond++) {
      const amounts = placements.filter(p => p.pond === pond).map(p => p.voidAmount!);
      expect(Math.max(...amounts) - Math.min(...amounts), `pond ${pond}`).toBeLessThan(.5);
    }
    expect(placements.at(-1)!.voidAmount).toBe(0);
    markVoidPondColonies(placements, null);
    expect(placements.some(p => p.void)).toBe(false);
  });

  it('maps natural lilies to void art of the same family: early infection on the rim, converted inside', () => {
    for (const roll of [0, .3, .6, .99]) {
      expect(voidLilyFrame('lily-pad-01', .4, roll)).toMatch(/^void-lily-pad-/);
      expect(voidLilyFrame('lily-group-02', .95, roll)).toMatch(/^void-lily-group-/);
      // The natural pair keeps a pair.
      expect(voidLilyFrame('lily-pad-03', .9, roll)).toBe('void-lily-pad-06');
      expect(voidLilyFrame('lily-pad-02', .9, roll)).not.toBe('void-lily-pad-06');
    }
    expect(voidLilyFrame('lily-pad-01', .4, 0)).not.toBe(voidLilyFrame('lily-pad-01', .95, 0));
    expect(voidRockFrame('moss-nest', .5)?.name).toMatch(/^void-moss-nest-/);
    expect(voidRockFrame('no-such-kind', .5)).toBeNull();
  });

  it('replaces only established plants with art and leaves the natural selection untouched', () => {
    const placements: EcologyPlacement[] = Array.from({ length: 30 }, (_, i) => ({
      kind: 'pond' as const, frame: i % 2 ? 'lily-pad-01' : 'lily-group-01', x: 100 + i * 11, y: 200, size: 40, rotation: 0,
      alpha: .94, rank: .1, floating: true, pond: 0, colony: Math.floor(i / 6) }));
    const full = { intensityAt: () => 1, amountOf: () => 1 }, none = { intensityAt: () => 0, amountOf: () => 0 };
    markVoidPondColonies(placements, full, voidLilyFrame);
    expect(placements.every(p => p.voidFrame?.startsWith('void-'))).toBe(true);
    expect(placements.every(p => p.frame.startsWith('lily-'))).toBe(true);
    markVoidPondColonies(placements, none, voidLilyFrame);
    expect(placements.some(p => p.voidFrame)).toBe(false);
  });
});
