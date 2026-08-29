import { describe, expect, it } from 'vitest';
import {
  buildSecondaryObjectiveViewModel,
  getSecondaryObjectiveTargets,
  isCarryDeliveryZoneMarked,
  SECONDARY_OBJECTIVE_MAX_CHIPS,
  SECONDARY_OBJECTIVE_TERMINAL_HOLD_MS,
} from '../src/ui/coopDefenseSecondaryObjectiveModel';
import { getCoopDefenseMapConfig, normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../src/config/coopDefenseMaps';
import type {
  CoopDefenseSecondaryObjectivePresentationEntry,
  SyncedCoopDefenseCarryItem,
} from '../src/types';

function makeEntry(
  overrides: Partial<CoopDefenseSecondaryObjectivePresentationEntry> = {},
): CoopDefenseSecondaryObjectivePresentationEntry {
  return {
    objectiveId: 'brood',
    type: 'destroy',
    state: 'active',
    focused: true,
    progressCurrent: 0,
    progressTotal: 3,
    stateChangedAtMs: 0,
    ...overrides,
  };
}

function makeConfig(
  overrides: Partial<ResolvedCoopDefenseMapSecondaryObjectiveConfig> = {},
): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'brood',
    type: 'destroy',
    start: { type: 'time', atMs: 0 },
    targets: ['a', 'b', 'c'],
    targetGoal: 3,
    ...overrides,
  };
}

