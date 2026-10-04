import { buildLoadoutRegistries } from '../../../src/loadout/content/LoadoutContentLoader';
import { getLoadoutNumericContract } from '../../../src/loadout/content/LoadoutSchemas';
import { validateGameContentReferences } from '../../../src/loadout/content/GameContentValidation';
import { normalizeUpgradeRegistry, getCoopDefenseUpgradeTextureKey } from '../../../src/utils/coopDefenseUpgrades';
import { getLoadoutItemName } from '../../../src/i18n/contentPresentation';
import { getDomainCatalog } from '../../../src/i18n/catalog';
import { BURN_TICK_INTERVAL_MS } from '../../../src/config';
import { validateAttackDroneRules } from '../../../src/config/attackDrone';
import { validateMgTurretRules } from '../../../src/config/mgTurretRules';
import { loadConstructionBuildCooldowns, COOP_DEFENSE_CONSTRUCTIONS } from '../../../src/config/coopDefenseConstructions';
import { at, object, array, set, stable, type Json, type JsonObject, type Path } from '../../map-editor/shared/json';
import { LOADOUT_DIRECTORY, RULE_FILES, UPGRADE_FILE, type BalanceFile, type Entry, type Field, type Workspace } from './types';

// Units are documented in LoadoutTypes.ts / types.ts. Unspecified units stay unspecified.
function unitFor(path: Path): string | undefined {
  const key = String(path.at(-1));
  if (/Ms$|TickInterval$/.test(key) || ['cooldown', 'spreadRecoveryDelay', 'tickInterval', 'fuseTime', 'fullChargeDuration', 'rageDrainDuration'].includes(key)) return 'ms';
  if (key === 'projectileSpeed') return 'px/s';
  if (/Degrees$|Deg$/.test(key) || ['spreadStanding', 'spreadMoving', 'spreadPerShot', 'maxDynamicSpread', 'pelletSpreadAngle'].includes(key)) return '°';
  if (/Px$/.test(key) || ['range', 'radius', 'projectileSize', 'searchRadius'].includes(key)) return 'px';
  return undefined;
}

// BurnStatusOwner uses one global cadence, not an editable per-item interval.
function burnTickContext(stat: string): string | undefined {
  return /burnDamagePerTick$|burnOnHit\.damagePerTick$|player\.fire\.burningProjectiles\.damagePerTick$/i.test(stat)
    ? `Tickintervall: ${BURN_TICK_INTERVAL_MS} ms · global (BURN_TICK_INTERVAL_MS)` : undefined;
}

function leaves(value: unknown, visit: (path: Path, value: Json) => void, path: Path = []): void {
  if (value === undefined) return;
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => leaves(child, visit, [...path, Array.isArray(value) ? Number(key) : key]));
  } else visit(path, value as Json);
}

