import { describe, expect, it, vi } from 'vitest';
import rawMap08 from '../src/config/coopDefenseMaps/08-dimensionsbruch.json';
import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { isCoopDefenseSideEncounter } from '../src/config/coopDefenseMapAuthoring';
import { resolveCoopDefensePortalLink } from '../src/config/coopDefensePortalLinks';
import { PortalLinkSystem, type PortalLinkStateEntry } from '../src/systems/portal/PortalLinkSystem';
import { WorldPortalTransport, type PortalActor, type PortalPairSource } from '../src/systems/portal/WorldPortalTransport';
import { decodePortalLinkState, encodePortalLinkState } from '../src/network/coopPortalLinkCodec';
import { resolveVoidPortalViews, VoidPortalTransitionTracker } from '../src/effects/voidPortal/VoidPortalModel';
import { CoopDefenseSiteActivationSystem } from '../src/systems/CoopDefenseSiteActivationSystem';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';

const raw = (): CoopDefenseMapConfig => structuredClone(rawMap08) as unknown as CoopDefenseMapConfig;
const withLink = (patch: Record<string, unknown>): CoopDefenseMapConfig => {
  const map = raw();
  return { ...map, portalLinks: [{ ...map.portalLinks![0], ...patch } as never] };
};

describe('Portal link authoring', () => {
  it('resolves the Map 08 flank with explicit defaults and keeps its guard beside the assault chain', () => {
    const map = getCoopDefenseMapConfig('8');
    const link = resolveCoopDefensePortalLink(map.portalLinks![0]);
    expect(link).toMatchObject({ id: 'dimension-flank', generatorBaseId: 'portal-generator', chargeStartMs: 0,
      chargeDurationMs: 75000, radiusPx: 28, maxBodyRadiusPx: 20 });
    const guard = map.encounters!.find((encounter) => encounter.id === 'portal-guard')!;
    expect(isCoopDefenseSideEncounter(map.objective, guard)).toBe(true);
    expect(map.encounters!.filter((encounter) => !isCoopDefenseSideEncounter(map.objective, encounter)).at(-1)?.id)
      .toBe('dimension-collapse');
  });

  it.each([
    ['a friendly generator', (map: CoopDefenseMapConfig) => ({ ...map,
      bases: map.bases.map((base) => base.id === 'portal-generator' ? { ...base, faction: 'friendly' as const } : base) })],
    ['an expiring destroy objective', (map: CoopDefenseMapConfig) => ({ ...map,
      secondaryObjectives: map.secondaryObjectives!.map((entry) => entry.id === 'destroy-portal-generator'
        ? { ...entry, expiresAt: { type: 'time' as const, atMs: 1000 } } : entry) })],
    ['anchors too close together', (map: CoopDefenseMapConfig) => ({ ...map,
      portalAnchors: [map.portalAnchors![0], { ...map.portalAnchors![1], gridX: 40, gridY: 9 }] })],
    ['an exit inside the persistent base reservation', (map: CoopDefenseMapConfig) => ({ ...map,
      portalAnchors: [map.portalAnchors![0], { ...map.portalAnchors![1], gridX: 88, gridY: 26 }] })],
    ['an anchor clearing on water', (map: CoopDefenseMapConfig) => ({ ...map,
      portalAnchors: [{ ...map.portalAnchors![0], gridX: 36, gridY: 18 }, map.portalAnchors![1]] })],
    ['an announced side encounter', (map: CoopDefenseMapConfig) => ({ ...map,
      encounters: map.encounters!.map((entry) => entry.id === 'portal-guard' ? { ...entry, announce: undefined } : entry) })],
  ])('rejects %s', (_label, mutate) => {
    expect(() => normalizeCoopDefenseMapConfig(mutate(raw()))).toThrow();
  });

  it('rejects radii that let a permitted body outgrow the portal', () => {
    expect(() => normalizeCoopDefenseMapConfig(withLink({ radiusPx: 20, maxBodyRadiusPx: 24 }))).toThrow(/maxBodyRadiusPx/);
    expect(() => normalizeCoopDefenseMapConfig(withLink({ chargeDurationMs: undefined }))).toThrow(/chargeDurationMs/);
  });
});

function system(overrides: { standing?: () => boolean } = {}) {
  const config = resolveCoopDefensePortalLink(getCoopDefenseMapConfig('8').portalLinks![0]);
  let registered: PortalPairSource | null = null;
  const unregister = vi.fn(() => { registered = null; });
  const transport = { register: vi.fn((source: PortalPairSource) => { registered = source; return unregister; }),
    collapse: vi.fn() };
  const published: (readonly PortalLinkStateEntry[] | null)[] = [];
  const nav = vi.fn();
  let standing = true;
  const links = new PortalLinkSystem({
    links: [config],
    endpoints: new Map([[config.id, { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }]]),
    transport, isGeneratorStanding: overrides.standing ?? (() => standing),
    isHostileEnemy: (id) => id.startsWith('enemy'), setNavigationLinks: nav,
    publish: (entries) => published.push(entries),
  });
  return { links, config, transport, unregister, published, nav, source: () => registered,
    fell: () => { standing = false; } };
}

