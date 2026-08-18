import { getDomainCatalog, getDomainKeys, translate } from './catalog';
import type { Locale } from './types';

export interface LocalizedText {
  readonly de: string;
  readonly en: string;
}

function fallbackText(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contentKey(key: string, locale: Locale, fallback = fallbackText(key)): string {
  return getDomainCatalog('en', 'content')[key] !== undefined ? translate(locale, key) : fallback;
}

/** Kept for presentation-helper compatibility; authored values normally come from the catalogs. */
export function localizedText(text: LocalizedText, locale: Locale): string {
  return text[locale];
}

export function getLoadoutItemName(id: string, locale: Locale): string {
  return contentKey(`loadout.${id}.name`, locale, fallbackText(id));
}

export function getClassRole(id: string, locale: Locale): string {
  return contentKey(`class.${id}.role`, locale, fallbackText(id));
}

export function getClassName(id: string, locale: Locale): string {
  return contentKey(`class.${id}.name`, locale, fallbackText(id));
}

export function getClassTooltipLines(id: string, locale: Locale): readonly string[] {
  const prefix = `class.${id}.tooltip.`;
  return getDomainKeys('content')
    .filter((key) => key.startsWith(prefix))
    .sort((left, right) => Number(left.slice(prefix.length)) - Number(right.slice(prefix.length)))
    .map((key) => translate(locale, key));
}

export function getClassDescription(id: string, locale: Locale): string {
  return contentKey(`class.${id}.description`, locale, '');
}

export function getConstructionName(id: string, locale: Locale): string {
  return contentKey(`construction.${id}.name`, locale, fallbackText(id));
}

export function getConstructionDescription(id: string, locale: Locale): string {
  return contentKey(`construction.${id}.description`, locale, '');
}

export function getPowerUpName(id: string, locale: Locale): string {
  return contentKey(`powerup.${id}.name`, locale, fallbackText(id));
}

export function getMapName(id: string, locale: Locale): string {
  return contentKey(`map.${id}.name`, locale, `Map ${id}`);
}

export function getMapTutorial(id: string, locale: Locale): string | undefined {
  const key = `map.${id}.tutorial`;
  return getDomainCatalog('en', 'content')[key] === undefined ? undefined : translate(locale, key);
}

export function getSecondaryObjectiveTitle(id: string, locale: Locale): string | undefined {
  const key = `map.secondaryObjective.${id}.title`;
  return getDomainCatalog('en', 'content')[key] === undefined ? undefined : translate(locale, key);
}

export function getSecondaryObjectiveReward(id: string, locale: Locale): string | undefined {
  const key = `map.secondaryObjective.${id}.reward`;
  return getDomainCatalog('en', 'content')[key] === undefined ? undefined : translate(locale, key);
}

export function getEnemyName(id: string, locale: Locale): string {
  return contentKey(`enemy.${id}.name`, locale, fallbackText(id));
}

export function getSourceName(id: string, locale: Locale): string {
  const imbued = id.endsWith(':imbued');
  const swarmExplosion = id.endsWith(':swarm-explosion');
  const baseId = imbued || swarmExplosion ? id.slice(0, id.lastIndexOf(':')) : id;
  const directKey = `source.${baseId}.name`;
  const powerUpKey = baseId.startsWith('powerup.') ? `powerup.${baseId.slice('powerup.'.length)}.name` : undefined;
  const loadoutKey = `loadout.${baseId}.name`;
  const content = getDomainCatalog('en', 'content');
  const baseName = content[directKey] !== undefined
    ? translate(locale, directKey)
    : powerUpKey && content[powerUpKey] !== undefined
      ? translate(locale, powerUpKey)
      : content[loadoutKey] !== undefined
        ? translate(locale, loadoutKey)
        : fallbackText(baseId);
  if (imbued) return `${baseName} · ${translate(locale, 'source.modifier.imbued')}`;
  if (swarmExplosion) return `${baseName} · ${translate(locale, 'source.modifier.swarmExplosion')}`;
  return baseName;
}

export function getContentDisplayName(id: string, locale: Locale): string {
  if (id.startsWith('construction.')) return getConstructionName(id.slice('construction.'.length), locale);
  if (id.startsWith('powerup.')) return getPowerUpName(id.slice('powerup.'.length), locale);
  if (id.startsWith('enemy.')) return getEnemyName(id.slice('enemy.'.length), locale);
  if (id.startsWith('source.')) return getSourceName(id.slice('source.'.length), locale);
  if (getDomainCatalog('en', 'content')[`powerup.${id}.name`] !== undefined) return getPowerUpName(id, locale);
  return getLoadoutItemName(id, locale);
}

export function getContentTranslationKeys(): readonly string[] {
  return getDomainKeys('content');
}

export function getContentTranslation(key: string, locale: Locale): string | undefined {
  return getDomainCatalog('en', 'content')[key] === undefined ? undefined : translate(locale, key);
}
