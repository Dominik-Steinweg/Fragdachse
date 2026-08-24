/**
 * Kompakte (De-)Serialisierung des Projektil-Stroms für {@link SyncedProjectileSnapshot}.
 *
 * Motivation: Der `j`-Slice des GameState war der größte Posten der unreliable Payload. Der Host
 * schickte pro Tick für JEDES aktive Projektil ein volles JSON-Objekt mit bis zu 28 Feldern
 * (~340 Zeichen für ein Bullet mit Tracer), obwohl sich zwischen zwei Ticks praktisch nur
 * x/y/vx/vy ändern. Alles andere sind unveränderliche Visual-, Audio-, Preset- und Tracer-Daten.
 *
 * Deshalb zerfällt ein Projektil hier in zwei flache Zahlenströme:
 *
 *   s = STATIK  – Felder, die sich über die Lebensdauer nie ändern (Besitzer, Stil, Farbe,
 *                 Presets, Tracer, Mündungsursprung, Audio-Key …). Wird beim Spawn gesendet,
 *                 PROJECTILE_NET_STATIC_RESEND_TICKS mal wiederholt (Paketverlust) und danach
 *                 nur noch über den rollierenden Refresh für langlebige Projektile aufgefrischt.
 *   u = DYNAMIK – x/y/vx/vy/size für JEDES aktive Projektil in JEDEM Tick, vollständig.
 *
 * ZWEI VERSCHIEDENE SEMANTIKEN – hier liegt die einzige echte Fallgrube:
 *   - Statik ist VOLLERSATZ: "Bit nicht gesetzt" heißt `undefined`, nicht "unverändert". Das ist
 *     zwingend, weil `style === undefined` clientseitig NICHT dasselbe ist wie `style === 'bullet'`
 *     (der Renderer-Dispatch in ProjectileManager.clientSyncVisuals fällt sonst in den generischen
 *     Rechteck-Zweig).
 *   - Dynamik ist VOLLSTÄNDIG, nicht inkrementell. Die beiden Maskenbits vergleichen gegen eine
 *     Konstante (0 bzw. `undefined`), nie gegen einen zuletzt gesendeten Wert. Jeder Eintrag ist
 *     damit aus sich heraus interpretierbar und idempotent.
 *
 * Bewusst KEINE Dead-Zone auf x/y/vx/vy: `clientSyncVisuals` setzt bei jedem Eintrag
 * `receivedAt = now`, und `clientExtrapolate` rechnet ab `serverX + vx·dt`. Ein ausgelassenes x/y
 * würde die alte Position mit neuem Zeitstempel rehydrieren und das Projektil einfrieren; ein
 * ausgelassenes vx/vy würde die Extrapolation zwischen zwei Ticks verfälschen. Ausserdem gäbe es
 * ohne vollständige Dynamik keinen zustandslosen Weg, einen verlorenen einmaligen Wechsel
 * (Bounce, `burning`, `miniRocketPhase`) je zu heilen – der Host hielte ihn für zugestellt.
 *
 * Da `u` jeden Tick alle aktiven Projektile führt, wird Despawn – wie vor der Kompaktierung – rein
 * über Abwesenheit synchronisiert. Es gibt keine Removal-Liste, keine Sticky-Resends und keine
 * Phantom-Projektile.
 *
 * Stromformat `s` (Einträge hintereinander, variable Länge):
 *   id, mask, ownerId,
 *     [styleIdx]?, [color]?, [ownerColor]?, [mx, my]?, [visualScale]?, [smokeTrailColor]?,
 *     [velocityDecay]?, [bulletPresetIdx]?, [grenadePresetIdx]?, [energyVariantIdx]?,
 *     [sporeVariantIdx]?, [shotAudioKey]?, [flags]?,
 *     [tmask, widthCore, widthGlow, alphaCoreQ, alphaGlowQ, segments, fadeMs,
 *      [maxLength]?, [colorCore]?, [colorGlow]?]?
 *
 * Stromformat `u`:
 *   id, mask, x, y, vx, vy, size, [burnPacked]?, [miniRocketPhaseCode, miniRocketCascadeStage]?
 */
