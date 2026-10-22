import { describe, expect, it } from 'vitest';
import { getVisibleCoopDefenseTutorialStepId } from '../src/ui/coopDefenseTutorialStepModel';
import type { ResolvedCoopDefenseMapTutorialStepConfig } from '../src/config/coopDefenseMaps';

const step = (id: string, checkpointId: string, visibleFrom?: 'completion'): ResolvedCoopDefenseMapTutorialStepConfig => ({
  id, checkpointId, durationMs: 1000, ...(visibleFrom ? { visibleFrom } : {}),
});

describe('tutorial step visibility window', () => {
  const steps = [step('during', 'cp-a'), step('after', 'cp-a', 'completion')];

  it('shows an activation step until its checkpoint completes, then a completion step until the round ends', () => {
    expect(getVisibleCoopDefenseTutorialStepId(steps, [], 10, [])).toBeNull();
    expect(getVisibleCoopDefenseTutorialStepId(steps, [{ checkpointId: 'cp-a', activatedAtRoundMs: 5 }], 10, []))
      .toBe('during');
    const completed = [{ checkpointId: 'cp-a', completedAtRoundMs: 20 }];
    const activated = [{ checkpointId: 'cp-a', activatedAtRoundMs: 5 }];
    expect(getVisibleCoopDefenseTutorialStepId(steps, activated, 30, completed)).toBe('after');
    expect(getVisibleCoopDefenseTutorialStepId(steps, activated, 1_000_000, completed)).toBe('after');
  });
});