describe('PortalLinkSystem', () => {
  it('charges, then opens one pair and one navigation link exactly when the charge completes', () => {
    const s = system();
    s.links.hostUpdate(10, false, 10);
    expect(s.links.getState()[0]).toMatchObject({ phase: 'charging', chargeStartedAtMs: 0 });
    expect(s.links.getPortalPairs()).toHaveLength(0);
    s.links.hostUpdate(s.config.chargeDurationMs - 20, false, 20);
    expect(s.links.getPortalPairs()).toHaveLength(0);
    s.links.hostUpdate(10, false, 30);
    expect(s.links.getState()[0]).toMatchObject({ phase: 'open', openedAtMs: s.config.chargeDurationMs });
    expect(s.links.getPortalPairs()).toHaveLength(1);
    expect(s.nav).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'dimension-flank', ax: 0, bx: 3000,
      maxBodyRadiusPx: 20, costPx: s.config.linkCostPx })]);
    expect(s.links.isPortalFriendly()).toBe(false);
  });

  it('keeps bosses, fixed bodies and oversized bodies out of the portal', () => {
    const s = system();
    s.links.hostUpdate(s.config.chargeDurationMs, false, 0);
    const pair = s.links.getPortalPairs()[0];
    const actor = (extra: Partial<PortalActor>): PortalActor => ({ id: 'enemy', kind: 'enemy', x: 0, y: 0, radius: 12,
      alive: true, surface: true, revision: 0, ...extra });
    expect(s.links.admitsActor(pair, actor({}))).toBe(true);
    expect(s.links.admitsActor(pair, actor({ boss: true }))).toBe(false);
    expect(s.links.admitsActor(pair, actor({ fixed: true }))).toBe(false);
    expect(s.links.admitsActor(pair, actor({ radius: 21 }))).toBe(false);
  });

  it('collapses an open link for good and pulls only hostile enemies', () => {
    const s = system();
    s.links.hostUpdate(s.config.chargeDurationMs, false, 0);
    s.fell();
    s.links.hostUpdate(16, false, 5);
    expect(s.links.getState()[0]).toMatchObject({ phase: 'collapsed' });
    expect(s.links.getPortalPairs()).toHaveLength(0);
    expect(s.nav).toHaveBeenLastCalledWith([]);
    expect(s.transport.collapse).toHaveBeenCalledTimes(1);
    const affects = s.transport.collapse.mock.calls[0][3] as (actor: PortalActor) => boolean;
    expect(affects({ id: 'enemy-1' } as PortalActor)).toBe(true);
    expect(affects({ id: 'ally-1' } as PortalActor)).toBe(false);
    s.links.hostUpdate(16, false, 6);
    expect(s.transport.collapse).toHaveBeenCalledTimes(1);
  });

  it('closes a charging link without a pull and leaves silently on teardown', () => {
    const s = system();
    s.links.hostUpdate(1000, false, 0);
    s.fell();
    s.links.hostUpdate(16, false, 1);
    expect(s.links.getState()[0]).toMatchObject({ phase: 'collapsed', chargeStartedAtMs: 0 });
    expect(s.transport.collapse).not.toHaveBeenCalled();
    s.links.destroy(); s.links.destroy();
    expect(s.unregister).toHaveBeenCalledTimes(1);
    expect(s.published.at(-1)).toBeNull();
  });

  it('does not advance during the countdown', () => {
    const s = system();
    s.links.hostUpdate(s.config.chargeDurationMs * 2, true, 0);
    expect(s.links.getState()[0].phase).toBe('waiting');
  });
});

describe('PortalLinkSystem with the World transport', () => {
  it('moves ordinary enemies only while the generator stands and never a boss', () => {
    const config = resolveCoopDefensePortalLink(getCoopDefenseMapConfig('8').portalLinks![0]);
    const actors = new Map<string, PortalActor>();
    const place = (id: string, x: number, extra: Partial<PortalActor> = {}) => actors.set(id, { id, kind: 'enemy', x, y: 0,
      radius: 12, alive: true, surface: true, revision: actors.get(id)?.revision ?? 0, ...extra });
    const transport = new WorldPortalTransport({ isAlive: () => true, applyDamage: vi.fn() } as never,
      { broadcastTranslocatorFlash: vi.fn() });
    transport.bindWorld({ getActors: () => [...actors.values()], canOccupy: () => true, collapseEnemy: vi.fn(),
      transferActor: (actor, x, y) => { const current = actors.get(actor.id)!;
        actors.set(actor.id, { ...current, x, y, revision: current.revision + 1 }); } });
    let standing = true;
    const links = new PortalLinkSystem({ links: [config],
      endpoints: new Map([[config.id, { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }]]), transport,
      isGeneratorStanding: () => standing, isHostileEnemy: () => true, publish: () => {} });
    links.hostUpdate(config.chargeDurationMs, false, 0);
    place('enemy', 0); place('enemy-boss', 0, { boss: true });
    transport.transferActors(1);
    expect(actors.get('enemy')).toMatchObject({ x: 3000 });
    expect(actors.get('enemy-boss')).toMatchObject({ x: 0, revision: 0 });

    standing = false;
    links.hostUpdate(16, false, 2);
    place('enemy-late', 0);
    transport.transferActors(3);
    expect(actors.get('enemy-late')).toMatchObject({ x: 0, revision: 0 });
    expect(transport.getPortalPairs()).toHaveLength(0);
  });
});