import type {
  BulletVisualPreset,
  EnergyBallVariant,
  GrenadeVisualPreset,
  GroundFireVisualStyle,
  MiniRocketFlightPhase,
  ProjectileStyle,
  SyncedProjectile,
  SyncedProjectileDynamic,
  SyncedProjectileSnapshot,
  SyncedProjectileStatic,
  TracerConfig,
} from '../types';

// ── Statik-Maske ────────────────────────────────────────────────────────────
const S_STYLE = 1;
const S_COLOR = 2;
const S_OWNER_COLOR = 4;
const S_MUZZLE = 8;            // visualMuzzleOrigin.x + .y
const S_SCALE = 16;
const S_SMOKE = 32;
const S_DECAY = 64;
const S_BULLET_PRESET = 128;
const S_GRENADE_PRESET = 256;
const S_ENERGY_VARIANT = 512;
const S_SPORE_VARIANT = 1024;
const S_AUDIO = 2048;
const S_FLAGS = 4096;          // Bit0 allowTeamDamage, Bit1 suppressSpawnFx
const S_TRACER = 8192;

const FLAG_ALLOW_TEAM_DAMAGE = 1;
const FLAG_SUPPRESS_SPAWN_FX = 2;

// ── Tracer-Untermaske ───────────────────────────────────────────────────────
const T_MAX_LENGTH = 1;
const T_COLOR_CORE = 2;
const T_COLOR_GLOW = 4;

/** Tracer-Alphas werden als Integer übertragen; alle Autorenwerte haben höchstens 2 Nachkommastellen. */
const TRACER_ALPHA_QUANT = 100;

// ── Dynamik-Maske ───────────────────────────────────────────────────────────
const D_BURN = 1;              // burnPacked (Brand + Brandstil in einem Wert)
const D_MINI_ROCKET = 2;       // Flugphase + Kaskadenstufe

/** `miniRocketCascadeStage === undefined` auf dem Draht. Echte Stufen sind nie negativ. */
const MINI_ROCKET_CASCADE_NONE = -1;

/**
 * Stabile, geordnete Listen für die Enum-nach-Index-Kodierung.
 *
 * ACHTUNG: Nur ANHÄNGEN ist rückwärtskompatibel. Umsortieren oder Entfernen ändert die Bedeutung
 * bereits vergebener Indizes und muss mit einem Bump von PEER_PROTOCOL_VERSION einhergehen.
 * Die Reihenfolge ist deterministisch, weil es Quelltext-Literale sind: Host und Client laufen im
 * P2P-Betrieb denselben Bundle, und Version-Skew fängt der Handshake ab.
 *
 * Die `Covered`-Wächter darunter brechen den Build, sobald ein Union-Wert ohne Listeneintrag
 * hinzukommt.
 */
export const PROJECTILE_STYLES = [
  'bullet', 'ball', 'energy_ball', 'hydra', 'spore', 'flame', 'fireball', 'leaf_blower',
  'bfg', 'awp', 'gauss', 'rocket', 'grenade', 'holy_grenade', 'translocator_puck', 'tesla_bolt',
] as const satisfies readonly ProjectileStyle[];

export const PROJECTILE_BULLET_VISUAL_PRESETS = [
  'default', 'glock', 'xbow', 'p90', 'ak47', 'shotgun',
  'awp', 'awp_charged', 'awp_corridor', 'gauss', 'negev',
] as const satisfies readonly BulletVisualPreset[];

export const PROJECTILE_GRENADE_VISUAL_PRESETS = [
  'he', 'smoke', 'molotov', 'time_bubble', 'fur_ball',
] as const satisfies readonly GrenadeVisualPreset[];

export const PROJECTILE_ENERGY_BALL_VARIANTS = [
  'default', 'plasma',
] as const satisfies readonly EnergyBallVariant[];

type SporeVisualVariant = NonNullable<SyncedProjectileStatic['sporeVisualVariant']>;

export const PROJECTILE_SPORE_VISUAL_VARIANTS = [
  'spore', 'spore_void',
] as const satisfies readonly SporeVisualVariant[];

type Covered<TUnion, TList extends readonly unknown[]> =
  Exclude<TUnion, TList[number]> extends never ? true : never;

