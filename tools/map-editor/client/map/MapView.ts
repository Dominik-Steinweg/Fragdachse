import { DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS, DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS, DEFAULT_TREE_COUNT, ROCK_FILL_RATIO, MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS, MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS } from '../../../../src/config';
import { collectCoopDefenseMapReferences } from '../../../../src/config/coopDefenseMapReferences';
import { MAX_ROCK_FILL_RATIO, MIN_CORRIDOR_RADIUS_CELLS, type CoopDefenseMapAuthoringConfig } from '../../../../src/config/coopDefenseMapAuthoring';
import { array, at, clone, object, set, uniqueId, type JsonObject, type Path } from '../../shared/json';
import { button, confirmEdit, element, heading, numberField, propertySelect, type EditorEnvironment } from '../ui';
import { LAYERS, mapObjects, type MapObject } from './objects';
import { MapCanvas, type DrawTool, type Rect } from './MapCanvas';

export class MapView {
  readonly canvas: MapCanvas;
  readonly root = element('div', 'map-workspace');
  private readonly list = element('aside', 'object-panel');
  private readonly properties = element('aside', 'property-panel');
  private readonly middle = element('section', 'map-center');
  private readonly toolbar = element('div', 'map-tools');
  constructor(private readonly env: EditorEnvironment) {
    this.canvas = new MapCanvas(env, () => this.renderSidebars(), (tool, rect, end, start) => this.draw(tool, rect, end, start));
    this.middle.append(this.toolbar, this.canvas.container, element('div', 'canvas-hint', 'Ziehen: verschieben · Griffe: skalieren / Wegpunkte · Mausrad: Zoom · Rechts/Mitte: verschieben · Escape: abbrechen'));
    this.root.append(this.list, this.middle, this.properties); this.render();
  }
  destroy(): void { this.canvas.destroy(); }
  render(): HTMLElement { this.renderTools(); this.renderSidebars(); this.canvas.paint(); return this.root; }
  open(path: Path): void {
    const item = mapObjects(this.env.session).find(i => JSON.stringify(i.path) === JSON.stringify(path));
    if (!item) return;
    this.env.session.selection = item.id; this.canvas.layers.add(item.layer); this.canvas.tool = 'select'; this.canvas.focus(item); this.render();
  }
  private renderTools(): void {
    this.toolbar.replaceChildren();
    const tools: [DrawTool, string][] = [['select', 'Auswählen'], ['pan', 'Verschieben'], ['waterArea', '+ Wasserfläche'], ['rockWall', '+ Felswand'], ['corridor', '+ Korridor'], ['waterPaint', 'Wasserzellen +'], ['waterErase', 'Wasserzellen −']];
    for (const [tool, text] of tools) this.toolbar.append(button(text, () => { this.canvas.tool = tool; this.renderTools(); }, this.canvas.tool === tool ? 'active' : ''));
    this.toolbar.append(button('Einpassen', () => this.canvas.fit()), button(this.canvas.snap ? 'Raster: an' : 'Raster: aus', () => { this.canvas.snap = !this.canvas.snap; this.renderTools(); this.canvas.paint(); }));
  }
  private renderSidebars(): void {
    const listScroll = this.list.scrollTop, propertyScroll = this.properties.scrollTop;
    const { env } = this, items = mapObjects(env.session);
    this.list.replaceChildren(heading('Vorgaben', 'Bearbeitbare Quellen über dem generierten Layout'));
    this.list.append(button('Map & Gelände', () => { env.session.selection = null; this.renderSidebars(); this.canvas.paint(); }, !env.session.selection ? 'object active' : 'object'));
    const layers = element('details', 'layer-list'); layers.open = true; layers.append(element('summary', '', 'Sichtbare Ebenen'));
    for (const [key, layer] of Object.entries(LAYERS)) {
      const label = element('label', 'check-label'), check = element('input'); check.type = 'checkbox'; check.checked = this.canvas.layers.has(key);
      check.onchange = () => { check.checked ? this.canvas.layers.add(key) : this.canvas.layers.delete(key); this.canvas.paint(); };
      label.append(check, document.createTextNode(layer.label)); layers.append(label);
    }
    this.list.append(layers);
    for (const [key, layer] of Object.entries(LAYERS)) {
      const group = items.filter(i => i.layer === key); if (!group.length) continue;
      const section = element('details', 'object-group'); section.open = true; section.append(element('summary', '', `${layer.label} · ${group.length}`));
      for (const item of group) section.append(button(item.label, () => { env.session.selection = item.id; this.canvas.layers.add(item.layer); this.canvas.focus(item); this.renderSidebars(); }, `object ${item.id === env.session.selection ? 'active' : ''}`));
      this.list.append(section);
    }
    const selected = items.find(i => i.id === env.session.selection);
    this.properties.replaceChildren();
    if (selected) this.properties.append(this.objectProperties(selected)); else this.properties.append(this.terrainProperties());
    this.list.scrollTop = listScroll; this.properties.scrollTop = propertyScroll;
  }
  private terrainProperties(): HTMLElement {
    const { env } = this, draft = env.session.draft, box = element('div'); box.append(heading('Map & Gelände', 'Defaults werden erst durch eine Änderung explizit gespeichert.'));
    box.append(numberField(env, 'Breite (Zellen)', ['arenaWidthCells'], { fallback: DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS, min: DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS, max: MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS, optional: true }),
      numberField(env, 'Höhe (Zellen)', ['arenaHeightCells'], { fallback: DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS, min: DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS, max: MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS, optional: true }));
    const field = object(draft.rockField), solid = draft.rockField !== undefined && (field.fillMode ?? 'solid') === 'solid';
    box.append(numberField(env, 'Felsdichte (Noise)', ['rockFillRatio'], { fallback: ROCK_FILL_RATIO, min: 0, max: MAX_ROCK_FILL_RATIO, step: .01, optional: true, disabled: solid }),
      numberField(env, 'Baumanzahl', ['treeCount'], { fallback: DEFAULT_TREE_COUNT, min: 0, optional: true, disabled: solid }));
    if (solid) box.append(element('p', 'muted', 'Solid-Felsfelder ignorieren Noise-Dichte und platzieren keine Bäume. Die Dichteskalierung steuert die Gangbreite.'));
    if (draft.rockField) {
      box.append(heading('Felsfeld'), propertySelect(env, 'Füllmodus', ['rockField', 'fillMode'], 'solid', ['solid', 'organic']));
      const fields: [string, string, number | undefined, number][] = [['corridorRadiusCells', 'Korridorradius', undefined, MIN_CORRIDOR_RADIUS_CELLS], ['corridorRadiusVarianceCells', 'Radiusvarianz', undefined, 0], ['corridorWanderCells', 'Seitliche Wanderung', undefined, 0], ['waypointJitterCells', 'Wegpunktstreuung', undefined, 0], ['rockDensityScale', 'Dichteskalierung', 1, .01]];
      for (const [key, label, fallback, min] of fields) box.append(numberField(env, label, ['rockField', key], { min, step: .01, fallback, optional: fallback !== undefined }));
      box.append(button('Felsfeld einschließlich Korridoren entfernen', async () => { if (await confirmEdit('Felsfeld und seine Korridore aus dem Entwurf entfernen?')) { env.session.change(['rockField'], undefined); env.changed(); } }, 'danger'));
    } else box.append(element('p', 'muted', 'Ein erster Korridor legt ein organisches Felsfeld an: Radius 3, Varianz 0,6, Wanderung 1 und Wegpunktstreuung 1. Die Werte sind anschließend bearbeitbar.'));
    return box;
  }
  private objectProperties(item: MapObject): HTMLElement {
    const { env } = this, box = element('div'), value = object(at(env.session.draft, item.path));
    box.append(heading(item.label, '/' + item.path.join('/')));
    if (item.readonly) { box.append(element('p', 'muted', 'Diese Missionsvorgabe wird in V1 angezeigt und geprüft; ihre Funktion bleibt unverändert.')); return box; }
    if (item.kind === 'corridor') {
      box.append(numberField(env, 'Radius (Zellen)', [...item.path, 'radiusCells'], { min: MIN_CORRIDOR_RADIUS_CELLS, step: .01, fallback: Number(object(env.session.draft.rockField).corridorRadiusCells), optional: true }));
      array(value.points).forEach((point, i) => {
        const row = element('div', 'waypoint'); row.append(element('strong', '', `Wegpunkt ${i + 1}`), numberField(env, 'X', [...item.path, 'points', i, 'gridX']), numberField(env, 'Y', [...item.path, 'points', i, 'gridY']),
          button('Entfernen', () => { env.session.splice([...item.path, 'points'], i, 1); env.changed(); }, 'text-button', array(value.points).length <= 2),
          button('Danach einfügen', () => { const next = array(value.points)[i + 1]; env.session.splice([...item.path, 'points'], i + 1, 0, [{ gridX: next ? Math.round((Number(point.gridX) + Number(next.gridX)) / 2) : Number(point.gridX) + 3, gridY: next ? Math.round((Number(point.gridY) + Number(next.gridY)) / 2) : Number(point.gridY) }]); env.changed(); })); box.append(row);
      });
    } else if (item.kind === 'base' && item.path[0] === 'bases') {
      box.append(element('p', 'muted', `Ankerform: ${value.kind}. Form und lokale Anbauten bewegen sich mit der Basis.`));
      const keys = value.kind === 'center-offset' ? ['dxCells', 'dyCells'] : value.kind === 'left-center' || value.kind === 'right-center' ? ['edgeInsetCells'] : ['gridX', 'gridY'];
      for (const key of keys) box.append(numberField(env, key, [...item.path, key]));
      if (value.kind !== 'grid') box.append(button('In frei platzierbaren Rasteranker umwandeln', () => {
        env.session.transact('In Rasteranker umwandeln', draft => {
          set(draft, item.path, { ...value, kind: 'grid', gridX: item.x, gridY: item.y });
          for (const key of ['dxCells', 'dyCells', 'edgeInsetCells']) set(draft, [...item.path, key], undefined);
        }); env.changed();
      }));
    } else {
      box.append(numberField(env, item.kind === 'tutorial' ? 'Mittelspalte X' : 'X (Zelle)', [...item.path, 'gridX'], { fallback: item.anchorX ?? item.x }),
        numberField(env, item.kind === 'tutorial' ? 'Obere Zeile Y' : 'Y (Zelle)', [...item.path, 'gridY'], { fallback: item.anchorY ?? item.y }));
      if (item.kind === 'rect') box.append(numberField(env, 'Breite', [...item.path, 'widthCells'], { min: 1 }), numberField(env, 'Höhe', [...item.path, 'heightCells'], { min: 1 }),
        button('Gebiet neu aufziehen', () => { this.canvas.tool = 'selected'; this.env.message('Das neue Rechteck auf der Karte aufziehen.'); }));
      if (item.kind === 'point') box.append(numberField(env, 'Radius', [...item.path, 'radiusCells'], { fallback: item.path.includes('startArea') ? 4 : 1, min: .1, step: .1, optional: true }));
      if (item.kind === 'tutorial') {
        box.append(element('p', 'muted', 'Durchgezogener Rahmen: Hinweisfenster · Fläche: Felsbereich · gestrichelt: Randbereich. Größe folgt dem tatsächlichen Tutorial-Fenster.'));
        if (at(env.session.draft, item.path) !== undefined) box.append(button('Standardanker wiederherstellen', () => { env.session.change(item.path, undefined); env.changed(); }));
      }
    }
    if (['waterAreas', 'rockWalls', 'rockField'].includes(String(item.path[0]))) {
      box.append(button('Duplizieren', () => this.duplicate(item)), button('Löschen', () => this.remove(item), 'danger'));
    }
    return box;
  }
  private draw(tool: DrawTool, rect: Rect, end: { x: number; y: number }, start: { x: number; y: number }): void {
    const { env } = this;
    if (tool === 'selected') {
      const item = mapObjects(env.session).find(i => i.id === env.session.selection);
      if (item?.kind === 'rect' && !item.readonly) env.session.change(item.path, { ...object(at(env.session.draft, item.path)), ...rect });
    } else if (tool === 'waterArea') env.session.splice(['waterAreas'], array(env.session.draft.waterAreas).length, 0, [{ ...rect }]);
    else if (tool === 'rockWall') {
      const list = array(env.session.draft.rockWalls); env.session.splice(['rockWalls'], list.length, 0, [{ id: uniqueId(list, 'wall'), ...rect }]);
    } else if (tool === 'corridor') {
      const list = array(object(env.session.draft.rockField).corridors);
      const c = { id: uniqueId(list, 'corridor'), points: [{ gridX: start.x, gridY: start.y }, { gridX: end.x, gridY: end.y }] };
      env.session.transact('Korridor anlegen', draft => {
        draft.rockField ??= { fillMode: 'organic', corridorRadiusCells: 3, corridorRadiusVarianceCells: .6, corridorWanderCells: 1, waypointJitterCells: 1, corridors: [] };
        array(object(draft.rockField).corridors).push(c);
      });
    }
    this.canvas.tool = 'select'; env.changed();
  }
  private duplicate(item: MapObject): void {
    const { env } = this, parent = item.path.slice(0, -1), index = Number(item.path.at(-1)), list = array(at(env.session.draft, parent));
    const copy = clone(list[index]); if (copy.id) copy.id = uniqueId(list, String(copy.id));
    env.session.splice(parent, index + 1, 0, [copy]); env.changed();
  }
  private remove(item: MapObject): void {
    const { env } = this;
    if (item.path[0] === 'rockWalls') {
      const id = String(object(at(env.session.draft, item.path)).id);
      const refs = collectCoopDefenseMapReferences(env.session.draft as unknown as CoopDefenseMapAuthoringConfig).filter(r => r.kind === 'wall' && r.id === id);
      if (refs.length) return env.message(`Felswand wird referenziert:\n${refs.map(r => r.path).join('\n')}`);
    }
    env.session.splice(item.path.slice(0, -1), Number(item.path.at(-1)), 1); env.session.selection = null; env.changed();
  }
}