describe('Portal link replication', () => {
  const entries: PortalLinkStateEntry[] = [
    { id: 'dimension-flank', phase: 'open', chargeStartedAtMs: 0, openedAtMs: 75000.4 },
    { id: 'second', phase: 'collapsed', chargeStartedAtMs: 10, collapsedAtMs: 900 },
  ];

  it('round-trips the lifecycle of the current round only', () => {
    const wire = encodePortalLinkState(7, entries);
    expect(decodePortalLinkState(wire, 7)).toEqual([
      { id: 'dimension-flank', phase: 'open', chargeStartedAtMs: 0, openedAtMs: 75000 },
      { id: 'second', phase: 'collapsed', chargeStartedAtMs: 10, collapsedAtMs: 900 },
    ]);
    expect(decodePortalLinkState(wire, 8)).toBeNull();
    expect(decodePortalLinkState(wire, null)).toBeNull();
  });

  it.each([
    { rr: 1, l: [{ i: 'a', s: 'o', c: 5 }] },
    { rr: 1, l: [{ i: 'a', s: 'c', c: 10, o: 5 }] },
    { rr: 1, l: [{ i: 'a', s: 'o', c: 10, o: 5 }] },
    { rr: 1, l: [{ i: 'a', s: 'w' }, { i: 'a', s: 'w' }] },
    { rr: 1, l: [{ i: '../x', s: 'w' }] },
    { rr: 1, l: Array.from({ length: 5 }, (_, index) => ({ i: `l${index}`, s: 'w' })) },
  ])('rejects malformed snapshots as a whole (%#)', (wire) => {
    expect(decodePortalLinkState(wire, 1)).toBeNull();
  });
});

describe('Void portal presentation model', () => {
  const config = resolveCoopDefensePortalLink(getCoopDefenseMapConfig('8').portalLinks![0]);
  const endpoints = new Map([[config.id, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }]]);

  it('derives the charge fraction from the mission clock', () => {
    const views = resolveVoidPortalViews([config], endpoints,
      [{ id: config.id, phase: 'charging', chargeStartedAtMs: 0 }], config.chargeDurationMs / 2);
    expect(views[0]).toMatchObject({ phase: 'charging', chargeFraction: 0.5 });
    expect(resolveVoidPortalViews([config], endpoints, [{ id: config.id, phase: 'waiting' }], 0)).toEqual([]);
  });

  it('never replays a collapse that happened before the first snapshot', () => {
    const tracker = new VoidPortalTransitionTracker();
    expect(tracker.observe([{ id: 'a', phase: 'collapsed', collapsedAtMs: 5 }])).toEqual([]);
    tracker.reset();
    expect(tracker.observe([{ id: 'a', phase: 'open', chargeStartedAtMs: 0, openedAtMs: 1 }])).toEqual([]);
    expect(tracker.observe([{ id: 'a', phase: 'collapsed', chargeStartedAtMs: 0, openedAtMs: 1, collapsedAtMs: 9 }]))
      .toEqual([{ id: 'a', wasOpen: true }]);
    expect(tracker.observe([{ id: 'a', phase: 'collapsed', chargeStartedAtMs: 0, openedAtMs: 1, collapsedAtMs: 9 }]))
      .toEqual([]);
  });
});

describe('Structure-bound site activation', () => {
  it('activates the site of a hit structure once, like entering its clearing', () => {
    const sites = new CoopDefenseSiteActivationSystem(
      [{ id: 'site', gridX: 5, gridY: 5, radiusCells: 3, structureBaseId: 'generator' }, { id: 'other', gridX: 30, gridY: 5, radiusCells: 3 }],
      resolveCoopDefenseWorldMetrics(60, 40),
    );
    sites.reportStructureDamaged('unknown');
    sites.reportStructureDamaged('generator');
    expect(sites.isSiteActivated('site')).toBe(true);
    expect(sites.isSiteActivated('other')).toBe(false);
  });
});
