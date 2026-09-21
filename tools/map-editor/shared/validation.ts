import { MAX_ROCK_FILL_RATIO, MIN_CORRIDOR_RADIUS_CELLS, normalizeCoopDefenseMapConfig, type CoopDefenseMapAuthoringConfig, type CoopDefenseMapConfig } from '../../../src/config/coopDefenseMapAuthoring';
import { collectCoopDefenseMapReferences, getCoopDefenseReferenceTargets } from '../../../src/config/coopDefenseMapReferences';
import { resolveEnemyLifecycleTotals } from '../../../src/config/coopDefenseEnemyLifecycle';
import { resolveCoopDefenseWorldMetrics } from '../../../src/world/WorldMetrics';
import { COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS, resolveCoopDefenseBasePlacement } from '../../../src/arena/BaseRegistry';
import { getCoopDefenseTutorialBackingRegion } from '../../../src/config/coopDefenseTutorial';
import { getMapTutorial } from '../../../src/i18n/contentPresentation';
import type { CoopBaseConfig } from '../../../src/config/coopDefenseMapAuthoring';
import { normalizeCoopDefenseArenaWidthCells, normalizeCoopDefenseArenaHeightCells } from '../../../src/config';
import { array, object, type JsonObject } from './json';
import { isEditableMapField } from './editPolicy';

export interface Issue { severity: 'error' | 'warning'; code: string; path: string; message: string }
export interface Validation { issues: Issue[]; normalized?: CoopDefenseMapConfig }

