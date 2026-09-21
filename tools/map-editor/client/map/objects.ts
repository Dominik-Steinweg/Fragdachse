import { MAX_PERSISTENT_BASE_RADIUS_CELLS, PERSISTENT_BASE_CLEARANCE_CELLS } from '../../../../src/config/persistentBase';
import { CELL_SIZE } from '../../../../src/config';
import { resolveCoopDefenseWorldMetrics } from '../../../../src/world/WorldMetrics';
import { resolveCoopDefenseBasePlacement } from '../../../../src/arena/BaseRegistry';
import { buildPersistentBaseCoreBaseConfig } from '../../../../src/persistentBase/PersistentBaseCore';
import { DEFAULT_PERSISTENT_BASE_ORIENTATION, type PersistentBaseOrientation } from '../../../../src/persistentBase/PersistentBaseCore';
import { COOP_DEFENSE_TUTORIAL_PANEL_WIDTH, COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS, getCoopDefenseTutorialPanelHeight, getCoopDefenseTutorialPanelCenterX, getCoopDefenseTutorialPanelTopY, getCoopDefenseTutorialBackingRegion } from '../../../../src/config/coopDefenseTutorial';
import { getMapTutorial } from '../../../../src/i18n/contentPresentation';
import type { CoopBaseConfig } from '../../../../src/config/coopDefenseMapAuthoring';
import { at, array, object, set, type JsonObject, type Path } from '../../shared/json';
import type { MapDocumentSession } from '../document/MapDocumentSession';

export const LAYERS: Record<string, { label: string; color: string }> = {
  terrain: { label: 'Felsen / Boden', color: '#79838a' }, water: { label: 'Wasser', color: '#3eaddb' }, trees: { label: 'Bäume', color: '#5c9b63' },
  tracks: { label: 'Gleise', color: '#a8a19a' }, structures: { label: 'Basen / Podeste', color: '#edba73' },
  mission: { label: 'Mission / Checkpoints', color: '#ce91e8' }, corridors: { label: 'Korridore', color: '#c4d897' },
  walls: { label: 'Felswände', color: '#e89973' }, tutorial: { label: 'Tutorial-Flächen', color: '#edcd66' }, spawns: { label: 'Spawngebiete', color: '#f3768f' },
};
export interface MapObject {
  id: string; label: string; path: Path; layer: string;
  kind: 'rect' | 'point' | 'corridor' | 'tutorial' | 'base';
  x: number; y: number; w: number; h: number;
  points?: { x: number; y: number }[]; radius?: number;
  readonly?: boolean; cells?: { gridX: number; gridY: number }[];
  reservationRadius?: number; anchorX?: number; anchorY?: number; backing?: { x: number; y: number; w: number; h: number }; halo?: number;
}
export function mapMetrics(draft: JsonObject) { return resolveCoopDefenseWorldMetrics(draft.arenaWidthCells as number | undefined, draft.arenaHeightCells as number | undefined); }