describe('Coop defense secondary objective view model', () => {
  it('shows nothing without a snapshot or with only dormant entries', () => {
    expect(buildSecondaryObjectiveViewModel(null, [], 0).focus).toBeNull();
    expect(buildSecondaryObjectiveViewModel([], [], 0).chips).toEqual([]);
    const dormant = buildSecondaryObjectiveViewModel([makeEntry({ state: 'dormant' })], [], 0);
    expect(dormant.focus).toBeNull();
    expect(dormant.chips).toEqual([]);
  });

  it('resolves semantic objective IDs and falls back per archetype', () => {
    const authored = buildSecondaryObjectiveViewModel(
      [makeEntry({ objectiveId: 'destroy-brood-front' })],
      [makeConfig({ id: 'destroy-brood-front' })],
      0,
    );
    expect(authored.focus?.title).toBe('BRUTNESTER ZERSTÖREN');
    expect(authored.focus?.rewardHint).toBe('WENIGER GEGNERDRUCK · BONUS-XP');

    const fallback = buildSecondaryObjectiveViewModel([makeEntry({ type: 'carry' })], [], 0);
    expect(fallback.focus?.title).toBe('FRACHT BERGEN');
    expect(fallback.focus?.rewardHint.length).toBeGreaterThan(0);
  });

  it('hands the full title to the HUD, which shortens it pixel-exact', () => {
    const model = buildSecondaryObjectiveViewModel(
      [makeEntry({ objectiveId: 'destroy-brood-front' })],
      [makeConfig({ id: 'destroy-brood-front' })],
      0,
    );
    expect(model.focus?.title).toBe('BRUTNESTER ZERSTÖREN');
  });

  it('keeps an unfocused objective visible as a background entry with countable progress', () => {
    const model = buildSecondaryObjectiveViewModel(
      [makeEntry({ focused: false, progressCurrent: 2 })],
      [makeConfig()],
      50_000,
    );
    // Fokusverlust darf nicht wie ein Abbruch aussehen: Der Eintrag bleibt sichtbar.
    expect(model.focus).toBeNull();
    expect(model.chips).toHaveLength(1);
    expect(model.chips[0].tone).toBe('background');
    expect(model.chips[0].progressCurrent).toBe(2);
  });

  it('gives the focus slot to a fresh completion, but yields it to a running objective', () => {
    const completed = makeEntry({
      objectiveId: 'brood', state: 'completed', focused: false, progressCurrent: 3, stateChangedAtMs: 10_000,
    });
    const alone = buildSecondaryObjectiveViewModel([completed], [makeConfig()], 11_000);
    expect(alone.focus?.objectiveId).toBe('brood');
    expect(alone.focus?.tone).toBe('completed');
    expect(alone.focus?.statusLine).toBe('ERFÜLLT');

    const running = makeEntry({ objectiveId: 'beer', type: 'carry', focused: true, stateChangedAtMs: 10_500 });
    const contested = buildSecondaryObjectiveViewModel([completed, running], [makeConfig()], 11_000);
    expect(contested.focus?.objectiveId).toBe('beer');
    expect(contested.chips.map((chip) => chip.objectiveId)).toEqual(['brood']);
  });

  it('drops a terminal entry once its hold window has passed', () => {
    const failed = makeEntry({ state: 'failed', focused: false, stateChangedAtMs: 10_000 });
    const inside = buildSecondaryObjectiveViewModel(
      [failed], [makeConfig()], 10_000 + SECONDARY_OBJECTIVE_TERMINAL_HOLD_MS - 1,
    );
    expect(inside.focus?.statusLine).toBe('GESCHEITERT');

    const outside = buildSecondaryObjectiveViewModel(
      [failed], [makeConfig()], 10_000 + SECONDARY_OBJECTIVE_TERMINAL_HOLD_MS + 1,
    );
    expect(outside.focus).toBeNull();
    expect(outside.chips).toEqual([]);
  });

  it('bounds the background list', () => {
    const entries = Array.from({ length: SECONDARY_OBJECTIVE_MAX_CHIPS + 3 }, (_, index) => makeEntry({
      objectiveId: `objective-${index}`,
      focused: false,
    }));
    const model = buildSecondaryObjectiveViewModel(entries, [], 0);
    expect(model.chips.length).toBeLessThanOrEqual(SECONDARY_OBJECTIVE_MAX_CHIPS);
  });

  it('changes its signature exactly on progress, state and focus changes', () => {
    const base = buildSecondaryObjectiveViewModel([makeEntry()], [makeConfig()], 0);
    const same = buildSecondaryObjectiveViewModel([makeEntry()], [makeConfig()], 999);
    expect(same.signature).toBe(base.signature);

    const progressed = buildSecondaryObjectiveViewModel(
      [makeEntry({ progressCurrent: 1 })], [makeConfig()], 0,
    );
    expect(progressed.signature).not.toBe(base.signature);

    const unfocused = buildSecondaryObjectiveViewModel(
      [makeEntry({ focused: false })], [makeConfig()], 0,
    );
    expect(unfocused.signature).not.toBe(base.signature);
  });

  it('clamps implausible progress instead of rendering it', () => {
    const model = buildSecondaryObjectiveViewModel(
      [makeEntry({ progressCurrent: 9, progressTotal: 3 })], [makeConfig()], 0,
    );
    expect(model.focus?.progressCurrent).toBe(3);
    expect(model.focus?.progressTotal).toBe(3);
  });

  it('shows a running Hold as a status instead of a meaningless zero', () => {
    const holdConfig = makeConfig({ id: 'outpost', type: 'hold', targets: ['post'], targetGoal: 1 });
    const running = buildSecondaryObjectiveViewModel(
      [makeEntry({ objectiveId: 'outpost', type: 'hold', progressCurrent: 0, progressTotal: 1 })],
      [holdConfig],
      0,
    );
    expect(running.focus?.statusLine).toBe('HALTEN');
    // Entscheidend fuer das HUD: Eine Statuszeile ist kein Abschluss – sonst kuendigte die
    // laufende Mission sich selbst als erfuellt an.
    expect(running.focus?.terminal).toBe(false);
    expect(running.focus?.tone).toBe('focus');
    expect(running.focus?.progressTotal).toBe(1);

    const completed = buildSecondaryObjectiveViewModel(
      [makeEntry({
        objectiveId: 'outpost',
        type: 'hold',
        state: 'completed',
        focused: false,
        progressCurrent: 1,
        progressTotal: 1,
      })],
      [holdConfig],
      0,
    );
    expect(completed.focus?.statusLine).toBe('ERFÜLLT');
    expect(completed.focus?.terminal).toBe(true);
    expect(completed.signature).not.toBe(running.signature);

    const lost = buildSecondaryObjectiveViewModel(
      [makeEntry({ objectiveId: 'outpost', type: 'hold', state: 'failed', focused: false, progressTotal: 1 })],
      [holdConfig],
      0,
    );
    expect(lost.focus?.statusLine).toBe('GESCHEITERT');
    expect(lost.focus?.terminal).toBe(true);
  });

  it('marks only terminal states as terminal', () => {
    const active = buildSecondaryObjectiveViewModel([makeEntry()], [makeConfig()], 0);
    expect(active.focus?.terminal).toBe(false);
    expect(active.focus?.statusLine).toBeNull();
  });

  it('resolves marker targets from the authored configuration', () => {
    expect(getSecondaryObjectiveTargets([makeConfig()], 'brood')).toEqual(['a', 'b', 'c']);
    expect(getSecondaryObjectiveTargets([makeConfig()], 'unknown')).toEqual([]);
  });
});

