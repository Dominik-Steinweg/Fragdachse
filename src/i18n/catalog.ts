import { deContent } from './de/content';
import { deUi } from './de/ui';
import { deUpgrades } from './de/upgrades';
import { enContent } from './en/content';
import { enUi } from './en/ui';
import { enUpgrades } from './en/upgrades';
import type { Locale } from './types';

export type TranslationDomain = 'ui' | 'content' | 'upgrades';

const DOMAIN_ORDER: readonly TranslationDomain[] = ['ui', 'content', 'upgrades'];
const sourceCatalogs: Record<Locale, Record<TranslationDomain, Readonly<Record<string, string>>>> = {
  de: { ui: deUi, content: deContent, upgrades: deUpgrades },
  en: { ui: enUi, content: enContent, upgrades: enUpgrades },
};

interface BuiltCatalog {
  readonly values: Readonly<Record<string, string>>;
  readonly owners: Readonly<Record<string, readonly TranslationDomain[]>>;
  readonly collisions: readonly string[];
}

export interface TranslationSegment {
  readonly text: string;
  readonly dynamic: boolean;
}

function buildCatalog(locale: Locale): BuiltCatalog {
  const values: Record<string, string> = {};
  const owners: Record<string, TranslationDomain[]> = {};
  for (const domain of DOMAIN_ORDER) {
    for (const [key, value] of Object.entries(sourceCatalogs[locale][domain])) {
      (owners[key] ??= []).push(domain);
      if (values[key] === undefined) values[key] = value;
    }
  }
  const collisions = Object.entries(owners)
    .filter(([, domains]) => domains.length > 1)
    .map(([key, domains]) => `${locale}:${key} (${domains.join(', ')})`);
  return {
    values: Object.freeze(values),
    owners: Object.freeze(Object.fromEntries(
      Object.entries(owners).map(([key, domains]) => [key, Object.freeze([...domains])]),
    )),
    collisions: Object.freeze(collisions),
  };
}

const builtCatalogs: Record<Locale, BuiltCatalog> = {
  de: buildCatalog('de'),
  en: buildCatalog('en'),
};

export function translateSegments(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): readonly TranslationSegment[] {
  const value = builtCatalogs[locale].values[key]
    ?? (locale === 'de' ? builtCatalogs.en.values[key] : undefined)
    ?? `⟦${key}⟧`;
  const segments: TranslationSegment[] = [];
  const pattern = /\{([a-zA-Z0-9_]+)\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) segments.push({ text: value.slice(cursor, match.index), dynamic: false });
    const name = match[1];
    if (params && Object.prototype.hasOwnProperty.call(params, name)) {
      segments.push({ text: String(params[name]), dynamic: true });
    } else {
      segments.push({ text: match[0], dynamic: false });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), dynamic: false });
  return segments;
}

/** Resolves one language catalog and falls back from German to the authored English catalog. */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  return translateSegments(locale, key, params).map((segment) => segment.text).join('');
}

export function getCatalog(locale: Locale): Readonly<Record<string, string>> {
  return builtCatalogs[locale].values;
}

export function getDomainCatalog(
  locale: Locale,
  domain: TranslationDomain,
): Readonly<Record<string, string>> {
  return sourceCatalogs[locale][domain];
}

export function getDomainKeys(domain: TranslationDomain): readonly string[] {
  return Object.keys(sourceCatalogs.en[domain]);
}

/** Reports keys accidentally authored in more than one domain of the same language. */
export function getTranslationSourceCollisions(locale?: Locale): readonly string[] {
  return locale
    ? builtCatalogs[locale].collisions
    : [...builtCatalogs.de.collisions, ...builtCatalogs.en.collisions];
}

export function getTranslationKeySources(locale: Locale): Readonly<Record<string, readonly TranslationDomain[]>> {
  return builtCatalogs[locale].owners;
}

export function getTranslationParityIssues(): string[] {
  const issues: string[] = [];
  const de = builtCatalogs.de.values;
  const en = builtCatalogs.en.values;
  const deKeys = new Set(Object.keys(de));
  const enKeys = new Set(Object.keys(en));
  for (const key of deKeys) if (!enKeys.has(key)) issues.push(`Missing en key: ${key}`);
  for (const key of enKeys) if (!deKeys.has(key)) issues.push(`Missing de key: ${key}`);
  for (const key of deKeys) {
    const deParams = [...de[key].matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    const enParams = [...(en[key] ?? '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    if (deParams.join('|') !== enParams.join('|')) issues.push(`Parameter mismatch: ${key}`);
  }
  return issues;
}