export function mapObjects(session: MapDocumentSession, draft = session.draft): MapObject[] {
  const items: MapObject[] = [], metrics = mapMetrics(draft);
  const rect = (id: string, label: string, path: Path, layer: string, readonly = false) => {
    const r = object(at(draft, path)); items.push({ id, label, path, layer, kind: 'rect', x: Number(r.gridX ?? 0), y: Number(r.gridY ?? 0), w: Number(r.widthCells ?? 1), h: Number(r.heightCells ?? 1), readonly });
  };
  const point = (id: string, label: string, path: Path, radius: number) => {
    const p = object(at(draft, path)); items.push({ id, label, path, layer: 'mission', kind: 'point', x: Number(p.gridX), y: Number(p.gridY), w: 1, h: 1, radius: Number(p.radiusCells ?? radius) });
  };
  array(draft.waterAreas).forEach((r, i) => rect(`water:${session.key(['waterAreas'], i)}`, `Wasserfläche ${i + 1}`, ['waterAreas', i], 'water'));
  array(draft.rockWalls).forEach((r, i) => rect(`wall:${r.id}`, `Felswand · ${r.id}`, ['rockWalls', i], 'walls'));
  array(object(draft.rockField).corridors).forEach((c, i) => {
    const points = array(c.points).map(p => ({ x: Number(p.gridX), y: Number(p.gridY) }));
    items.push({ id: `corridor:${c.id}`, label: `Korridor · ${c.id}`, path: ['rockField', 'corridors', i], layer: 'corridors', kind: 'corridor', x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, w: 1, h: 1, points, radius: Number(c.radiusCells ?? object(draft.rockField).corridorRadiusCells) * Number(object(draft.rockField).rockDensityScale ?? 1) });
  });
  const tutorial = (id: string, label: string, path: Path, controls: boolean) => {
    const raw = at(draft, path); const anchor = raw === undefined ? undefined : object(raw) as unknown as { gridX: number; gridY: number };
    const region = getCoopDefenseTutorialBackingRegion(controls, anchor, metrics);
    const x = (getCoopDefenseTutorialPanelCenterX(anchor, metrics) - metrics.offsetX) / CELL_SIZE;
    const y = (getCoopDefenseTutorialPanelTopY(anchor, metrics) - metrics.offsetY) / CELL_SIZE;
    const w = COOP_DEFENSE_TUTORIAL_PANEL_WIDTH / CELL_SIZE, h = getCoopDefenseTutorialPanelHeight(controls) / CELL_SIZE;
    items.push({ id, label, path, layer: 'tutorial', kind: 'tutorial', x: x - w / 2, y, w, h, anchorX: x - 0.5, anchorY: y,
      backing: { x: region.minGridX, y: region.minGridY, w: region.maxGridX - region.minGridX + 1, h: region.maxGridY - region.minGridY + 1 }, halo: COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS });
  };
  if (getMapTutorial(String(draft.mapId), 'de')) tutorial('tutorial:main', 'Haupt-Tutorial', ['tutorialAnchor'], draft.tutorialShowControls === true);
  array(draft.tutorialSteps).forEach((s, i) => tutorial(`tutorial:${s.id}`, `Tutorial · ${s.id}`, ['tutorialSteps', i, 'anchor'], false));
  const mission = object(draft.missionProgress);
  if (mission.startArea) point('mission:start', 'Startbereich', ['missionProgress', 'startArea'], 4);
  array(mission.checkpoints).forEach((c, i) => point(`checkpoint:${c.id}`, `Checkpoint · ${c.id}`, ['missionProgress', 'checkpoints', i], 1));
  array(mission.barriers).forEach((b, i) => {
    const cells = array(b.cells) as unknown as { gridX: number; gridY: number }[];
    const x = Math.min(...cells.map(c => c.gridX)), y = Math.min(...cells.map(c => c.gridY));
    items.push({ id: `barrier:${b.id}`, label: `Missionsbarriere · ${b.id} (schreibgeschützt)`, path: ['missionProgress', 'barriers', i], layer: 'mission', kind: 'rect', x, y, w: Math.max(...cells.map(c => c.gridX)) - x + 1, h: Math.max(...cells.map(c => c.gridY)) - y + 1, cells, readonly: true });
  });
  array(draft.bases).forEach((b, i) => {
    try {
      const p = resolveCoopDefenseBasePlacement(b as unknown as CoopBaseConfig, metrics);
      items.push({ id: `base:${b.id}`, label: `Basis · ${b.id}`, path: ['bases', i, 'anchor'], layer: 'structures', kind: 'base', x: p.minGridX, y: p.minGridY, w: p.width, h: p.height, cells: p.cells.map(c => ({ gridX: p.minGridX + c.gridX, gridY: p.minGridY + c.gridY })) });
    } catch { /* The validation panel retains malformed base diagnostics. */ }
  });
  if (draft.persistentBase) {
    const site = object(draft.persistentBase), anchor = object(site.anchor);
    const config = buildPersistentBaseCoreBaseConfig({ baseId: String(site.baseId), anchor: { gridX: Number(anchor.gridX), gridY: Number(anchor.gridY) }, orientation: (site.orientation ?? DEFAULT_PERSISTENT_BASE_ORIENTATION) as PersistentBaseOrientation });
    const p = resolveCoopDefenseBasePlacement(config, metrics);
    items.push({ id: 'persistent-base', label: 'Persistenter Basiskern', reservationRadius: MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS, path: ['persistentBase', 'anchor'], layer: 'structures', kind: 'base', x: p.minGridX, y: p.minGridY, w: p.width, h: p.height, anchorX: Number(anchor.gridX), anchorY: Number(anchor.gridY), cells: p.cells.map(c => ({ gridX: p.minGridX + c.gridX, gridY: p.minGridY + c.gridY })) });
  }
  array(draft.secondaryObjectives).forEach((s, i) => {
    if (s.carry) for (const key of ['spawnZone', 'deliveryZone']) rect(`carry:${s.id}:${key}`, `${s.id} · ${key === 'spawnZone' ? 'Flaschen-Start' : 'Abgabezone'}`, ['secondaryObjectives', i, 'carry', key], 'mission');
  });
  array(draft.encounters).forEach((e, i) => array(e.groups).forEach((g, j) => {
    if (g.spawnArea) rect(`spawn:${e.id}:${session.key(['encounters', i, 'groups'], j)}`, `${e.id} · ${g.enemyKind} · Gruppe ${j + 1}`, ['encounters', i, 'groups', j, 'spawnArea'], 'spawns');
  }));
  array(draft.mapEvents).forEach((e, i) => { if (object(e.area).widthCells !== undefined) rect(`event:${e.id}`, `Ereignis · ${e.id} (schreibgeschützt)`, ['mapEvents', i, 'area'], 'mission', true); });
  const preview = object(draft.persistentBasePreview);
  if (preview.checkpointId) {
    const index = array(mission.checkpoints).findIndex(c => c.id === preview.checkpointId);
    if (index >= 0) {
      const c = array(mission.checkpoints)[index];
      items.push({ id: 'persistent-preview', label: 'Basisvorschau → zugehöriger Checkpoint', path: ['missionProgress', 'checkpoints', index], layer: 'structures', kind: 'point', x: Number(c.gridX), y: Number(c.gridY), w: 1, h: 1, radius: 3 });
    }
  }
  return items;
}

