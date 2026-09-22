import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { getUtilityConfigForMode } from '../loadout/LoadoutConfig';
import { getPersistentBaseRewardDefinition } from './PersistentBaseRewardCatalog';
import type { BaseEditorObject, PersistentBaseEditorModel } from './PersistentBaseEditorModel';
import type { TurretWeaponId } from '../types';

export interface BaseEditorAppearance {
  readonly wall: boolean;
  readonly footprint: readonly { dx: number; dy: number }[];
  readonly weapon?: TurretWeaponId;
  readonly powerUpDefId?: string;
  readonly angle: number;
  readonly ownerTintStrength: number;
}
export const baseEditorObjectKey = (object: BaseEditorObject): string => `${object.kind}:${object.id}`;

/** Placed objects and drag previews resolve the same authored appearance. */
export function getBaseEditorAppearance(model: PersistentBaseEditorModel, object: BaseEditorObject): BaseEditorAppearance | null {
  if (object.kind === 'reward') {
    const source = getPersistentBaseRewardDefinition(object.id).gameplaySource;
    const common = { wall: false, footprint: [{ dx: 0, dy: 0 }],
      angle: model.getPosition(object)?.angle ?? 0, ownerTintStrength: 0 };
    if (source.kind === 'power-up-definition') return { ...common, powerUpDefId: source.powerUpDefId };
    const def = getCoopDefenseConstructionDefinition(source.constructionId);
    return def.kind === 'turret' ? { ...common, weapon: source.weaponId ?? def.weaponId } : null;
  }
  const entry = model.getConstruction(object.id);
  const id = entry && normalizeConstructionId(entry.tool.id);
  if (!entry || !id) return null;
  const def = getCoopDefenseConstructionDefinition(id);
  const utility = entry.tool.kind === 'utility' ? getUtilityConfigForMode(entry.tool.id, 'coop_defense') : null;
  return { wall: def.kind !== 'pedestal', footprint: def.footprint, angle: entry.angle,
    weapon: def.kind === 'turret' ? def.weaponId : undefined,
    powerUpDefId: def.kind === 'pedestal' ? def.powerUpDefId : undefined,
    ownerTintStrength: utility && 'placeable' in utility ? utility.placeable.ownerTintStrength : 0 };
}
