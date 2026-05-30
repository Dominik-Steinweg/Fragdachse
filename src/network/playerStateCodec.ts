/**
 * Kompakte (De-)Serialisierung von {@link PlayerNetState} für die Übertragung.
 *
 * Motivation: Der Spieler-State wird jeden Tick vollständig pro Spieler gesendet (~440 B). Der Großteil
 * sind wiederholte, lange Schlüssel (`decoyStealthRemainingFrac`, `ultimateChargeFraction`, …) und je
 * ein eigenes Feld pro Boolean. Hier werden die Schlüssel auf 1–2 Zeichen verkürzt und die sieben
 * Booleans in ein einziges Bitfeld gefaltet – verlustfrei und ohne Delta-Logik (Direktheit bleibt voll
 * erhalten, da weiterhin jeder Tick der komplette Zustand übertragen wird). Bei 12 Spielern halbiert das
 * den konstanten Spieler-Anteil der Payload grob.
 */
import type { BurrowPhase, PlayerAimNetState, PlayerNetState } from '../types';

const BURROW_PHASES: readonly BurrowPhase[] = ['idle', 'windup', 'underground', 'trapped', 'recovery'];

const FLAG_ALIVE = 1;
const FLAG_BURROWED = 2;
const FLAG_STUNNED = 4;
const FLAG_RAGING = 8;
const FLAG_CHARGING_ULT = 16;
const FLAG_DECOY_STEALTHED = 32;
const FLAG_AIM_MOVING = 64;

/** Kompakte Wire-Form eines Spielers. Schlüssel bewusst kurz; optionale Felder fehlen bei Default. */
interface CompactPlayerState {
  x: number;
  y: number;
  r: number;   // rot (uint8)
  h: number;   // hp
  m: number;   // maxHp
  a: number;   // armor
  d: number;   // adrenaline
  g: number;   // rage
  b: number;   // burnStacks
  p: number;   // dashPhase
  w: number;   // burrowPhase als Index
  f: number;   // Bitfeld (siehe FLAG_*)
  v: number;   // aim.revision
  s1: number;  // aim.weapon1DynamicSpread
  s2: number;  // aim.weapon2DynamicSpread
  k?: string;  // activeUltimateId (nur wenn gesetzt)
  cf?: number; // ultimateChargeFraction (nur wenn != 0)
  cr?: number; // ultimateChargeRange (nur wenn != 0)
  sf?: number; // decoyStealthRemainingFrac (nur wenn != 0)
}

function encodePlayerState(state: PlayerNetState): CompactPlayerState {
  let flags = 0;
  if (state.alive) flags |= FLAG_ALIVE;
  if (state.isBurrowed) flags |= FLAG_BURROWED;
  if (state.isStunned) flags |= FLAG_STUNNED;
  if (state.isRaging) flags |= FLAG_RAGING;
  if (state.isChargingUltimate) flags |= FLAG_CHARGING_ULT;
  if (state.isDecoyStealthed) flags |= FLAG_DECOY_STEALTHED;
  if (state.aim.isMoving) flags |= FLAG_AIM_MOVING;

  const compact: CompactPlayerState = {
    x: state.x,
    y: state.y,
    r: state.rot,
    h: state.hp,
    m: state.maxHp,
    a: state.armor,
    d: state.adrenaline,
    g: state.rage,
    b: state.burnStacks,
    p: state.dashPhase,
    w: Math.max(0, BURROW_PHASES.indexOf(state.burrowPhase)),
    f: flags,
    v: state.aim.revision,
    s1: state.aim.weapon1DynamicSpread,
    s2: state.aim.weapon2DynamicSpread,
  };

  if (state.activeUltimateId !== undefined) compact.k = state.activeUltimateId;
  if (state.ultimateChargeFraction) compact.cf = state.ultimateChargeFraction;
  if (state.ultimateChargeRange) compact.cr = state.ultimateChargeRange;
  if (state.decoyStealthRemainingFrac) compact.sf = state.decoyStealthRemainingFrac;

  return compact;
}

function decodePlayerState(compact: CompactPlayerState): PlayerNetState {
  const flags = compact.f;
  const aim: PlayerAimNetState = {
    revision: compact.v,
    isMoving: (flags & FLAG_AIM_MOVING) !== 0,
    weapon1DynamicSpread: compact.s1,
    weapon2DynamicSpread: compact.s2,
  };

  return {
    x: compact.x,
    y: compact.y,
    rot: compact.r,
    hp: compact.h,
    maxHp: compact.m,
    armor: compact.a,
    alive: (flags & FLAG_ALIVE) !== 0,
    adrenaline: compact.d,
    rage: compact.g,
    isBurrowed: (flags & FLAG_BURROWED) !== 0,
    isStunned: (flags & FLAG_STUNNED) !== 0,
    burrowPhase: BURROW_PHASES[compact.w] ?? 'idle',
    isRaging: (flags & FLAG_RAGING) !== 0,
    activeUltimateId: compact.k,
    burnStacks: compact.b,
    isChargingUltimate: (flags & FLAG_CHARGING_ULT) !== 0,
    ultimateChargeFraction: compact.cf ?? 0,
    ultimateChargeRange: compact.cr ?? 0,
    isDecoyStealthed: (flags & FLAG_DECOY_STEALTHED) !== 0,
    decoyStealthRemainingFrac: compact.sf ?? 0,
    dashPhase: compact.p as 0 | 1 | 2,
    aim,
  };
}

/** Kodiert die komplette Spieler-Map (Schlüssel = Spieler-ID) in die kompakte Wire-Form. */
export function encodePlayerStates(players: Record<string, PlayerNetState>): Record<string, CompactPlayerState> {
  const result: Record<string, CompactPlayerState> = {};
  for (const id in players) {
    result[id] = encodePlayerState(players[id]);
  }
  return result;
}

/** Dekodiert die kompakte Spieler-Map zurück in vollwertige PlayerNetState-Objekte. */
export function decodePlayerStates(raw: Record<string, CompactPlayerState>): Record<string, PlayerNetState> {
  const result: Record<string, PlayerNetState> = {};
  for (const id in raw) {
    result[id] = decodePlayerState(raw[id]);
  }
  return result;
}