const stylesCovered: Covered<ProjectileStyle, typeof PROJECTILE_STYLES> = true;
const bulletPresetsCovered: Covered<BulletVisualPreset, typeof PROJECTILE_BULLET_VISUAL_PRESETS> = true;
const grenadePresetsCovered: Covered<GrenadeVisualPreset, typeof PROJECTILE_GRENADE_VISUAL_PRESETS> = true;
const energyVariantsCovered: Covered<EnergyBallVariant, typeof PROJECTILE_ENERGY_BALL_VARIANTS> = true;
const sporeVariantsCovered: Covered<SporeVisualVariant, typeof PROJECTILE_SPORE_VISUAL_VARIANTS> = true;
void stylesCovered;
void bulletPresetsCovered;
void grenadePresetsCovered;
void energyVariantsCovered;
void sporeVariantsCovered;

/** Index in einer der stabilen Listen; -1 bleibt beim Dekodieren `undefined`. */
function indexIn<T extends string>(list: readonly T[], value: T | undefined): number {
  return value === undefined ? -1 : list.indexOf(value);
}

function valueAt<T extends string>(list: readonly T[], index: number): T | undefined {
  return list[index];
}

// ── Statik ──────────────────────────────────────────────────────────────────

/** Hängt einen Statik-Eintrag an den flachen Strom an. */
export function encodeProjectileStatic(
  out: Array<number | string>,
  entry: SyncedProjectileStatic,
): void {
  const flags = (entry.allowTeamDamage ? FLAG_ALLOW_TEAM_DAMAGE : 0)
    | (entry.suppressSpawnFx ? FLAG_SUPPRESS_SPAWN_FX : 0);

  let mask = 0;
  if (entry.style !== undefined) mask |= S_STYLE;
  if (entry.color !== undefined) mask |= S_COLOR;
  if (entry.ownerColor !== undefined) mask |= S_OWNER_COLOR;
  if (entry.visualMuzzleOrigin !== undefined) mask |= S_MUZZLE;
  if (entry.projectileVisualScale !== undefined) mask |= S_SCALE;
  if (entry.smokeTrailColor !== undefined) mask |= S_SMOKE;
  if (entry.velocityDecay !== undefined) mask |= S_DECAY;
  if (entry.bulletVisualPreset !== undefined) mask |= S_BULLET_PRESET;
  if (entry.grenadeVisualPreset !== undefined) mask |= S_GRENADE_PRESET;
  if (entry.energyBallVariant !== undefined) mask |= S_ENERGY_VARIANT;
  if (entry.sporeVisualVariant !== undefined) mask |= S_SPORE_VARIANT;
  if (entry.shotAudioKey !== undefined) mask |= S_AUDIO;
  if (flags !== 0) mask |= S_FLAGS;
  if (entry.tracer !== undefined) mask |= S_TRACER;

  out.push(entry.id, mask, entry.ownerId);
  if (mask & S_STYLE) out.push(indexIn(PROJECTILE_STYLES, entry.style));
  if (mask & S_COLOR) out.push(entry.color as number);
  if (mask & S_OWNER_COLOR) out.push(entry.ownerColor as number);
  if (mask & S_MUZZLE) {
    // Bewusst ungerundet: das Feld reist nur einmal pro Projektil, eine Quantisierung würde die
    // Mündungsfeuer-Position verschieben, ohne nennenswert Bandbreite zu sparen.
    const muzzle = entry.visualMuzzleOrigin as { x: number; y: number };
    out.push(muzzle.x, muzzle.y);
  }
  if (mask & S_SCALE) out.push(entry.projectileVisualScale as number);
  if (mask & S_SMOKE) out.push(entry.smokeTrailColor as number);
  // velocityDecay geht ungerundet in Math.pow(decay, dt) – jede Quantisierung würde die
  // clientseitige Decay-Extrapolation von der Host-Simulation abweichen lassen.
  if (mask & S_DECAY) out.push(entry.velocityDecay as number);
  if (mask & S_BULLET_PRESET) out.push(indexIn(PROJECTILE_BULLET_VISUAL_PRESETS, entry.bulletVisualPreset));
  if (mask & S_GRENADE_PRESET) out.push(indexIn(PROJECTILE_GRENADE_VISUAL_PRESETS, entry.grenadeVisualPreset));
  if (mask & S_ENERGY_VARIANT) out.push(indexIn(PROJECTILE_ENERGY_BALL_VARIANTS, entry.energyBallVariant));
  if (mask & S_SPORE_VARIANT) out.push(indexIn(PROJECTILE_SPORE_VISUAL_VARIANTS, entry.sporeVisualVariant));
  if (mask & S_AUDIO) out.push(entry.shotAudioKey as string);
  if (mask & S_FLAGS) out.push(flags);
  if (mask & S_TRACER) {
    const tracer = entry.tracer as TracerConfig;
    let tmask = 0;
    if (tracer.maxLength !== undefined) tmask |= T_MAX_LENGTH;
    if (tracer.colorCore !== undefined) tmask |= T_COLOR_CORE;
    if (tracer.colorGlow !== undefined) tmask |= T_COLOR_GLOW;
    out.push(
      tmask,
      tracer.widthCore,
      tracer.widthGlow,
      Math.round(tracer.alphaCore * TRACER_ALPHA_QUANT),
      Math.round(tracer.alphaGlow * TRACER_ALPHA_QUANT),
      tracer.segments,
      tracer.fadeMs,
    );
    if (tmask & T_MAX_LENGTH) out.push(tracer.maxLength as number);
    if (tmask & T_COLOR_CORE) out.push(tracer.colorCore as number);
    if (tmask & T_COLOR_GLOW) out.push(tracer.colorGlow as number);
  }
}

