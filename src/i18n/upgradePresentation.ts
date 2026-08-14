import rawUpgradePresentation from './upgradePresentationContent.json';
import type { Locale } from './types';
import { ENGLISH_UPGRADE_DESCRIPTIONS } from './upgradePresentationEnglish';

type PresentationText = {
  name?: unknown;
  description?: unknown;
};
type RawUpgrade = {
  id?: unknown;
  de?: PresentationText;
  en?: PresentationText;
};
type RawCategory = {
  id?: unknown;
  de?: PresentationText;
  en?: PresentationText;
  upgrades?: readonly RawUpgrade[];
};

const rawCategories = (rawUpgradePresentation as { categories?: readonly RawCategory[] }).categories ?? [];
const rawUpgrades = new Map<string, RawUpgrade>();
const rawCategoryData = new Map<string, RawCategory>();
for (const category of rawCategories) {
  if (typeof category.id !== 'string') continue;
  rawCategoryData.set(category.id, category);
  for (const upgrade of category.upgrades ?? []) {
    if (typeof upgrade.id === 'string') rawUpgrades.set(upgrade.id, upgrade);
  }
}

const WORDS: Readonly<Record<string, string>> = {
  ak47: 'AK-47',
  asmd: 'ASMD',
  awp: 'AWP',
  he: 'HE',
  xbow: 'XXX-BOW',
  hp: 'Health',
  regeneration: 'Regeneration',
  armor: 'Armor',
  adrenaline: 'Adrenaline',
  rage: 'Rage',
  critical: 'Critical',
  speed: 'Speed',
  range: 'Range',
  recovery: 'Recovery',
  cost: 'Cost',
  radius: 'Radius',
  cooldown: 'Cooldown',
  duration: 'Duration',
  unlock: 'Unlock',
  construction: 'Construction',
  slots: 'Slots',
  drone: 'Drone',
  turret: 'Turret',
  rocket: 'Rocket',
  flame: 'Flame',
  machine: 'Machine',
  gun: 'Gun',
  shield: 'Shield',
  grenade: 'Grenade',
  damage: 'Damage',
  dash: 'Dash',
  fire: 'Fire',
  trail: 'Trail',
  guardian: 'Guardian',
  spirit: 'Spirit',
  slime: 'Slime',
  necromancy: 'Necromancy',
  spawn: 'Spawn',
  chance: 'Chance',
  projectile: 'Projectile',
  projectiles: 'Projectiles',
  bullets: 'Bullets',
  homing: 'Homing',
  primary: 'Primary',
  secondary: 'Secondary',
  spore: 'Spore',
  spores: 'Spores',
  injector: 'Injector',
  plasma: 'Plasma',
  burner: 'Burner',
  overcharge: 'Overcharge',
  core: 'Core',
  bubble: 'Bubble',
  smoke: 'Smoke',
  molotov: 'Molotov',
  stink: 'Stink',
  cloud: 'Cloud',
  translocator: 'Translocator',
  zeus: 'Zeus',
  decoy: 'Decoy',
  time: 'Time',
  holy: 'Holy',
  hand: 'Hand',
  slow: 'Slow',
  mini: 'Mini',
  rockets: 'Rockets',
  launcher: 'Launcher',
  shotgun: 'Shotgun',
  tesla: 'Tesla',
  dome: 'Dome',
  gauss: 'Gauss',
  rifle: 'Rifle',
  airstrike: 'Airstrike',
  honey: 'Honey',
  badger: 'Badger',
  medic: 'Medic',
  pedestal: 'Pedestal',
  gravity: 'Gravity',
  rock: 'Rock',
  barrier: 'Barrier',
  leaf: 'Leaf',
  blower: 'Blower',
  bite: 'Bite',
  hydra: 'Hydra',
  flamethrower: 'Flamethrower',
  fireball: 'Fireball',
  negev: 'Negev',
  glock: 'Glock',
  powerup: 'Power-up',
  burning: 'Burning',
  ground: 'Ground',
  explosion: 'Explosion',
  explosive: 'Explosive',
  cluster: 'Cluster',
  charge: 'Charge',
  overdrive: 'Overdrive',
  black: 'Black',
  hole: 'Hole',
  cascade: 'Cascade',
  protocol: 'Protocol',
  homecoming: 'Homecoming',
  undying: 'Undying',
  dominance: 'Dominance',
  spirits: 'Spirits',
};

function fallbackName(id: string, locale: Locale): string {
  const name = id.split('_').map((part) => WORDS[part] ?? part[0]?.toUpperCase() + part.slice(1)).join(' ');
  return name;
}

