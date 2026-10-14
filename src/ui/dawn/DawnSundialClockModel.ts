import { getDawnNightModifier, type DawnSchedule } from '../../config/dawn/dawnContent';
import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import type { DawnActivityPlan } from '../../dawn/contracts/DawnPlans';
import { DAWN_M3_ASSET_KEYS } from '../../dawn/contracts/DawnContentIds';
import { resolveDawnPhase } from '../../dawn/rules/DawnPhase';
import { t } from '../../i18n';

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export const sundialArcAngle = (progress: number) => 180 + 180 * clamp(progress);
export const sundialHandAngle = (progress: number) => -90 + 180 * clamp(progress);
export const DAWN_SEGMENT_COLORS = { day: 0xd9cfb6, dusk: 0xd9822b, night: 0x2f343a, dawn: 0xbdc3c1 };

/** Build once per round from the same resolved plan used by the mission director. */
export function buildDawnSundialLayout(schedule: DawnSchedule, encounters: CoopDefenseMapConfig['encounters']) {
  const segments = schedule.phases.map((phase, index) => ({
    phase: phase.id, color: DAWN_SEGMENT_COLORS[phase.id],
    startAngle: sundialArcAngle(phase.startMs / schedule.durationMs),
    endAngle: sundialArcAngle((schedule.phases[index + 1]?.startMs ?? schedule.durationMs) / schedule.durationMs),
  }));
  const groups = new Map<string, { id: string; atMs: number; finale: boolean }>();
  for (const encounter of encounters ?? []) {
    if (!encounter.announce || encounter.start.type !== 'time'
      || resolveDawnPhase(schedule, encounter.start.atMs).phase !== 'night') continue;
    const id = encounter.announce.group;
    const previous = groups.get(id);
    groups.set(id, { id, atMs: Math.min(previous?.atMs ?? Infinity, encounter.start.atMs),
      finale: previous?.finale === true || encounter.announce.finale === true });
  }
  const notches = [...groups.values()].sort((a, b) => a.atMs - b.atMs).map(wave => ({ ...wave,
    angle: sundialHandAngle(wave.atMs / schedule.durationMs),
  }));
  return { segments, notches };
}

export type DawnSundialLayout = ReturnType<typeof buildDawnSundialLayout>;

export function buildDawnSundialState(schedule: DawnSchedule, plan: DawnActivityPlan,
  layout: DawnSundialLayout, elapsedMs: number) {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const phase = resolveDawnPhase(schedule, elapsed).phase;
  const progress = clamp(elapsed / schedule.durationMs);
  const handAngle = sundialHandAngle(progress);
  const next = layout.notches.find(wave => wave.atMs > elapsed);
  const past = layout.notches.filter(wave => wave.atMs <= elapsed);
  const current = past[past.length - 1];
  const regular = layout.notches.filter(wave => !wave.finale);
  let label = t(`ui.dawn.phase.${phase}`);
  if (phase === 'day') label = t('ui.dawn.clock.day', { day: plan.dayNumber });
  if (phase === 'night' && current) label = current.finale ? t('ui.dawn.clock.finale')
    : t('ui.dawn.clock.wave', { index: regular.indexOf(current) + 1, count: regular.length });
  return {
    phase, progress, handAngle,
    // The kit hand points up; Graphics angles start on +x. Both end on the same ray.
    elapsedEndAngle: handAngle + 270,
    tip: phase === 'night' ? 'tip-moon' as const : 'tip-sun' as const,
    modifierIcon: phase === 'night' && plan.nightModifierId
      ? DAWN_M3_ASSET_KEYS.nightModifierIcon(getDawnNightModifier(plan.nightModifierId).id) : null,
    pulsingNotch: next && next.atMs - elapsed <= 5000 ? next.id : null,
    label: label.toLocaleUpperCase(),
  };
}