/** Dekodiert den Statik-Strom zurück in Vollersatz-Einträge. */
export function decodeProjectileStatics(
  stream: readonly (number | string)[],
): SyncedProjectileStatic[] {
  const result: SyncedProjectileStatic[] = [];
  let i = 0;
  while (i + 2 < stream.length) {
    const id = stream[i++] as number;
    const mask = stream[i++] as number;
    const entry: SyncedProjectileStatic = { id, ownerId: stream[i++] as string };
    if (mask & S_STYLE) entry.style = valueAt(PROJECTILE_STYLES, stream[i++] as number);
    if (mask & S_COLOR) entry.color = stream[i++] as number;
    if (mask & S_OWNER_COLOR) entry.ownerColor = stream[i++] as number;
    if (mask & S_MUZZLE) {
      entry.visualMuzzleOrigin = { x: stream[i++] as number, y: stream[i++] as number };
    }
    if (mask & S_SCALE) entry.projectileVisualScale = stream[i++] as number;
    if (mask & S_SMOKE) entry.smokeTrailColor = stream[i++] as number;
    if (mask & S_DECAY) entry.velocityDecay = stream[i++] as number;
    if (mask & S_BULLET_PRESET) {
      entry.bulletVisualPreset = valueAt(PROJECTILE_BULLET_VISUAL_PRESETS, stream[i++] as number);
    }
    if (mask & S_GRENADE_PRESET) {
      entry.grenadeVisualPreset = valueAt(PROJECTILE_GRENADE_VISUAL_PRESETS, stream[i++] as number);
    }
    if (mask & S_ENERGY_VARIANT) {
      entry.energyBallVariant = valueAt(PROJECTILE_ENERGY_BALL_VARIANTS, stream[i++] as number);
    }
    if (mask & S_SPORE_VARIANT) {
      entry.sporeVisualVariant = valueAt(PROJECTILE_SPORE_VISUAL_VARIANTS, stream[i++] as number);
    }
    if (mask & S_AUDIO) entry.shotAudioKey = stream[i++] as string;
    if (mask & S_FLAGS) {
      const flags = stream[i++] as number;
      // Nur bei Wahrheit setzen: `canDamageTarget` hat `allowTeamDamage = false` als Default, und
      // `suppressSpawnFx` wird nur auf Wahrheit geprüft – ein weggelassenes Flag ist damit
      // verhaltensgleich zu einem expliziten `false`.
      if (flags & FLAG_ALLOW_TEAM_DAMAGE) entry.allowTeamDamage = true;
      if (flags & FLAG_SUPPRESS_SPAWN_FX) entry.suppressSpawnFx = true;
    }
    if (mask & S_TRACER) {
      const tmask = stream[i++] as number;
      const tracer: {
        widthCore: number; widthGlow: number; alphaCore: number; alphaGlow: number;
        segments: number; fadeMs: number;
        maxLength?: number; colorCore?: number; colorGlow?: number;
      } = {
        widthCore: stream[i++] as number,
        widthGlow: stream[i++] as number,
        alphaCore: (stream[i++] as number) / TRACER_ALPHA_QUANT,
        alphaGlow: (stream[i++] as number) / TRACER_ALPHA_QUANT,
        segments: stream[i++] as number,
        fadeMs: stream[i++] as number,
      };
      if (tmask & T_MAX_LENGTH) tracer.maxLength = stream[i++] as number;
      if (tmask & T_COLOR_CORE) tracer.colorCore = stream[i++] as number;
      if (tmask & T_COLOR_GLOW) tracer.colorGlow = stream[i++] as number;
      entry.tracer = tracer;
    }
    result.push(entry);
  }
  return result;
}

