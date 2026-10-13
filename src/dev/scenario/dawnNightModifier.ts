import type { DawnNightModifierId } from '../../dawn/contracts/DawnContentIds';

// Isolated dev recipe, read only by the host before composition. Never changes an active plan.
let forcedNightModifier: DawnNightModifierId | 'none' | undefined;
export function setDevDawnNightModifier(value: typeof forcedNightModifier): void { forcedNightModifier = value; }
export function getDevDawnNightModifier() { return forcedNightModifier; }