const SIMPLE_DESCRIPTION_REPLACEMENTS: readonly [string, string][] = [
  ['maximale Lebenspunkte', 'maximum health'],
  ['maximale HP', 'maximum health'],
  ['maximales Adrenalin', 'maximum adrenaline'],
  ['maximale Rüstung', 'maximum armor'],
  ['positiver Rüstungsgewinn', 'positive armor gain'],
  ['Adrenalinverbrauch', 'adrenaline cost'],
  ['Adrenalingewinn', 'adrenaline gain'],
  ['Adrenalin-Spritze', 'adrenaline syringe'],
  ['Adrenalin', 'adrenaline'],
  ['Rüstung', 'armor'],
  ['Lebenspunkte', 'health'],
  ['Laufgeschwindigkeit', 'movement speed'],
  ['Fluggeschwindigkeit', 'flight speed'],
  ['Projektilgeschwindigkeit', 'projectile speed'],
  ['Wirkungsbereich', 'area of effect'],
  ['Wirkdauer', 'duration'],
  ['Explosionsradius', 'explosion radius'],
  ['Detonationsradius', 'detonation radius'],
  ['Schadensreduktion', 'damage reduction'],
  ['Schadensverlust', 'damage loss'],
  ['Schadensabfall', 'damage falloff'],
  ['Brandschaden', 'burn damage'],
  ['Direktschaden', 'direct damage'],
  ['Trefferschaden', 'hit damage'],
  ['Schaden', 'damage'],
  ['Rückstoß', 'knockback'],
  ['Reichweite', 'range'],
  ['Feuerrate', 'fire rate'],
  ['Feuerschaden', 'fire damage'],
  ['Feuerfläche', 'fire area'],
  ['Feuerlache', 'fire puddle'],
  ['Feuerball', 'fireball'],
  ['Brand', 'burn'],
  ['brennenden', 'burning'],
  ['Brennende', 'Burning'],
  ['je Stufe', 'per level'],
  ['pro Stufe', 'per level'],
  ['pro Sekunde', 'per second'],
  ['pro Tick', 'per tick'],
  ['pro Schuss', 'per shot'],
  ['pro Treffer', 'per hit'],
  ['unter der Erde', 'underground'],
  ['für Waffe 1', 'for Weapon 1'],
  ['für Waffe 2', 'for Weapon 2'],
  ['für den Ultimate-Slot', 'for the Ultimate slot'],
  ['für den Utility-Slot', 'for the Utility slot'],
  ['Erhöht', 'Increases'],
  ['Reduziert', 'Reduces'],
  ['Verringert', 'Reduces'],
  ['Verbessert', 'Improves'],
  ['Setzt', 'Sets'],
  ['Gegner', 'enemies'],
  ['Ziele', 'targets'],
  ['Ziel', 'target'],
  ['Geschosse', 'projectiles'],
  ['Projektil', 'projectile'],
  ['Kugeln', 'bullets'],
  ['Kugel', 'bullet'],
  ['Schüsse', 'shots'],
  ['Schuss', 'shot'],
  ['Ladung', 'charge'],
  ['Ladezeit', 'charge time'],
  ['Wahrscheinlichkeit', 'chance'],
  ['Verlangsamung', 'slow'],
  ['Bewegungsgeschwindigkeit', 'movement speed'],
  ['Genauigkeit', 'accuracy'],
  ['Lebensdauer', 'lifetime'],
  ['Fläche', 'area'],
  ['Boden', 'ground'],
  ['Einschlag', 'impact'],
  ['Sekunden', 'seconds'],
  ['Sekunde', 'second'],
  ['Grad', 'degrees'],
  ['Pixel', 'px'],
  ['für', 'for'],
  ['des', 'of the'],
  ['der', 'the'],
  ['die', 'the'],
  ['den', 'the'],
  ['dem', 'the'],
  ['und', 'and'],
  ['oder', 'or'],
  ['ohne', 'without'],
  ['mit', 'with'],
  ['bis zu', 'up to'],
  [' maximal', ' maximum'],
  [' wird ', ' is '],
  [' werden ', ' are '],
  [' erhält ', ' gains '],
];

function translateSimpleDescription(description: string): string {
  let translated = description;
  for (const [from, to] of SIMPLE_DESCRIPTION_REPLACEMENTS) {
    translated = translated.split(from).join(to);
  }
  return translated
    .split('Waffe 1').join('Weapon 1')
    .split('Waffe 2').join('Weapon 2')
    .split('Map').join('map')
    .split('Stapel').join('stacks')
    .split('Stack').join('stack')
    .split('Verzögerung').join('delay')
    .split('Aufwärmzeit').join('warm-up time')
    .split('Abklingzeit').join('cooldown')
    .split('  ').join(' ');
}

function value(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function textFor(entry: RawCategory | RawUpgrade | undefined, locale: Locale, field: 'name' | 'description'): string | undefined {
  const text = locale === 'de' ? entry?.de : entry?.en;
  return value(text?.[field]);
}

export function getUpgradeCategoryName(id: string, locale: Locale): string {
  return textFor(rawCategoryData.get(id), locale, 'name')
    ?? fallbackName(id, locale);
}

export function getUpgradeCategoryDescription(id: string, locale: Locale): string {
  return textFor(rawCategoryData.get(id), locale, 'description')
    ?? '';
}

export function getUpgradeName(id: string, locale: Locale): string {
  if (locale === 'en') return fallbackName(id, locale);
  return textFor(rawUpgrades.get(id), locale, 'name') ?? fallbackName(id, locale);
}

export function getUpgradeDescription(id: string, locale: Locale): string {
  const entry = rawUpgrades.get(id);
  if (locale === 'en') {
    const authored = ENGLISH_UPGRADE_DESCRIPTIONS[id];
    if (authored) return authored;
    const german = textFor(entry, 'de', 'description');
    if (german) return translateSimpleDescription(german);
  }
  return textFor(entry, locale, 'description') ?? '';
}

export function getUpgradePresentationKeys(): readonly string[] {
  return [
    ...[...rawCategoryData.keys()].map((id) => `upgradeCategory.${id}.name`),
    ...[...rawCategoryData.keys()].map((id) => `upgradeCategory.${id}.description`),
    ...[...rawUpgrades.keys()].map((id) => `upgrade.${id}.name`),
    ...[...rawUpgrades.keys()].map((id) => `upgrade.${id}.description`),
  ];
}