// ── Dynamik ─────────────────────────────────────────────────────────────────

function encodeBurn(entry: SyncedProjectileDynamic): number {
  const styleCode = entry.projectileBurnVisualStyle === 'normal'
    ? 1
    : entry.projectileBurnVisualStyle === 'void'
      ? 2
      : 0;
  return (entry.burning ? 1 : 0) | (styleCode << 1);
}

function encodeMiniRocketPhase(phase: MiniRocketFlightPhase | undefined): number {
  return phase === 'attack' ? 1 : phase === 'coast' ? 2 : phase === 'return' ? 3 : 0;
}

function decodeMiniRocketPhase(code: number): MiniRocketFlightPhase | undefined {
  return code === 1 ? 'attack' : code === 2 ? 'coast' : code === 3 ? 'return' : undefined;
}

/** Hängt einen (immer vollständigen) Dynamik-Eintrag an den flachen Strom an. */
export function encodeProjectileDynamic(
  out: Array<number | string>,
  entry: SyncedProjectileDynamic,
): void {
  const burnPacked = encodeBurn(entry);
  let mask = 0;
  if (burnPacked !== 0) mask |= D_BURN;
  if (entry.miniRocketPhase !== undefined || entry.miniRocketCascadeStage !== undefined) {
    mask |= D_MINI_ROCKET;
  }

  out.push(entry.id, mask, entry.x, entry.y, entry.vx, entry.vy, entry.size);
  if (mask & D_BURN) out.push(burnPacked);
  if (mask & D_MINI_ROCKET) {
    out.push(
      encodeMiniRocketPhase(entry.miniRocketPhase),
      entry.miniRocketCascadeStage ?? MINI_ROCKET_CASCADE_NONE,
    );
  }
}

/** Dekodiert den Dynamik-Strom zurück in vollständige Einträge. */
export function decodeProjectileDynamics(
  stream: readonly (number | string)[],
): SyncedProjectileDynamic[] {
  const result: SyncedProjectileDynamic[] = [];
  let i = 0;
  while (i + 6 < stream.length) {
    const id = stream[i++] as number;
    const mask = stream[i++] as number;
    const entry: SyncedProjectileDynamic = {
      id,
      x: stream[i++] as number,
      y: stream[i++] as number,
      vx: stream[i++] as number,
      vy: stream[i++] as number,
      size: stream[i++] as number,
    };
    if (mask & D_BURN) {
      const burnPacked = stream[i++] as number;
      if (burnPacked & 1) entry.burning = true;
      const styleCode = burnPacked >> 1;
      if (styleCode === 1) entry.projectileBurnVisualStyle = 'normal' as GroundFireVisualStyle;
      else if (styleCode === 2) entry.projectileBurnVisualStyle = 'void' as GroundFireVisualStyle;
    }
    if (mask & D_MINI_ROCKET) {
      entry.miniRocketPhase = decodeMiniRocketPhase(stream[i++] as number);
      const cascade = stream[i++] as number;
      if (cascade !== MINI_ROCKET_CASCADE_NONE) entry.miniRocketCascadeStage = cascade;
    }
    result.push(entry);
  }
  return result;
}

