import * as v from 'valibot';
import type { GameMode, LoadoutSlot } from '../../types';
import { LOADOUT_ALLOWED_KEYS_BY_PATH } from './LoadoutKnownFields';
import {
  LoadoutContentFileSchema,
  UltimateConfigSchema,
  UtilityConfigSchema,
  WeaponConfigSchema,
  type DefaultLoadoutIds,
  type LoadoutCatalogEntry,
  type UltimateConfig,
  type UtilityConfig,
  type WeaponConfig,
  validateResolvedUltimate,
  validateResolvedUtility,
  validateResolvedWeapon,
} from './LoadoutSchemas';

export interface LoadoutContentSource {
  readonly sourceName: string;
  readonly document: unknown;
}

export type WeaponRegistry = Readonly<Record<string, WeaponConfig>>;
export type UtilityRegistry = Readonly<Record<string, UtilityConfig>>;
export type UltimateRegistry = Readonly<Record<string, UltimateConfig>>;

export interface DefaultLoadoutConfig {
  readonly weapon1: WeaponConfig;
  readonly weapon2: WeaponConfig;
  readonly utility: UtilityConfig;
  readonly ultimate: UltimateConfig;
}

export interface BuiltLoadoutRegistries {
  readonly weapons: WeaponRegistry;
  readonly utilities: UtilityRegistry;
  readonly ultimates: UltimateRegistry;
  readonly defaultLoadout: Readonly<DefaultLoadoutConfig>;
  readonly catalog: readonly LoadoutCatalogEntry[];
}

type RegistryKind = 'weapon' | 'utility' | 'ultimate';

interface RawEntry {
  readonly kind: RegistryKind;
  readonly id: string;
  readonly sourceName: string;
  readonly value: Record<string, unknown>;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = new Set([
  'beamColor', 'bubbleColor', 'chargeColor', 'color', 'colorCore', 'colorGlow',
  'explosionColor', 'fieldColor', 'projectileColor', 'rocketSmokeTrailColor', 'colorOverride',
]);
const PROTECTED_DISCRIMINATORS = new Set([
  'weapon.fire.type',
  'utility.type',
  'utility.activation.type',
  'utility.placeable.kind',
  'ultimate.type',
  'ultimate.activation.type',
  'ultimate.placement.kind',
]);
const VALID_SLOTS = new Set<LoadoutSlot>(['weapon1', 'weapon2', 'utility', 'ultimate']);
const VALID_MODES = new Set<GameMode>(['deathmatch', 'team_deathmatch', 'capture_the_beer', 'coop_defense']);

export class LoadoutContentError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`[loadout-content] ${issues.length} Fehler:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'LoadoutContentError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])) as T;
  }
  return value;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function formatValibotIssues(sourceName: string, issues: readonly v.BaseIssue<unknown>[]): string[] {
  return issues.map((issue) => {
    const path = issue.path?.map((item) => String(item.key)).join('.') ?? '$';
    return `${sourceName}#${path}: ${issue.message}`;
  });
}

function validateRawValue(
  value: unknown,
  schemaPath: string,
  displayPath: string,
  issues: string[],
  isVariantRoot = false,
): void {
  if (value === null) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(`${displayPath}: Zahl muss endlich sein`);
    return;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateRawValue(entry, `${schemaPath}[]`, `${displayPath}[${index}]`, issues));
    return;
  }
  if (!isRecord(value)) {
    issues.push(`${displayPath}: ungültiger JSON-Wert`);
    return;
  }

  const allowed = LOADOUT_ALLOWED_KEYS_BY_PATH[schemaPath];
  for (const [key, child] of Object.entries(value)) {
    if (isVariantRoot && (key === 'baseId' || key === '_notes')) continue;
    if (!allowed?.has(key)) {
      issues.push(`${displayPath}.${key}: unbekanntes Feld`);
      continue;
    }
    if (COLOR_KEYS.has(key)) {
      if (typeof child !== 'string' || !HEX_COLOR.test(child)) {
        issues.push(`${displayPath}.${key}: Farbe muss #RRGGBB sein`);
      }
      continue;
    }
    validateRawValue(child, `${schemaPath}.${key}`, `${displayPath}.${key}`, issues);
  }
}

function getPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function validateDiscriminatorOverrides(
  kind: RegistryKind,
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  label: string,
  issues: string[],
): void {
  for (const discriminator of PROTECTED_DISCRIMINATORS) {
    const [discriminatorKind, ...path] = discriminator.split('.');
    if (discriminatorKind !== kind) continue;
    const override = getPath(patch, path);
    if (override === undefined) continue;
    const inherited = getPath(base, path);
    if (override === null || override !== inherited) {
      issues.push(`${label}.${path.join('.')}: Discriminator darf nicht von ${String(inherited)} auf ${String(override)} geändert werden`);
    }
  }
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
  if (Array.isArray(patch)) return patch.map((entry) => cloneValue(entry));
  if (!isRecord(base) || !isRecord(patch)) return cloneValue(patch);
  const merged: Record<string, unknown> = cloneValue(base);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'baseId' || key === '_notes') continue;
    if (value === null) {
      delete merged[key];
      continue;
    }
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

function convertColors(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((entry) => convertColors(entry));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, convertColors(child, childKey)]));
  }
  if (COLOR_KEYS.has(key) && typeof value === 'string' && HEX_COLOR.test(value)) {
    return Number.parseInt(value.slice(1), 16);
  }
  return value;
}

function sortedFrozenRecord<T>(entries: ReadonlyMap<string, T>): Readonly<Record<string, T>> {
  return deepFreeze(Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right))));
}

function assertNoErrors(issues: readonly string[]): void {
  if (issues.length > 0) throw new LoadoutContentError(issues);
}

