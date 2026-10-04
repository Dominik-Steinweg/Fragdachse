import type { Json, JsonObject, Path } from '../../map-editor/shared/json';

export interface BalanceFile { key: string; document: JsonObject; revision: string }
export interface Field {
  path: Path;
  label: string;
  value: Json;
  source: string;
  inherited: boolean;
  removable?: boolean;
  editable: boolean;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  unit?: string;
  options?: string[];
  note?: string;
  context?: string;
}
export interface Entry {
  key: string;
  id: string;
  name: string;
  kind: 'weapon' | 'utility' | 'ultimate' | 'upgrade' | 'catalog' | 'rules';
  category: string;
  file: string;
  path: Path;
  baseId?: string;
  iconKey?: string;
  upgrade?: {
    kind: 'upgrade' | 'unlock';
    sortOrder: number;
    requires: readonly { upgradeId: string; minLevel: number }[];
    itemId?: string;
  };
  fields: Field[];
}
export interface Workspace { files: BalanceFile[]; entries: Entry[] }
export const UPGRADE_FILE = 'src/config/coopDefenseUpgrades.json';
export const LOADOUT_DIRECTORY = 'src/loadout/content/data';
export const RULE_FILES = ['src/config/attackDrone.json', 'src/config/mgTurret.json', 'src/config/coopDefenseConstructions.json'] as const;
