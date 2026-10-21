import type { DawnNightModifierId } from '../../dawn/contracts/DawnContentIds';

// Isolated dev recipe, read only by the host before composition. Never changes an active plan.
let forcedNightModifier: DawnNightModifierId | 'none' | undefined;
export function setDevDawnNightModifier(value: typeof forcedNightModifier): void { forcedNightModifier = value; }
export function getDevDawnNightModifier() { return forcedNightModifier; }

// Same isolation for the arena template of the next composed round.
let forcedTemplateId: string | undefined;
export function setDevDawnTemplateId(value: string | undefined): void { forcedTemplateId = value; }
export function getDevDawnTemplateId() { return forcedTemplateId; }