export function moveMapObject(draft: JsonObject, item: MapObject, dx: number, dy: number, vertex = -1): void {
  if (item.readonly) return;
  const value = object(at(draft, item.path));
  if (item.kind === 'corridor') {
    const points = array(value.points);
    points.forEach((p, i) => { if (vertex < 0 || vertex === i) { p.gridX = Math.round(Number(p.gridX) + dx); p.gridY = Math.round(Number(p.gridY) + dy); } }); return;
  }
  if (item.kind === 'base' && item.path[0] === 'bases') {
    if (value.kind === 'center-offset') { value.dxCells = Math.round(Number(value.dxCells) + dx); value.dyCells = Math.round(Number(value.dyCells) + dy); }
    else if (value.kind === 'left-center' || value.kind === 'right-center') value.edgeInsetCells = Math.round(Number(value.edgeInsetCells) + (value.kind === 'right-center' ? -dx : dx));
    else { value.gridX = Math.round(Number(value.gridX) + dx); value.gridY = Math.round(Number(value.gridY) + dy); }
  } else {
    value.gridX = Math.round(Number(value.gridX ?? item.anchorX ?? item.x) + dx);
    value.gridY = Math.round(Number(value.gridY ?? item.anchorY ?? item.y) + dy);
  }
  set(draft, item.path, value);
}
