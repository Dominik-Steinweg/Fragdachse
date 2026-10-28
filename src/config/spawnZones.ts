/**
 * Feste Spawnzone einer World (GDD Void-Gefahrenzonen V1): ein benannter Ort in Arenazellen, an
 * dem Gegner auftauchen. Sie existiert ohne laufende Mission – wie ein Basis-Spawnzentrum oder das
 * Kraken-Habitat – und gehoert deshalb zur World. Encounter, Dauerquellen und Boss einer Activity
 * referenzieren sie nur per ID. Die Praesentation markiert jede Zone als Gefahrenbereich.
 *
 * Authored wird ein Kasten; die Zone selbst ist rund: die Ellipse in diesem Kasten, deren Rand
 * organisch nach innen schwingt (`isCellInSpawnArea`). Spawns, Generator, Pruefungen und Void-Dunst
 * lesen dieselbe Form.
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

/** A zone id as it may cross the wire: kebab-case, at most 64 characters. */
export function isWorldSpawnZoneId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && ZONE_ID.test(value);
}

/** Kasten einer Zone in der Form, die Spawn-Ausfuehrung und Generator bereits lesen. */
export interface SpawnZoneArea {
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly medium?: 'ground' | 'water';
  readonly cluster?: boolean;
  /** `round`: nur die organische Ellipse im Kasten zaehlt (World-Spawnzonen); sonst der ganze Kasten. */
  readonly shape?: 'round';
}

export function spawnZoneArea(zone: WorldSpawnZone): SpawnZoneArea {
  return {
    gridX: zone.gridX,
    gridY: zone.gridY,
    widthCells: zone.widthCells,
    heightCells: zone.heightCells,
    ...(zone.medium === 'water' ? { medium: 'water' as const } : {}),
    ...(zone.cluster ? { cluster: true } : {}),
    shape: 'round',
  };
}

type SpawnZoneBox = Pick<SpawnZoneArea, 'gridX' | 'gridY' | 'widthCells' | 'heightCells'>;

/** Fester Phasenversatz des Randes, aus dem Kasten: dieselbe Zone sieht ueberall gleich aus. */
export function spawnZoneRimPhase(box: SpawnZoneBox): number {
  const h = Math.imul(box.gridX + 1, 73856093) ^ Math.imul(box.gridY + 1, 19349663)
    ^ Math.imul(box.widthCells, 83492791) ^ Math.imul(box.heightCells, 2654435761);
  return ((h >>> 0) % 6283) / 1000;
}

/**
 * Radius des Zonenrandes als Anteil der Ellipse (0,8..1) beim Winkel `angle` im normierten
 * Ellipsenraum: zwei ruhige Wellen, nie ueber die Ellipse hinaus, also nie ueber den Kasten.
 */
export function spawnZoneRimAt(phase: number, angle: number): number {
  return .9 + .06 * Math.sin(3 * angle + phase) + .04 * Math.sin(5 * angle + phase * 1.7);
}

/** Umriss der runden Zone in Zellkoordinaten (Kanten des Kastens = ganze Zahlen), zum Zeichnen. */
export function spawnZoneOutline(box: SpawnZoneBox, steps = 48): { x: number; y: number }[] {
  const rx = box.widthCells / 2, ry = box.heightCells / 2, phase = spawnZoneRimPhase(box);
  return Array.from({ length: steps }, (_, i) => {
    const angle = i / steps * Math.PI * 2, rim = spawnZoneRimAt(phase, angle);
    return { x: box.gridX + rx + Math.cos(angle) * rx * rim, y: box.gridY + ry + Math.sin(angle) * ry * rim };
  });
}

/** Liegt die Mitte der Zelle im Bereich? Runde Zonen pruefen ihre Ellipse, andere den Kasten. */
export function isCellInSpawnArea(area: SpawnZoneBox & { readonly shape?: 'round' }, gridX: number, gridY: number): boolean {
  if (gridX < area.gridX || gridY < area.gridY || gridX >= area.gridX + area.widthCells || gridY >= area.gridY + area.heightCells) return false;
  if (area.shape !== 'round') return true;
  const rx = area.widthCells / 2, ry = area.heightCells / 2;
  const dx = (gridX + .5 - area.gridX - rx) / rx, dy = (gridY + .5 - area.gridY - ry) / ry;
  return Math.hypot(dx, dy) <= spawnZoneRimAt(spawnZoneRimPhase(area), Math.atan2(dy, dx));
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