export function buildWorkspace(files: BalanceFile[]): Workspace {
  const loadout = buildLoadoutRegistries(files.filter(f => f.key.startsWith(LOADOUT_DIRECTORY + '/')).map(f => ({ sourceName: f.key, document: f.document })));
  const upgradeFile = files.find(f => f.key === UPGRADE_FILE);
  if (!upgradeFile) throw Error('Upgrade-Datei fehlt.');
  const upgrades = normalizeUpgradeRegistry(upgradeFile.document as unknown as Parameters<typeof normalizeUpgradeRegistry>[0], loadout);
  // The game accepts legacy values by clamping them. Authoring must not silently save a
  // value different from what the player receives, so compare authored leaves to its result.
  // Legacy sortOrder fractions intentionally remain raw (the game floors display ordering).
  array(upgradeFile.document.categories).forEach((category, ci) => {
    array(category.upgrades).forEach((raw, ui) => {
      const normalized = upgrades.categories[ci].upgrades[ui] as unknown as JsonObject;
      leaves(raw, (path, value) => {
        if (path.at(-1) !== 'sortOrder' && (typeof value === 'number' || typeof value === 'boolean') && stable(at(normalized, path)) !== stable(value)) {
          throw Error(`upgrade:${String(raw.id)}.${path.join('.')}: Wert würde vom Spiel normalisiert; gültigen Wert eingeben.`);
        }
      });
    });
  });
  validateGameContentReferences({
    WEAPON_CONFIGS: loadout.weapons, UTILITY_CONFIGS: loadout.utilities, ULTIMATE_CONFIGS: loadout.ultimates,
    DEFAULT_LOADOUT: loadout.defaultLoadout, LOADOUT_CATALOG_ENTRIES: loadout.catalog,
    getUtilityConfigLineage: id => loadout.lineages.utility[id] ?? [],
    COOP_DEFENSE_UPGRADE_DEFINITIONS: Object.fromEntries(upgrades.upgrades.map(u => [u.id, u])),
  });
  const entries: Entry[] = [];
  for (const kind of ['weapon', 'utility', 'ultimate'] as const) {
    const group = kind === 'utility' ? 'utilities' : kind === 'weapon' ? 'weapons' : 'ultimates';
    const locations = new Map<string, { file: BalanceFile; raw: JsonObject }>();
    for (const file of files) for (const [id, raw] of Object.entries(object(file.document[group]))) locations.set(id, { file, raw: object(raw) });
    for (const [id, config] of Object.entries(loadout[group])) {
      const location = locations.get(id)!;
      const entry: Entry = { key: `${kind}:${id}`, id, name: getLoadoutItemName(id, 'de'), kind,
        category: Array.isArray(object(config).allowedSlots) ? (object(config).allowedSlots as string[]).join(', ') || 'NPC / intern' : kind,
        file: location.file.key, path: [group, id], baseId: location.raw.baseId as string | undefined,
        iconKey: loadout.catalog.find(row => row.id === id)?.iconKey ?? undefined, fields: [] };
      leaves(config, (path, resolved) => {
        const originId = loadout.lineages[kind][id].find(ancestor => at(locations.get(ancestor)!.raw, path) !== undefined);
        const origin = originId ? locations.get(originId)! : location;
        const rawValue = at(origin.raw, path);
        const value = rawValue === undefined ? resolved : rawValue;
        const contractPath = '$.' + path.map((p, i) => typeof p === 'number' ? `[${p}]` : (i ? '.' : '') + p).join('');
        const editable = typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value));
        entry.fields.push({ path: [...entry.path, ...path], label: path.join('.'), value,
          source: `${origin.file.key}#/${group}/${originId ?? id}/${path.join('/')}`, inherited: originId !== id,
          removable: !!entry.baseId && at(object(loadout[group][entry.baseId]), path) !== undefined,
          editable, ...(typeof value === 'number' ? getLoadoutNumericContract(contractPath, id) : {}), unit: unitFor(path),
          context: burnTickContext(path.join('.')),
          note: editable ? 'LoadoutSchemas + spezialisierte Spielvalidatoren' : 'Identität / Struktur / Referenz (schreibgeschützt)',
        });
      });
      entries.push(entry);
    }
  }
  array(upgradeFile.document.categories).forEach((category, ci) => {
    array(category.upgrades).forEach((raw, ui) => {
      const normalized = upgrades.categories[ci].upgrades[ui];
      const construction = Object.values(COOP_DEFENSE_CONSTRUCTIONS).find(c => c.unlockUpgradeId === normalized.id);
      const itemId = normalized.loadoutUnlock?.itemId ?? (construction && 'weaponId' in construction ? construction.weaponId : undefined);
      const entry: Entry = { key: `upgrade:${normalized.id}`, id: normalized.id,
        name: `${normalized.code ? normalized.code + ' · ' : ''}${getDomainCatalog('de', 'upgrades')[`upgrade.${normalized.id}.name`] ?? normalized.id.replaceAll('_', ' ')}`,
        kind: 'upgrade', category: String(category.id), file: upgradeFile.key, path: ['categories', ci, 'upgrades', ui],
        iconKey: getCoopDefenseUpgradeTextureKey(normalized.id) ?? loadout.catalog.find(row => row.id === itemId)?.iconKey ?? undefined,
        upgrade: { kind: normalized.kind, sortOrder: normalized.sortOrder, requires: normalized.requires, itemId }, fields: [] };
      const values = { ...raw, startingLevel: normalized.startingLevel, bossPointCostPerLevel: normalized.bossPointCostPerLevel,
        refundable: normalized.refundable, maxLevel: normalized.maxLevel, costPerLevel: normalized.costPerLevel };
      leaves(values, (path, value) => {
        const effect = path[0] === 'effects';
        const key = String(path.at(-1));
        const effectMode = effect && key === 'mode';
        entry.fields.push({ path: [...entry.path, ...path], label: path.join('.'), value,
          source: at(raw, path) === undefined ? 'Spiel-Default · coopDefenseUpgrades.ts' : `${upgradeFile.key}#/${[...entry.path, ...path].join('/')}`,
          inherited: at(raw, path) === undefined,
          removable: path.length === 1 && ['startingLevel', 'bossPointCostPerLevel', 'refundable'].includes(key),
          editable: typeof value === 'number' || typeof value === 'boolean' || effectMode,
          ...(typeof value === 'number' && !effect ? { integer: key !== 'sortOrder', minimum: key === 'maxLevel' || key === 'minLevel' ? 1 : 0,
            maximum: key === 'startingLevel' ? normalized.maxLevel : undefined } : {}),
          unit: effect && key === 'value' ? (object(array(raw.effects)[Number(path[1])]).mode === 'add_percent_per_level' ? 'Anteil / Level (0,1 = 10 %)' : 'additiv / Level') : undefined,
          options: effectMode ? ['add_per_level', 'add_percent_per_level'] : undefined,
          context: effect && key === 'value' ? burnTickContext(String(object(array(raw.effects)[Number(path[1])]).stat)) : undefined,
          note: 'coopDefenseUpgrades: Normalisierung, Voraussetzungen und Spielreferenzen',
        });
      });
      entries.push(entry);
    });
  });
  for (const file of files) array(file.document.catalog).forEach((row, index) => {
    entries.push({ key: `catalog:${row.slot}:${row.id}`, id: String(row.id), name: `${getLoadoutItemName(String(row.id), 'de')} · Katalog`,
      kind: 'catalog', category: String(row.slot), file: file.key, path: ['catalog', index], fields: Object.entries(row).map(([key, value]) => ({
        path: ['catalog', index, key], label: key, value: value!, editable: key === 'order', inherited: false,
        minimum: 0, integer: true, source: `${file.key}#/catalog/${index}/${key}`, note: 'CatalogEntrySchema; Reihenfolge je Slot eindeutig',
      })) });
  });
  for (const key of RULE_FILES) {
    const file = files.find(f => f.key === key);
    if (!file) throw Error(`Regeldatei fehlt: ${key}`);
    if (key.endsWith('/attackDrone.json')) validateAttackDroneRules(file.document as unknown as Parameters<typeof validateAttackDroneRules>[0]);
    else if (key.endsWith('/mgTurret.json')) validateMgTurretRules(file.document as unknown as Parameters<typeof validateMgTurretRules>[0]);
    else loadConstructionBuildCooldowns(file.document as Parameters<typeof loadConstructionBuildCooldowns>[0]);
    const cooldowns = key.endsWith('/coopDefenseConstructions.json');
    const entry: Entry = { key: `rules:${key}`, id: key.split('/').at(-1)!,
      name: cooldowns ? 'Bau-Cooldowns' : key.endsWith('/attackDrone.json') ? 'Angriffsdrohne · Grundwerte' : 'MG-Turm · Blutung',
      kind: 'rules', category: 'construction', file: key, path: [], fields: [] };
    leaves(file.document, (path, value) => entry.fields.push({ path, label: path.join('.'), value, editable: typeof value === 'number',
      inherited: false, minimum: cooldowns ? 0 : undefined, integer: cooldowns, unit: unitFor(path),
      context: burnTickContext(path.join('.')),
      source: `${key}#/${path.join('/')}`, note: cooldowns ? 'Spielprüfung: nichtnegative Bauzeit' : 'Spielprüfung: strikt positiv; zusätzliche Timing- und Konsistenzregeln',
    }));
    entries.push(entry);
  }
  return { files, entries };
}

