import type { Entry, Field, Workspace } from './types';
import { formatUpgradeEffectValue } from '../../../src/i18n/format';

export const categoryNames: Record<string, string> = {
  general: 'Allgemein', weapon1: 'Primärwaffen', weapon2: 'Sekundärwaffen', utility: 'Utilities',
  construction: 'Konstruktionen', ultimate: 'Ultimates', internal: 'NPC & weitere Items', technical: 'Katalog & Regeln',
};

export interface Family {
  key: string;
  name: string;
  category: string;
  iconKey?: string;
  base?: Entry;
  upgrades: Entry[];
  related: Entry[];
}

/** The first prerequisite owns the lane, just as in the in-game upgrade forest.
 * All prerequisites remain on the nodes, including cross-branch merge edges. */
export function buildFamilies(workspace: Workspace): Family[] {
  const upgrades = workspace.entries.filter(e => e.upgrade).sort((a, b) => a.upgrade!.sortOrder - b.upgrade!.sortOrder || a.id.localeCompare(b.id));
  const byId = new Map(upgrades.map(e => [e.id, e]));
  const rootOf = (entry: Entry): Entry => {
    const seen = new Set<string>();
    while (!seen.has(entry.id)) {
      seen.add(entry.id);
      const parent = byId.get(entry.upgrade?.requires[0]?.upgradeId ?? '');
      if (!parent) break;
      entry = parent;
    }
    return entry;
  };
  const families = new Map<string, Family>();
  const owned = new Set<string>();
  for (const entry of upgrades) {
    const root = rootOf(entry);
    const base = workspace.entries.find(e => e.id === root.upgrade?.itemId && ['weapon', 'utility', 'ultimate'].includes(e.kind));
    const key = base?.key ?? root.key;
    if (!families.has(key)) families.set(key, { key, name: root.category === 'construction' ? root.name.replace(/^\S+ · /, '') : base?.name ?? root.name.replace(/^\S+ · /, ''),
      category: root.category, iconKey: base?.iconKey ?? root.iconKey, base, upgrades: [], related: [] });
    families.get(key)!.upgrades.push(entry);
    if (base) owned.add(base.key);
  }
  // Rule files are independent authorship boundaries, linked to the item they tune.
  const ruleOwners: Record<string, string> = { 'attackDrone.json': 'unlock_attack_drone_station', 'mgTurret.json': 'unlock_machine_gun_turret' };
  for (const entry of workspace.entries.filter(e => e.kind !== 'upgrade' && !owned.has(e.key))) {
    const owner = [...families.values()].find(f => f.upgrades.some(u => u.id === ruleOwners[entry.id]));
    if (entry.kind === 'rules' && owner) {
      if (!owner.base) owner.base = entry;
      else owner.related.push(entry);
      continue;
    }
    if (entry.kind === 'catalog') {
      const family = [...families.values()].find(f => f.base?.id === entry.id);
      if (family) { family.related.push(entry); continue; }
    }
    families.set(entry.key, { key: entry.key, name: entry.name, category: ['rules', 'catalog'].includes(entry.kind) ? 'technical' : 'internal',
      iconKey: entry.iconKey, base: entry, upgrades: [], related: [] });
  }
  const order = Object.keys(categoryNames);
  return [...families.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
}

const labels: Record<string, string> = {
  damage: 'Schaden', cooldown: 'Abklingzeit / Schussintervall', cooldownMs: 'Abklingzeit', range: 'Reichweite', radius: 'Radius',
  adrenalinCost: 'Adrenalinkosten', adrenalinGain: 'Adrenalingewinn', aoeDamage: 'Flächenschaden', aoeRadius: 'Explosionsradius',
  rageRequired: 'Benötigte Rage', rageCost: 'Rage-Kosten', rageDrainDuration: 'Rage-Verbrauchsdauer',
  burnOnHit: 'Brand bei Treffer', fire: 'Feuermodus', damageFalloff: 'Schadensabfall', maxCharges: 'Maximale Ladungen',
  maxHp: 'Maximale HP', hpRegenPerSecond: 'HP-Regeneration / s', lifeLeech: 'Lifeleech', lifeLeechFraction: 'Lifeleech',
  maxArmor: 'Maximale Rüstung', maxAdrenaline: 'Maximales Adrenalin', adrenalineCost: 'Adrenalinkosten',
  adrenalineGain: 'Adrenalingewinn', adrenalineRegenRate: 'Adrenalinregeneration', runSpeed: 'Laufgeschwindigkeit',
  costPerLevel: 'Kosten je Level', bossPointCostPerLevel: 'Boss-Punkte je Level', maxLevel: 'Maximales Level',
  startingLevel: 'Startlevel', refundable: 'Rückerstattung', sortOrder: 'Anzeigereihenfolge',
  projectileSpeed: 'Projektilgeschwindigkeit', projectileSize: 'Projektilgröße', pelletCount: 'Projektile je Schuss',
  projectileCount: 'Projektilanzahl', pelletSpreadAngle: 'Schrotstreuung', spreadStanding: 'Streuung im Stand',
  spreadMoving: 'Streuung in Bewegung', knockback: 'Rückstoß', duration: 'Dauer', durationMs: 'Dauer',
  damagePerTick: 'Schaden je Tick', burnDamagePerTick: 'Brandschaden je Tick', tickIntervalMs: 'Tickintervall',
  tickInterval: 'Tickintervall', burnDurationMs: 'Brenndauer', slowFraction: 'Verlangsamung',
  cloudTickInterval: 'Wolken-Tickintervall', smokeDotTickIntervalMs: 'Rauch-DoT-Tickintervall',
  corridorDotTickIntervalMs: 'Korridor-DoT-Tickintervall', bleedTickMs: 'Blutungs-Tickintervall',
  minDamage: 'Minimaler Schaden', maxDamage: 'Maximaler Schaden', damageMultiplier: 'Schadensmultiplikator',
  damageFactor: 'Schadensfaktor', criticalChance: 'Kritische Trefferchance', criticalDamageMultiplier: 'Kritischer Schaden',
  magazine: 'Magazingröße', shotIntervalMs: 'Schussintervall', burstMs: 'Salvendauer', pauseMs: 'Salvenpause',
  stationHp: 'Stations-HP', capacityCost: 'Kapazitätskosten', serviceMs: 'Versorgungsdauer',
  fullChargeDuration: 'Aufladezeit', fuseTime: 'Zündverzögerung', enabled: 'Aktiviert', value: 'Stärke je Level',
  mode: 'Berechnung', count: 'Anzahl', minLevel: 'Benötigtes Level', charges: 'Ladungen',
  player: 'Spieler', weapon: 'Waffe', utility: 'Utility', ultimate: 'Ultimate', construction: 'Konstruktion',
  hitKnockback: 'Rückstoß bei Treffer', cloudDamagePerTick: 'Wolkenschaden je Tick', cloudRadius: 'Wolkenradius',
  bubbleRadius: 'Blasenradius', rocketLauncher: 'Raketen-Effekte', impactExplosion: 'Einschlagexplosion',
  fragmentation: 'Splitter', plague: 'Seuche', prismEmitter: 'Prismenstrahlen', fireball: 'Feuerball',
};
export function readablePath(path: string): string {
  return path.split('.').map(part => labels[part] ?? part.replace(/([a-z\d])([A-Z])/g, '$1 $2').replaceAll('_', ' ')).join(' › ');
}
export function fieldName(field: Field): string { return readablePath(field.label); }

/** Deliberately conservative: damage and basic economy/tempo are daily tuning;
 * rendering, aiming algorithms, geometry and mode switches stay under details. */
export function isPrimaryField(entry: Entry, field: Field): boolean {
  if (!field.editable) return false;
  if (entry.kind === 'upgrade') return field.label === 'maxLevel';
  if (entry.kind === 'catalog') return false;
  const leaf = String(field.path.at(-1));
  if (entry.kind === 'weapon' && /^adrenalin(e)?(Cost|Gain)$/.test(field.label)) {
    const slot = field.label.endsWith('Gain') ? 'weapon1' : 'weapon2';
    return entry.fields.some(f => f.label.startsWith('allowedSlots.') && f.value === slot);
  }
  // Keep authored DoT strength and cadence visible together, including nested effects.
  if (/damagePerTick$|tickInterval(?:Ms)?$|^bleedTickMs$/i.test(leaf)) return true;
  if (field.label.includes('.')) return [
    'fire.burnDamagePerTick', 'fire.burnDurationMs', 'fire.impactExplosion.maxDamage',
    'fire.impactExplosion.minDamage', 'fire.impactExplosion.radius', 'damageFalloff.minDamage',
    'charges.maxCharges', 'activation.fullChargeDuration',
  ].includes(field.label);
  return [
    'rageRequired', 'rageCost', 'rageDrainDuration',
    'damage', 'aoeDamage', 'cloudDamagePerTick', 'cloudRadius', 'bubbleRadius', 'burnDamagePerTick',
    'cooldown', 'cooldownMs', 'range', 'radius', 'maxHp', 'stationHp', 'adrenalineCost', 'adrenalineGain',
    'adrenalinCost', 'adrenalinGain', 'aoeRadius', 'maxCharges', 'cost', 'capacityCost', 'magazine', 'pelletCount', 'projectileCount', 'shotIntervalMs',
    'tickInterval', 'tickIntervalMs', 'duration', 'durationMs', 'burstMs', 'pauseMs', 'fullChargeDuration',
  ].includes(leaf);
}

export function primaryFields(entry: Entry): Field[] {
  const rank = (f: Field) => /damage/i.test(f.label) ? 0 : /cooldown|interval/i.test(f.label) ? 1 : /range|radius/i.test(f.label) ? 2 : 3;
  return entry.fields.filter(f => isPrimaryField(entry, f)).sort((a, b) => rank(a) - rank(b));
}

export function upgradeTitle(entry: Entry): string {
  return entry.name.replace(/^\S+ · /, '').replace(/^Upgrade [^:]+:\s*/, '');
}

export function effectGroups(entry: Entry): { index: number; stat: string; fields: Field[] }[] {
  const groups = new Map<number, Field[]>();
  for (const field of entry.fields.filter(f => f.label.startsWith('effects.'))) {
    const index = Number(field.label.split('.')[1]);
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index)!.push(field);
  }
  return [...groups].map(([index, fields]) => ({ index, fields, stat: String(fields.find(f => f.label.endsWith('.stat'))?.value ?? '') }));
}

export function effectAmount(value: number, mode: string, level = 1, stat?: string): string {
  if (stat) return formatUpgradeEffectValue({ stat, mode: mode === 'add_percent_per_level' ? mode : 'add_per_level', value: value * level }, 'de');
  const amount = value * level * (mode === 'add_percent_per_level' ? 100 : 1);
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString('de-DE', { maximumFractionDigits: 5 })}${mode === 'add_percent_per_level' ? ' %' : ''}`;
}