export function validateDocument(draft: JsonObject): Validation {
  const issues: Issue[] = [];
  const error = (path: string, message: string, code = 'authoring') => issues.push({ severity: 'error', code, path, message });
  const warning = (path: string, message: string) => issues.push({ severity: 'warning', code: 'overlap', path, message });
  if (!Array.isArray(draft.bases) || !Array.isArray(draft.powerUps) || typeof draft.mapId !== 'string') {
    error('/', 'Map benötigt mapId sowie bases- und powerUps-Listen.', 'structure'); return { issues };
  }
  const metrics = resolveCoopDefenseWorldMetrics(draft.arenaWidthCells as number | undefined, draft.arenaHeightCells as number | undefined);
  for (const [field, normalize] of [['arenaWidthCells', normalizeCoopDefenseArenaWidthCells], ['arenaHeightCells', normalizeCoopDefenseArenaHeightCells]] as const) {
    if (draft[field] !== undefined && normalize(draft[field] as number) !== draft[field]) error(`/${field}`, 'Map-Maß liegt außerhalb der zulässigen ganzzahligen Grenzen.');
  }
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => visit(v, `${path}/${i}`)); return; }
    const o = object(value);
    for (const [key, v] of Object.entries(o)) {
      const p = `${path}/${key}`;
      const editable = isEditableMapField(p.split('/').slice(1));
      if (editable) {
      if (typeof v === 'number' && !Number.isFinite(v)) error(p, 'Endliche Zahl erforderlich.', 'number');
      if (['gridX', 'gridY', 'widthCells', 'heightCells', 'count', 'treeCount', 'dxCells', 'dyCells', 'edgeInsetCells'].includes(key)
        && (typeof v !== 'number' || !Number.isInteger(v))) error(p, 'Ganzzahl erforderlich.', 'integer');
      if ((key.endsWith('Ms') || ['count', 'treeCount', 'edgeInsetCells', 'corridorRadiusVarianceCells', 'corridorWanderCells', 'waypointJitterCells'].includes(key))
        && (typeof v !== 'number' || v < 0)) error(p, 'Nichtnegative Zahl erforderlich.', 'number');
      if (['widthCells', 'heightCells', 'radiusCells', 'corridorRadiusCells', 'rockDensityScale'].includes(key)
        && (typeof v !== 'number' || v <= 0)) error(p, 'Positive Zahl erforderlich.', 'number');
      }
      visit(v, p);
    }
    // World-cell coordinates; base shapes and their local mounts are offsets, not map positions.
    const local = /^\/bases\/\d+\/(shape|turrets|powerUpPedestals|spawnCenter)(\/|$)/.test(path);
    const worldPosition = isEditableMapField(`${path}/gridX`.split('/').slice(1))
      || /^\/(missionProgress\/barriers\/\d+\/cells\/\d+|mapEvents\/\d+\/area|trackPosition)$/.test(path);
    if (!local && worldPosition && typeof o.gridX === 'number' && typeof o.gridY === 'number') {
      if (o.gridX < 0 || o.gridY < 0 || o.gridX + Number(o.widthCells ?? 1) > metrics.gridCols || o.gridY + Number(o.heightCells ?? 1) > metrics.gridRows) {
        error(path, 'Geometrie liegt außerhalb der Map; sie wird nicht abgeschnitten.', 'bounds');
      }
    }
  };
  visit(draft, '');
  if (draft.rockFillRatio !== undefined && (typeof draft.rockFillRatio !== 'number' || draft.rockFillRatio < 0 || draft.rockFillRatio > MAX_ROCK_FILL_RATIO)) error('/rockFillRatio', `Felsdichte muss zwischen 0 und ${MAX_ROCK_FILL_RATIO} liegen.`);
  const rockField = object(draft.rockField);
  const corridorRadius = (value: unknown, path: string) => { if (typeof value === 'number' && value < MIN_CORRIDOR_RADIUS_CELLS) error(path, `Korridorradius muss mindestens ${MIN_CORRIDOR_RADIUS_CELLS} betragen.`); };
  corridorRadius(rockField.corridorRadiusCells, '/rockField/corridorRadiusCells');
  array(rockField.corridors).forEach((c, i) => corridorRadius(c.radiusCells, `/rockField/corridors/${i}/radiusCells`));
  array(draft.encounters).forEach((e, i) => array(e.groups).forEach((g, j) => {
    if (g.count === 0) error(`/encounters/${i}/groups/${j}/count`, 'Eine gespeicherte Gruppe muss mindestens einen Gegner enthalten.');
    const life = resolveEnemyLifecycleTotals(String(g.enemyKind));
    for (const message of life.issues) error(`/encounters/${i}/groups/${j}/enemyKind`, message, 'lifecycle');
  }));
  if (draft.boss) for (const message of resolveEnemyLifecycleTotals(String(object(draft.boss).enemyKind)).issues) error('/boss/enemyKind', message, 'lifecycle');
  try {
    const map = draft as unknown as CoopDefenseMapAuthoringConfig;
    const targets = getCoopDefenseReferenceTargets(map);
    for (const ref of collectCoopDefenseMapReferences(map)) if (!targets[ref.kind].includes(ref.id)) error(ref.path, `Unbekannte Referenz: ${ref.id}`, 'reference');
    const normalized = normalizeCoopDefenseMapConfig(structuredClone(map));
    // Report base clamping instead of silently accepting it in an authoring tool.
    array(draft.bases).forEach((base, i) => {
      const { width, height, minGridX: x, minGridY: y } = resolveCoopDefenseBasePlacement(base as unknown as CoopBaseConfig, metrics);
      if (x < 0 || y < 0 || x + width > metrics.gridCols || y + height > metrics.gridRows) error(`/bases/${i}/anchor`, 'Basis würde an der Map-Grenze begrenzt.', 'bounds');
      array(base.powerUpPedestals).forEach((pedestal, j) => {
        const offset = object(pedestal.cellOffset), px = x + Number(offset.gridX), py = y + Number(offset.gridY);
        if (px < 0 || py < 0 || px >= metrics.gridCols || py >= metrics.gridRows) error(`/bases/${i}/powerUpPedestals/${j}/cellOffset`, 'Power-Up liegt außerhalb der Map.', 'bounds');
      });
    });
    const tutorials = [
      ...(getMapTutorial(map.mapId, 'de') ? [{ anchor: map.tutorialAnchor, controls: map.tutorialShowControls === true, path: '/tutorialAnchor' }] : []),
      ...(map.tutorialSteps ?? []).map((step, i) => ({ anchor: step.anchor, controls: false, path: `/tutorialSteps/${i}/anchor` })),
    ];
    for (const tutorial of tutorials) {
      const region = getCoopDefenseTutorialBackingRegion(tutorial.controls, tutorial.anchor, metrics);
      const clearance = COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS;
      for (const base of map.bases) {
        const p = resolveCoopDefenseBasePlacement(base, metrics);
        if (region.maxGridX >= p.minGridX - clearance && region.minGridX <= p.minGridX + p.width - 1 + clearance
          && region.maxGridY >= p.minGridY - clearance && region.minGridY <= p.minGridY + p.height - 1 + clearance) {
          warning(tutorial.path, `Tutorial-Felsfläche überlappt den Freiraum der Basis ${base.id}; Generator spart Basisgeometrie aus.`);
        }
      }
    }
    return { issues, normalized: issues.some(i => i.severity === 'error') ? undefined : normalized };
  } catch (cause) { error('/', cause instanceof Error ? cause.message : String(cause)); return { issues }; }
}
