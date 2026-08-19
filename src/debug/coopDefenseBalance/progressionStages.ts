/**
 * Definition der 5 Progressionsstufen gemäß GDD "Coop Defense Weapon Balance Lab".
 *
 * Jede Stufe definiert das maximale Budget für normale Upgrade-Punkte und Boss-Upgrades.
 * Der Waffen-Unlock zählt nicht gegen das normale Budget.
 */

export type ProgressionStageName = 'base' | 'early' | 'mid' | 'late' | 'endgame';

export interface ProgressionStageDefinition {
  readonly name: ProgressionStageName;
  readonly label: string;
  readonly normalPointBudget: number;
  readonly bossPointBudget: number;
}

export const PROGRESSION_STAGES: readonly ProgressionStageDefinition[] = Object.freeze([
  {
    name: 'base',
    label: 'Base',
    normalPointBudget: 0,
    bossPointBudget: 0,
  },
  {
    name: 'early',
    label: 'Early',
    normalPointBudget: 3,
    bossPointBudget: 0,
  },
  {
    name: 'mid',
    label: 'Mid',
    normalPointBudget: 5,
    bossPointBudget: 1,
  },
  {
    name: 'late',
    label: 'Late',
    normalPointBudget: 10,
    bossPointBudget: 2,
  },
  {
    name: 'endgame',
    label: 'Endgame',
    normalPointBudget: 20,
    bossPointBudget: 2,
  },
]);

export function getProgressionStageDefinition(name: ProgressionStageName): ProgressionStageDefinition {
  const stage = PROGRESSION_STAGES.find((s) => s.name === name);
  if (!stage) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Progressionsstufe: "${name}"`);
  }
  return stage;
}