describe('Coop defense carry world guidance', () => {
  function makeItem(
    overrides: Partial<SyncedCoopDefenseCarryItem> = {},
  ): SyncedCoopDefenseCarryItem {
    return {
      id: 'beer:0', objectiveId: 'beer', x: 0, y: 0, holderId: null, state: 'spawned', ...overrides,
    };
  }

  it('marks the delivery zone only while the team actually carries an object', () => {
    expect(isCarryDeliveryZoneMarked([makeItem()], 'beer')).toBe(false);
    expect(isCarryDeliveryZoneMarked([makeItem({ state: 'dropped' })], 'beer')).toBe(false);
    expect(
      isCarryDeliveryZoneMarked([makeItem({ state: 'carried', holderId: 'player-a' })], 'beer'),
    ).toBe(true);
  });

  it('keeps the zones of two carry missions apart', () => {
    const items = [
      makeItem({ id: 'beer:0', state: 'carried', holderId: 'player-a' }),
      makeItem({ id: 'crate:0', objectiveId: 'crate' }),
    ];
    expect(isCarryDeliveryZoneMarked(items, 'beer')).toBe(true);
    expect(isCarryDeliveryZoneMarked(items, 'crate')).toBe(false);
  });

  it('stops marking the delivery zone once the last object was secured', () => {
    expect(isCarryDeliveryZoneMarked([], 'beer')).toBe(false);
  });
});

describe('Coop defense secondary objective labels', () => {
  it('keeps presentation labels out of the resolved map config', () => {
    // Kampagnen-Map statt Testarena: Map 0 ist eine loeschbare Stressarena.
    const objective = getCoopDefenseMapConfig('17').secondaryObjectives?.[0];
    expect(objective).not.toHaveProperty('displayName');
    expect(objective).not.toHaveProperty('rewardHint');
  });

  it('ignores legacy presentation fields during normalization', () => {
    const base = getCoopDefenseMapConfig('17');
    const withObjective = (displayName: string) => ({
      ...base,
      bases: base.bases.filter((candidate) => candidate.id !== base.persistentBase?.baseId),
      secondaryObjectives: (base.secondaryObjectives ?? []).map((objective) => ({ ...objective, displayName })),
    });
    expect(normalizeCoopDefenseMapConfig(withObjective('   ')).secondaryObjectives?.[0]).not.toHaveProperty('displayName');
    expect(normalizeCoopDefenseMapConfig(withObjective('X'.repeat(40))).secondaryObjectives?.[0]).not.toHaveProperty('displayName');
  });
});
