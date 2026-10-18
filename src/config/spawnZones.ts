/**
 * Feste Spawnzone einer World (GDD Void-Gefahrenzonen V1): ein benannter Ort in Arenazellen, an
 * dem Gegner auftauchen. Sie existiert ohne laufende Mission – wie ein Basis-Spawnzentrum oder das
 * Kraken-Habitat – und gehoert deshalb zur World. Encounter, Dauerquellen und Boss einer Activity
 * referenzieren sie nur per ID. Die Praesentation markiert jede Zone als Gefahrenbereich.
 */
export interface WorldSpawnZone {
  /** Kebab-case, eindeutig pro World. */
  readonly id: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  /** Wasserhoehle: amphibische Gegner steigen aus vollstaendig nassen Zellen auf. */
  readonly medium?: 'water';
  /** Gruppen dieser Zone erscheinen als enges Rudel um eine Startzelle. */
  readonly cluster?: true;
  /** `false`: der Generator haelt keinen Kern frei (authored Felsnester bleiben unveraendert). */
  readonly keepClear?: false;
}

export const MAX_WORLD_SPAWN_ZONES = 64;
const ZONE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Rechteck einer Zone in der Form, die Spawn-Ausfuehrung und Generator bereits lesen. */
export interface SpawnZoneArea {
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly medium?: 'ground' | 'water';
  readonly cluster?: boolean;
}

export function spawnZoneArea(zone: WorldSpawnZone): SpawnZoneArea {
  return {
    gridX: zone.gridX,
    gridY: zone.gridY,
    widthCells: zone.widthCells,
    heightCells: zone.heightCells,
    ...(zone.medium === 'water' ? { medium: 'water' as const } : {}),
    ...(zone.cluster ? { cluster: true } : {}),
  };
}

/** Fail-fast: eindeutige kebab-case IDs, ganze Zellen innerhalb der Arena, bekannte Flags. */
export function normalizeWorldSpawnZones(
  owner: string,
  value: unknown,
  arenaWidthCells: number,
  arenaHeightCells: number,
): readonly WorldSpawnZone[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`[${owner}] spawnZones must be an array`);
  if (value.length > MAX_WORLD_SPAWN_ZONES) throw new Error(`[${owner}] at most ${MAX_WORLD_SPAWN_ZONES} spawnZones`);
  const ids = new Set<string>();
  return value.map((raw: Partial<WorldSpawnZone> | null) => {
    if (!raw || typeof raw !== 'object') throw new Error(`[${owner}] spawnZones entries must be objects`);
    const id = raw.id;
    if (typeof id !== 'string' || !ZONE_ID.test(id)) throw new Error(`[${owner}] spawn zone needs a kebab-case id: ${String(id)}`);
    if (ids.has(id)) throw new Error(`[${owner}] duplicate spawn zone id: ${id}`);
    ids.add(id);
    const { gridX, gridY, widthCells, heightCells } = raw;
    if (![gridX, gridY, widthCells, heightCells].every(Number.isInteger)) {
      throw new Error(`[${owner}] spawn zone ${id} needs integer cells`);
    }
    if (gridX! < 0 || gridY! < 0 || widthCells! < 1 || heightCells! < 1
      || gridX! + widthCells! > arenaWidthCells || gridY! + heightCells! > arenaHeightCells) {
      throw new Error(`[${owner}] spawn zone ${id} lies outside the arena`);
    }
    if (raw.medium !== undefined && raw.medium !== 'water') throw new Error(`[${owner}] spawn zone ${id} has an unknown medium`);
    if (raw.cluster !== undefined && raw.cluster !== true) throw new Error(`[${owner}] spawn zone ${id} cluster must be true or omitted`);
    if (raw.keepClear !== undefined && raw.keepClear !== false) throw new Error(`[${owner}] spawn zone ${id} keepClear must be false or omitted`);
    return {
      id, gridX: gridX!, gridY: gridY!, widthCells: widthCells!, heightCells: heightCells!,
      ...(raw.medium === 'water' ? { medium: 'water' as const } : {}),
      ...(raw.cluster ? { cluster: true as const } : {}),
      ...(raw.keepClear === false ? { keepClear: false as const } : {}),
    };
  });
}
