/**
 * Identitaeten generierter Dawn-Szenarien.
 *
 * Eine Dawn-World ist keine Kampagnenkarte: Ihre Definition entsteht pro Runde aus einem
 * replizierten Plan, nicht aus der Map-Registry. Die IDs tragen deshalb einen eigenen Namensraum,
 * fuer den `toMapId()` bewusst `null` liefert – ein vergessener Kampagnen-Lookup scheitert laut,
 * statt still auf die Default-Map zu fallen.
 */

const WORLD_PREFIX = 'world:dawn:';
const ACTIVITY_PREFIX = 'activity:dawn:';
/** Kompatibilitaets-`mapId` der aufgeloesten Coop-Config; nie ein Registry-Schluessel. */
const MAP_ID_PREFIX = 'dawn:';

const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

export function isDawnTemplateId(value: unknown): value is string {
  return typeof value === 'string' && TEMPLATE_ID_PATTERN.test(value);
}

export function toDawnWorldDefinitionId(templateId: string): string {
  return `${WORLD_PREFIX}${requireTemplateId(templateId)}`;
}

export function toDawnActivityDefinitionId(templateId: string): string {
  return `${ACTIVITY_PREFIX}${requireTemplateId(templateId)}`;
}

export function toDawnMapId(templateId: string): string {
  return `${MAP_ID_PREFIX}${requireTemplateId(templateId)}`;
}

export function isDawnWorldDefinitionId(definitionId: string): boolean {
  return parseDawnTemplateId(definitionId, WORLD_PREFIX) !== null;
}

export function isDawnActivityDefinitionId(definitionId: string): boolean {
  return parseDawnTemplateId(definitionId, ACTIVITY_PREFIX) !== null;
}

/** Template einer Dawn-World-ID; `null` fuer jede andere ID. */
export function getDawnTemplateIdOfWorld(definitionId: string): string | null {
  return parseDawnTemplateId(definitionId, WORLD_PREFIX);
}

/** Template einer Dawn-Activity-ID; `null` fuer jede andere ID. */
export function getDawnTemplateIdOfActivity(definitionId: string): string | null {
  return parseDawnTemplateId(definitionId, ACTIVITY_PREFIX);
}

function parseDawnTemplateId(definitionId: string, prefix: string): string | null {
  if (!definitionId.startsWith(prefix)) return null;
  const templateId = definitionId.slice(prefix.length);
  return isDawnTemplateId(templateId) ? templateId : null;
}

function requireTemplateId(templateId: string): string {
  if (!isDawnTemplateId(templateId)) throw new Error(`[DawnIds] Invalid Dawn template id: ${templateId}`);
  return templateId;
}