/** Zählt die Dynamik-Einträge im Strom, ohne Objekte zu allozieren (für die Netz-Diagnostik). */
export function countProjectileDynamics(stream: readonly (number | string)[]): number {
  let count = 0;
  let i = 0;
  while (i + 6 < stream.length) {
    const mask = stream[i + 1] as number;
    i += 7;
    if (mask & D_BURN) i += 1;
    if (mask & D_MINI_ROCKET) i += 2;
    count += 1;
  }
  return count;
}

// ── Zusammenführung auf dem Client ──────────────────────────────────────────

/** Ein leerer, aber als vollständig markierter Snapshot (Countdown, Full-Snapshot-Fallback). */
export const EMPTY_FULL_PROJECTILE_SNAPSHOT: SyncedProjectileSnapshot = { s: [], u: [], f: 1 };

/**
 * Baut aus Statik-Cache und Snapshot die vollständige Projektilliste, die der Rest des Clients
 * unverändert weiterverwendet (ProjectileManager.clientSyncVisuals, ArenaScene-Spawnsicherheit).
 *
 * Der übergebene Cache wird dabei fortgeschrieben: neue Statiken landen darin, und Einträge, deren
 * ID nicht mehr im Dynamik-Strom vorkommt, werden entfernt. Das hält die Despawn-Semantik
 * "weg = nicht mehr in `u`" bei jedem Tick selbstheilend.
 *
 * Ein Dynamik-Eintrag ohne bekannte Statik wird verworfen statt mit Defaults gerendert – ein
 * Projektil im falschen Stil wäre schlimmer als ein kurzes Loch, und der Statik-Resend holt den
 * Eintrag im Regelfall im nächsten Tick nach.
 */
export function applyProjectileSnapshot(
  staticCache: Map<number, SyncedProjectileStatic>,
  snapshot: SyncedProjectileSnapshot | undefined,
): SyncedProjectile[] {
  // Fehlender Schlüssel heisst "keine aktiven Projektile" – exakt die frühere `raw.j ?? []`-Semantik.
  if (!snapshot) {
    staticCache.clear();
    return [];
  }
  if (snapshot.f === 1) staticCache.clear();

  for (const entry of decodeProjectileStatics(snapshot.s)) {
    staticCache.set(entry.id, entry);
  }

  const seen = new Set<number>();
  const result: SyncedProjectile[] = [];
  for (const dynamic of decodeProjectileDynamics(snapshot.u)) {
    seen.add(dynamic.id);
    const shared = staticCache.get(dynamic.id);
    if (!shared) continue;
    result.push({
      id: dynamic.id,
      ownerId: shared.ownerId,
      x: dynamic.x,
      y: dynamic.y,
      vx: dynamic.vx,
      vy: dynamic.vy,
      size: dynamic.size,
      color: shared.color ?? 0,
      allowTeamDamage: shared.allowTeamDamage,
      ownerColor: shared.ownerColor,
      visualMuzzleOrigin: shared.visualMuzzleOrigin,
      projectileVisualScale: shared.projectileVisualScale,
      smokeTrailColor: shared.smokeTrailColor,
      style: shared.style,
      sporeVisualVariant: shared.sporeVisualVariant,
      bulletVisualPreset: shared.bulletVisualPreset,
      grenadeVisualPreset: shared.grenadeVisualPreset,
      energyBallVariant: shared.energyBallVariant,
      velocityDecay: shared.velocityDecay,
      tracer: shared.tracer,
      shotAudioKey: shared.shotAudioKey,
      suppressSpawnFx: shared.suppressSpawnFx,
      miniRocketPhase: dynamic.miniRocketPhase,
      miniRocketCascadeStage: dynamic.miniRocketCascadeStage,
      projectileBurnVisualStyle: dynamic.projectileBurnVisualStyle,
      burning: dynamic.burning,
    });
  }

  for (const id of staticCache.keys()) {
    if (!seen.has(id)) staticCache.delete(id);
  }
  return result;
}