/** A balancing operation changes fields, never IDs, object kinds, array structure or references. */
export function assertSupportedEdit(workspace: Workspace, key: string, next: JsonObject): void {
  const before = workspace.files.find(f => f.key === key)!.document;
  const expected = structuredClone(before);
  for (const entry of workspace.entries.filter(e => e.file === key)) for (const field of entry.fields.filter(f => f.editable)) {
    const value = at(next, field.path);
    if (stable(value) === stable(at(before, field.path))) continue;
    if (value === undefined && field.removable) {
      // Remove a now-empty override object too, but only when every descendant can inherit.
      const prefix = field.path.slice(0, field.path.findIndex((_, i) => i >= entry.path.length
        && at(next, field.path.slice(0, i + 1)) === undefined
        && entry.fields.filter(f => stable(f.path.slice(0, i + 1)) === stable(field.path.slice(0, i + 1))).every(f => f.removable)) + 1);
      set(expected, prefix.length ? prefix : field.path, undefined);
      continue;
    }
    if (value === undefined || typeof value !== typeof field.value || (typeof value === 'number' && !Number.isFinite(value))) {
      throw Error(`${entry.id}.${field.label}: Typ muss ${typeof field.value} bleiben.`);
    }
    if (field.options && !field.options.includes(String(value))) throw Error(`${entry.id}.${field.label}: ungültige Auswahl.`);
    // Arrays in inherited configs are replaced as a whole by the game loader.
    const arrayIndex = field.path.findIndex((p, i) => typeof p === 'number' && at(before, field.path.slice(0, i)) === undefined);
    if (arrayIndex >= 0) {
      const prefix = field.path.slice(0, arrayIndex);
      if (at(expected, prefix) === undefined) {
        const children = entry.fields.filter(f => stable(f.path.slice(0, arrayIndex)) === stable(prefix));
        for (const child of children) set(expected, child.path, structuredClone(child.value));
      }
    }
    set(expected, field.path, value);
  }
  if (stable(expected) !== stable(next)) throw Error('Nur angezeigte Balance-Felder dürfen geändert werden. IDs, Referenzen und Struktur bleiben erhalten.');
}