export function buildLoadoutRegistries(sources: readonly LoadoutContentSource[]): BuiltLoadoutRegistries {
  const issues: string[] = [];
  const rawByKind: Record<RegistryKind, Map<string, RawEntry>> = {
    weapon: new Map(),
    utility: new Map(),
    ultimate: new Map(),
  };
  const globalIds = new Map<string, RawEntry>();
  const catalog: LoadoutCatalogEntry[] = [];
  const catalogKeys = new Set<string>();
  let defaultIds: DefaultLoadoutIds | null = null;

  for (const source of sources) {
    const parsed = v.safeParse(LoadoutContentFileSchema, source.document);
    if (!parsed.success) {
      issues.push(...formatValibotIssues(source.sourceName, parsed.issues));
      continue;
    }
    const groups: Array<[RegistryKind, Record<string, unknown> | undefined]> = [
      ['weapon', parsed.output.weapons],
      ['utility', parsed.output.utilities],
      ['ultimate', parsed.output.ultimates],
    ];
    for (const [kind, entries] of groups) {
      for (const [registryId, raw] of Object.entries(entries ?? {})) {
        const label = `${source.sourceName}#${kind}s.${registryId}`;
        if (!isRecord(raw)) {
          issues.push(`${label}: Config muss ein Objekt sein`);
          continue;
        }
        if (typeof raw.id !== 'string' || raw.id !== registryId) {
          issues.push(`${label}.id: Registry-ID ${registryId} stimmt nicht mit Config-ID ${String(raw.id)} überein`);
        }
        const entry: RawEntry = { kind, id: registryId, sourceName: source.sourceName, value: raw };
        const duplicate = globalIds.get(registryId);
        if (duplicate) {
          issues.push(`${label}: doppelte ID; zuerst in ${duplicate.sourceName}#${duplicate.kind}s.${registryId}`);
          continue;
        }
        globalIds.set(registryId, entry);
        rawByKind[kind].set(registryId, entry);

        const isVariant = raw.baseId !== undefined;
        if (isVariant && (typeof raw.baseId !== 'string' || raw.baseId.length === 0)) {
          issues.push(`${label}.baseId: nichtleere ID erforderlich`);
        }
        if (isVariant && (typeof raw._notes !== 'string' || raw._notes.trim().length === 0)) {
          issues.push(`${label}._notes: Varianten benötigen eine Begründung`);
        }
        if (!isVariant && raw._notes !== undefined && typeof raw._notes !== 'string') {
          issues.push(`${label}._notes: muss ein String sein`);
        }
        validateRawValue(raw, kind, label, issues, true);
      }
    }

    for (const entry of parsed.output.catalog ?? []) {
      const key = `${entry.kind}:${entry.id}:${entry.slot}`;
      if (catalogKeys.has(key)) issues.push(`${source.sourceName}#catalog.${key}: doppelter Katalogeintrag`);
      catalogKeys.add(key);
      catalog.push(entry);
    }
    if (parsed.output.defaultLoadout) {
      if (defaultIds) issues.push(`${source.sourceName}#defaultLoadout: Default-Loadout wurde mehrfach definiert`);
      defaultIds = parsed.output.defaultLoadout;
    }
  }
  if (!defaultIds) issues.push('$#defaultLoadout: Default-Loadout fehlt');
  assertNoErrors(issues);

  // Validate every inheritance path independently of resolution/cache order. Without
  // this pass, resolving an ancestor first could hide an overlong chain behind a cache hit.
  for (const kind of ['weapon', 'utility', 'ultimate'] as const) {
    for (const entry of rawByKind[kind].values()) {
      const visited = new Set<string>([entry.id]);
      let current = entry;
      let edgeCount = 0;
      while (typeof current.value.baseId === 'string') {
        const baseId = current.value.baseId;
        const base = rawByKind[kind].get(baseId);
        if (!base) {
          const wrongKind = globalIds.get(baseId);
          issues.push(
            `${entry.sourceName}#${kind}s.${entry.id}.baseId: ${wrongKind ? `Basis gehört zur Registry ${wrongKind.kind}` : `unbekannte Basis ${baseId}`}`,
          );
          break;
        }
        edgeCount += 1;
        if (edgeCount > 2) {
          issues.push(`${entry.sourceName}#${kind}s.${entry.id}.baseId: maximal zwei Vererbungsstufen erlaubt`);
          break;
        }
        if (visited.has(baseId)) {
          issues.push(`${entry.sourceName}#${kind}s.${entry.id}.baseId: Vererbungszyklus bei ${kind}:${baseId}`);
          break;
        }
        visited.add(baseId);
        current = base;
      }
    }
  }
  assertNoErrors(issues);

  const resolvedByKind: Record<RegistryKind, Map<string, unknown>> = {
    weapon: new Map(),
    utility: new Map(),
    ultimate: new Map(),
  };
  const resolving = new Set<string>();

  const resolve = (entry: RawEntry, depth: number): unknown => {
    const cached = resolvedByKind[entry.kind].get(entry.id);
    if (cached) return cached;
    const graphKey = `${entry.kind}:${entry.id}`;
    if (resolving.has(graphKey)) {
      issues.push(`${entry.sourceName}#${entry.kind}s.${entry.id}.baseId: Vererbungszyklus bei ${graphKey}`);
      return {};
    }
    if (depth > 2) {
      issues.push(`${entry.sourceName}#${entry.kind}s.${entry.id}.baseId: maximal zwei Vererbungsstufen erlaubt`);
      return {};
    }
    resolving.add(graphKey);
    const baseId = entry.value.baseId;
    let resolved: unknown;
    if (typeof baseId === 'string') {
      const base = rawByKind[entry.kind].get(baseId);
      if (!base) {
        const wrongKind = globalIds.get(baseId);
        issues.push(
          `${entry.sourceName}#${entry.kind}s.${entry.id}.baseId: ${wrongKind ? `Basis gehört zur Registry ${wrongKind.kind}` : `unbekannte Basis ${baseId}`}`,
        );
        resolved = {};
      } else {
        const resolvedBase = resolve(base, depth + 1);
        if (isRecord(resolvedBase)) validateDiscriminatorOverrides(entry.kind, resolvedBase, entry.value, `${entry.sourceName}#${entry.kind}s.${entry.id}`, issues);
        resolved = deepMerge(resolvedBase, entry.value);
      }
    } else {
      resolved = cloneValue(entry.value);
      if (isRecord(resolved)) {
        delete resolved._notes;
        delete resolved.baseId;
      }
    }
    resolving.delete(graphKey);
    const converted = convertColors(resolved);
    resolvedByKind[entry.kind].set(entry.id, converted);
    return converted;
  };

  for (const kind of ['weapon', 'utility', 'ultimate'] as const) {
    for (const entry of rawByKind[kind].values()) resolve(entry, 0);
  }

  for (const [id, value] of resolvedByKind.weapon) {
    for (const issue of validateResolvedWeapon(value)) issues.push(`weapon:${id}${issue.slice(1)}`);
    if (!v.safeParse(WeaponConfigSchema, value).success) issues.push(`weapon:${id}: Resolved-Schema fehlgeschlagen`);
    if (isRecord(value) && value.id !== id) issues.push(`weapon:${id}.id: aufgelöste ID ist ${String(value.id)}`);
  }
  for (const [id, value] of resolvedByKind.utility) {
    for (const issue of validateResolvedUtility(value)) issues.push(`utility:${id}${issue.slice(1)}`);
    if (!v.safeParse(UtilityConfigSchema, value).success) issues.push(`utility:${id}: Resolved-Schema fehlgeschlagen`);
    if (isRecord(value) && value.id !== id) issues.push(`utility:${id}.id: aufgelöste ID ist ${String(value.id)}`);
    if (isRecord(value) && value.type === 'placeable_turret' && typeof value.weaponId === 'string' && !resolvedByKind.weapon.has(value.weaponId)) {
      issues.push(`utility:${id}.weaponId: unbekannte Waffe ${value.weaponId}`);
    }
  }
  for (const [id, value] of resolvedByKind.ultimate) {
    for (const issue of validateResolvedUltimate(value)) issues.push(`ultimate:${id}${issue.slice(1)}`);
    if (!v.safeParse(UltimateConfigSchema, value).success) issues.push(`ultimate:${id}: Resolved-Schema fehlgeschlagen`);
    if (isRecord(value) && value.id !== id) issues.push(`ultimate:${id}.id: aufgelöste ID ist ${String(value.id)}`);
  }

  const weapons = sortedFrozenRecord(resolvedByKind.weapon as Map<string, WeaponConfig>) as WeaponRegistry;
  const utilities = sortedFrozenRecord(resolvedByKind.utility as Map<string, UtilityConfig>) as UtilityRegistry;
  const ultimates = sortedFrozenRecord(resolvedByKind.ultimate as Map<string, UltimateConfig>) as UltimateRegistry;

  const seenOrders = new Set<string>();
  for (const entry of catalog) {
    const registry = entry.kind === 'weapon' ? weapons : entry.kind === 'utility' ? utilities : ultimates;
    const config = registry[entry.id];
    if (!config) {
      issues.push(`catalog:${entry.kind}:${entry.id}: unbekannte Config`);
      continue;
    }
    const orderKey = `${entry.slot}:${entry.order}`;
    if (seenOrders.has(orderKey)) issues.push(`catalog:${entry.id}: Reihenfolge ${entry.order} für ${entry.slot} doppelt`);
    seenOrders.add(orderKey);
    if (entry.kind === 'weapon' && !weapons[entry.id]?.allowedSlots.includes(entry.slot as LoadoutSlot)) {
      issues.push(`catalog:${entry.id}.slot: ${entry.slot} ist für die Waffe nicht erlaubt`);
    }
    if (entry.kind === 'utility' && !utilities[entry.id]?.allowedSlots.includes(entry.slot as LoadoutSlot)) {
      issues.push(`catalog:${entry.id}.slot: ${entry.slot} ist für das Utility nicht erlaubt`);
    }
    if (entry.kind === 'ultimate' && entry.slot !== 'ultimate') issues.push(`catalog:${entry.id}.slot: Ultimate verlangt ultimate`);
  }

  const ids = defaultIds as DefaultLoadoutIds;
  const defaultWeapon1 = weapons[ids.weapon1];
  const defaultWeapon2 = weapons[ids.weapon2];
  const defaultUtility = utilities[ids.utility];
  const defaultUltimate = ultimates[ids.ultimate];
  if (!defaultWeapon1?.allowedSlots.includes('weapon1')) issues.push(`defaultLoadout.weapon1: ungültige Referenz ${ids.weapon1}`);
  if (!defaultWeapon2?.allowedSlots.includes('weapon2')) issues.push(`defaultLoadout.weapon2: ungültige Referenz ${ids.weapon2}`);
  if (!defaultUtility?.allowedSlots.includes('utility')) issues.push(`defaultLoadout.utility: ungültige Referenz ${ids.utility}`);
  if (!defaultUltimate) issues.push(`defaultLoadout.ultimate: ungültige Referenz ${ids.ultimate}`);
  assertNoErrors(issues);

  return deepFreeze({
    weapons,
    utilities,
    ultimates,
    defaultLoadout: {
      weapon1: defaultWeapon1,
      weapon2: defaultWeapon2,
      utility: defaultUtility,
      ultimate: defaultUltimate,
    },
    catalog: [...catalog].sort((left, right) => left.slot.localeCompare(right.slot) || left.order - right.order || left.id.localeCompare(right.id)),
  });
}

export function isUltimateAllowedInMode(config: UltimateConfig, mode: GameMode): boolean {
  if (!VALID_MODES.has(mode)) return false;
  return !config.allowedModes || config.allowedModes.length === 0 || config.allowedModes.includes(mode);
}
