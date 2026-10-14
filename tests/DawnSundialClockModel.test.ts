import { describe, expect, it } from 'vitest';
import { buildDawnSundialLayout, buildDawnSundialState, sundialArcAngle, sundialHandAngle } from '../src/ui/dawn/DawnSundialClockModel';
import { getDawnSchedule, type DawnSchedule } from '../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { resolveDawnScenario } from '../src/dawn/resolution/DawnScenarioResolution';
import { DAWN_NIGHT_MODIFIER_IDS, DAWN_M3_ASSET_KEYS } from '../src/dawn/contracts/DawnContentIds';
import { getLocale, setLocale, t } from '../src/i18n';

describe('Dawn sundial projection', () => {
  const plans = composeDawnRoundPlans({ seed: 11, threat: 3, dayNumber: 3 });
  const schedule = getDawnSchedule(plans.activity.scheduleId);
  const encounters = resolveDawnScenario(plans.world, plans.activity).mapConfig.encounters;
  const layout = buildDawnSundialLayout(schedule, encounters);
  const state = (elapsed: number) => buildDawnSundialState(schedule, plans.activity, layout, elapsed);

  it('derives continuous segment angles from authored boundaries, including changed timing', () => {
    const changed: DawnSchedule = { ...schedule, durationMs: schedule.durationMs * 2,
      phases: schedule.phases.map((phase, index) => ({ ...phase, startMs: index * schedule.durationMs / 3 })) };
    for (const candidate of [schedule, changed]) {
      const { segments } = buildDawnSundialLayout(candidate, []);
      expect(segments[0].startAngle).toBe(180);
      expect(segments[segments.length - 1].endAngle).toBe(360);
      segments.forEach((segment, index) => {
        expect(segment.startAngle).toBeCloseTo(180 + 180 * candidate.phases[index].startMs / candidate.durationMs);
        if (index) expect(segment.startAngle).toBe(segments[index - 1].endAngle);
      });
    }
  });

  it('points left, up and right and clamps out-of-round times', () => {
    expect([0, 0.5, 1].map(sundialHandAngle)).toEqual([-90, 0, 90]);
    expect([0, 0.5, 1].map(sundialArcAngle)).toEqual([180, 270, 360]);
    expect(state(-100).handAngle).toBe(-90);
    expect(state(schedule.durationMs * 2).handAngle).toBe(90);
    // Late join is a pure projection of replicated plan and host elapsed time.
    expect(buildDawnSundialState(schedule, structuredClone(plans.activity), layout, schedule.durationMs / 2))
      .toEqual(state(schedule.durationMs / 2));
  });

  it('ends the elapsed arc on the hand ray throughout the round and at its clamped boundaries', () => {
    for (const progress of [-1, 0, 0.1875, 0.5, 0.81, 0.999, 1, 2]) {
      const model = state(schedule.durationMs * progress);
      expect(model.elapsedEndAngle - 270).toBeCloseTo(model.handAngle);
      expect(model.elapsedEndAngle).toBeCloseTo(sundialArcAngle(progress));
    }
  });

  it('groups front blocks into one notch at the earliest replicated start, including finale', () => {
    expect(layout.notches.length).toBeGreaterThan(1);
    for (const notch of layout.notches) {
      const blocks = encounters!.filter(entry => entry.announce && entry.announce.group === notch.id);
      const first = Math.min(...blocks.map(entry => entry.start.type === 'time' ? entry.start.atMs : Infinity));
      expect(notch.atMs).toBe(first);
      expect(notch.angle).toBe(sundialHandAngle(first / schedule.durationMs));
      expect(notch.finale).toBe(blocks.some(entry => entry.announce && entry.announce.finale));
    }
    const moved = encounters!.map(entry => ({ ...entry,
      start: entry.start.type === 'time' ? { ...entry.start, atMs: entry.start.atMs + 1000 } : entry.start }));
    expect(buildDawnSundialLayout(schedule, moved).notches[0].atMs).toBe(layout.notches[0].atMs + 1000);
  });

  it('pulses only the next notch in the five seconds before its start', () => {
    const notch = layout.notches[0];
    expect(state(notch.atMs - 5001).pulsingNotch).toBeNull();
    expect(state(notch.atMs - 5000).pulsingNotch).toBe(notch.id);
    expect(state(notch.atMs - 1).pulsingNotch).toBe(notch.id);
    expect(state(notch.atMs).pulsingNotch).not.toBe(notch.id);
    expect(state(schedule.durationMs).pulsingNotch).toBeNull();
  });

  it('uses every modifier icon only at night and otherwise retains the brass hub', () => {
    for (const modifier of DAWN_NIGHT_MODIFIER_IDS) for (const phase of schedule.phases) {
      const model = buildDawnSundialState(schedule, { ...plans.activity, nightModifierId: modifier }, layout, phase.startMs);
      expect(model.modifierIcon).toBe(phase.id === 'night' ? DAWN_M3_ASSET_KEYS.nightModifierIcon(modifier) : null);
      expect(model.tip).toBe(phase.id === 'night' ? 'tip-moon' : 'tip-sun');
    }
    expect(buildDawnSundialState(schedule, { ...plans.activity, nightModifierId: undefined }, layout,
      schedule.phases.find(p => p.id === 'night')!.startMs).modifierIcon).toBeNull();
  });

  it('localizes the phase, day, numbered waves and finale without clock times', () => {
    const previous = getLocale();
    try {
      for (const locale of ['de', 'en'] as const) {
        setLocale(locale);
        expect(state(0).label).toBe(t('ui.dawn.clock.day', { day: plans.activity.dayNumber }));
        for (const phase of schedule.phases.filter(p => p.id !== 'day')) {
          expect(state(phase.startMs).label).toBe(t(`ui.dawn.phase.${phase.id}`).toLocaleUpperCase());
        }
        const regular = layout.notches.filter(n => !n.finale);
        regular.forEach((notch, index) => expect(state(notch.atMs).label)
          .toBe(t('ui.dawn.clock.wave', { index: index + 1, count: regular.length })));
        expect(state(layout.notches.find(n => n.finale)!.atMs).label).toBe(t('ui.dawn.clock.finale'));
        expect(state(schedule.phases.find(p => p.id === 'dusk')!.startMs).label)
          .toBe(locale === 'de' ? 'DÄMMERUNG' : 'DUSK');
        expect(state(schedule.phases.find(p => p.id === 'dawn')!.startMs).label)
          .toBe(locale === 'de' ? 'MORGENGRAUEN' : 'DAWN');
      }
    } finally { setLocale(previous); }
  });
});
