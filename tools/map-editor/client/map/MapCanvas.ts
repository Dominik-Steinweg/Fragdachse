import { at, clone, set, type JsonObject } from '../../shared/json';
import { commitFocused, element, type EditorEnvironment } from '../ui';
import type { PreviewResult } from '../preview/generate';
import { LAYERS, mapMetrics, mapObjects, moveMapObject, type MapObject } from './objects';
import { getSpawnFrontInwardVector } from '../../../../src/utils/spawnFront';
import { FRONT_LABELS } from '../../shared/spawns';

export type DrawTool = 'select' | 'pan' | 'waterArea' | 'rockWall' | 'corridor' | 'waterPaint' | 'waterErase' | 'selected';
export interface Rect { gridX: number; gridY: number; widthCells: number; heightCells: number }
interface Drag { start: { x: number; y: number }; screen: { x: number; y: number }; version: number; mode: DrawTool;
  item?: MapObject; vertex: number; corner: number; before: JsonObject; temporary: JsonObject; moved: boolean; panX: number; panY: number }

export class MapCanvas {
  readonly canvas = element('canvas', 'map-canvas');
  readonly container = element('div', 'canvas-container');
  readonly layers = new Set(Object.keys(LAYERS));
  tool: DrawTool = 'select';
  snap = true;
  scale = 8;
  panX = 30; panY = 30;
  private initialized = false;
  private drag: Drag | null = null;
  private raster = new Map<string, HTMLCanvasElement>();
  private preview: PreviewResult | null = null;
  get previewResult(): PreviewResult | null { return this.preview; }
  private observer: ResizeObserver;
  constructor(private readonly env: EditorEnvironment, private readonly selected: () => void,
    private readonly draw: (tool: DrawTool, rect: Rect, end: { x: number; y: number }, start: { x: number; y: number }) => void) {
    this.container.append(this.canvas);
    this.canvas.tabIndex = 0;
    this.observer = new ResizeObserver(() => { if (!this.initialized && this.canvas.clientWidth > 0) { this.fit(); this.initialized = true; } this.paint(); });
    this.observer.observe(this.container);
    this.canvas.oncontextmenu = e => e.preventDefault();
    this.canvas.onpointerdown = e => this.down(e);
    this.canvas.onpointermove = e => this.move(e);
    this.canvas.onpointerup = e => this.up(e);
    this.canvas.onpointercancel = () => { this.drag = null; this.paint(); };
    this.canvas.onkeydown = e => { if (e.key === 'Escape') { this.drag = null; this.tool = 'select'; this.env.changed(); } };
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault(); const p = this.screen(e), world = this.world(p);
      this.scale = Math.max(0.4, Math.min(65, this.scale * Math.exp(-e.deltaY * 0.001)));
      this.panX = p.x - world.x * this.scale; this.panY = p.y - world.y * this.scale; this.paint();
    }, { passive: false });
  }
  destroy(): void { this.observer.disconnect(); this.drag = null; }
  fit(): void {
    const m = mapMetrics(this.env.session.draft);
    this.scale = Math.max(0.4, Math.min((this.canvas.clientWidth - 60) / m.gridCols, (this.canvas.clientHeight - 60) / m.gridRows));
    this.panX = (this.canvas.clientWidth - m.gridCols * this.scale) / 2; this.panY = (this.canvas.clientHeight - m.gridRows * this.scale) / 2; this.paint();
  }
  focus(item: MapObject): void {
    if (item.hidden) return;
    this.panX = this.canvas.clientWidth / 2 - (item.x + item.w / 2) * this.scale;
    this.panY = this.canvas.clientHeight / 2 - (item.y + item.h / 2) * this.scale; this.paint();
  }
  setPreview(result: PreviewResult): void {
    this.preview = result; this.raster.clear();
    const make = (key: string, cells: readonly { gridX: number; gridY: number }[], color: string, width = 1) => {
      const canvas = document.createElement('canvas'); canvas.width = result.metrics.gridCols; canvas.height = result.metrics.gridRows;
      const context = canvas.getContext('2d')!; context.fillStyle = color;
      for (const cell of cells) context.fillRect(cell.gridX, cell.gridY, width, 1);
      this.raster.set(key, canvas);
    };
    make('terrain', result.layout.rocks, '#657176'); make('water', result.layout.water ?? [], '#245f7c');
    make('trees', result.layout.trees, '#60946a'); make('tracks', result.layout.tracks, '#a19a7f', 2);
    make('powerups', result.layout.powerUpPedestals, '#94e2b5');
    make('mission', result.layout.groundHazardZones?.flatMap(z => z.cells) ?? [], '#985b7e');
    this.paint(); this.selected();
  }
  paint(): void {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) { this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio); }
    const c = this.canvas.getContext('2d')!; c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, width, height);
    c.fillStyle = '#111a1c'; c.fillRect(0, 0, width, height); c.translate(this.panX, this.panY); c.scale(this.scale, this.scale); c.imageSmoothingEnabled = false;
    const draft = this.drag?.temporary ?? this.env.session.draft, m = mapMetrics(draft);
    c.fillStyle = '#243132'; c.fillRect(0, 0, m.gridCols, m.gridRows);
    for (const [key, canvas] of this.raster) if (this.layers.has(key)) c.drawImage(canvas, 0, 0);
    c.strokeStyle = '#647170'; c.lineWidth = 1 / this.scale; c.strokeRect(0, 0, m.gridCols, m.gridRows);
    if (this.scale >= 8 && this.snap) {
      c.strokeStyle = '#ffffff0b'; c.beginPath();
      const minX = Math.max(0, Math.floor(-this.panX / this.scale)), maxX = Math.min(m.gridCols, Math.ceil((width - this.panX) / this.scale));
      const minY = Math.max(0, Math.floor(-this.panY / this.scale)), maxY = Math.min(m.gridRows, Math.ceil((height - this.panY) / this.scale));
      for (let x = minX; x <= maxX; x++) { c.moveTo(x, minY); c.lineTo(x, maxY); }
      for (let y = minY; y <= maxY; y++) { c.moveTo(minX, y); c.lineTo(maxX, y); } c.stroke();
    }
    // Authored single cells remain visible before regeneration.
    if (this.layers.has('water')) { c.fillStyle = '#48b7e6aa'; for (const cell of (draft.water ?? []) as { gridX: number; gridY: number }[]) c.fillRect(cell.gridX, cell.gridY, 1, 1); }
    for (const item of mapObjects(this.env.session, draft, this.preview)) if (!item.hidden && this.layers.has(item.layer)) this.paintObject(c, item, item.id === this.env.session.selection);
    const drag = this.drag;
    if (drag && ['waterArea', 'rockWall', 'selected', 'corridor'].includes(drag.mode)) {
      const end = this.lastWorld; c.strokeStyle = '#f5d08b'; c.lineWidth = 2 / this.scale; c.setLineDash([5 / this.scale, 3 / this.scale]);
      if (drag.mode === 'corridor') { c.beginPath(); c.moveTo(drag.start.x, drag.start.y); c.lineTo(end.x, end.y); c.stroke(); }
      else { const r = this.bounds(drag.start, end); c.strokeRect(r.gridX, r.gridY, r.widthCells, r.heightCells); } c.setLineDash([]);
    }
  }
  private paintObject(c: CanvasRenderingContext2D, item: MapObject, selected: boolean): void {
    if (item.kind === 'front') { this.paintFront(c, item, selected); return; }
    const color = LAYERS[item.layer].color; c.strokeStyle = selected ? '#fff3cc' : color; c.fillStyle = color + '20'; c.lineWidth = (selected ? 2 : 1) / this.scale;
    if (item.readonly) c.setLineDash([4 / this.scale, 3 / this.scale]);
    if (item.reservationRadius !== undefined) {
      c.save(); c.setLineDash([5 / this.scale, 4 / this.scale]); c.beginPath();
      c.arc((item.anchorX ?? item.x) + .5, (item.anchorY ?? item.y) + .5, item.reservationRadius, 0, Math.PI * 2); c.stroke(); c.restore();
    }
    if (item.kind === 'corridor') {
      c.beginPath(); item.points?.forEach((p, i) => { i ? c.lineTo(p.x + 0.5, p.y + 0.5) : c.moveTo(p.x + 0.5, p.y + 0.5); });
      c.save(); c.lineWidth = (item.radius ?? 1) * 2; c.strokeStyle = color + '15'; c.stroke(); c.restore(); c.stroke();
    } else if (item.kind === 'point') {
      c.beginPath(); c.arc(item.x + 0.5, item.y + 0.5, item.radius ?? 1, 0, Math.PI * 2); c.fill(); c.stroke();
    } else {
      if (item.backing) { const r = item.backing, halo = item.halo ?? 0; c.save(); c.setLineDash([3 / this.scale, 4 / this.scale]); c.strokeRect(r.x - halo, r.y - halo, r.w + halo * 2, r.h + halo * 2); c.fillStyle = color + '35'; c.fillRect(r.x, r.y, r.w, r.h); c.restore(); }
      if (item.cells) { c.fillStyle = color + '70'; for (const cell of item.cells) c.fillRect(cell.gridX, cell.gridY, 1, 1); }
      else c.fillRect(item.x, item.y, item.w, item.h);
      c.strokeRect(item.x, item.y, item.w, item.h);
    }
    c.setLineDash([]);
    if (selected && !item.readonly) {
      c.fillStyle = '#fff3cc'; const size = 6 / this.scale;
      const points = item.kind === 'corridor' ? item.points?.map(p => ({ x: p.x + 0.5, y: p.y + 0.5 })) ?? []
        : item.kind === 'rect' ? this.corners(item) : [{ x: item.anchorX ?? item.x + item.w / 2, y: item.anchorY ?? item.y + item.h / 2 }];
      for (const point of points) c.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    }
    if (selected || this.scale > 14) { c.font = `${11 / this.scale}px system-ui`; c.fillStyle = '#eee7d7'; c.fillText(item.label, item.x, item.y - 5 / this.scale); }
  }
  private lastWorld = { x: 0, y: 0 };
  private paintFront(c: CanvasRenderingContext2D, item: MapObject, selected: boolean): void {
    if (!item.front) return;
    const inward = getSpawnFrontInwardVector(item.front), vertical = inward.x !== 0;
    const x = item.x + item.w / 2, y = item.y + item.h / 2;
    const color = selected ? '#fff3cc' : LAYERS.fronts.color;
    c.save(); c.setLineDash([]); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 3 / this.scale;
    c.beginPath();
    if (vertical) { c.moveTo(x, item.y); c.lineTo(x, item.y + item.h); }
    else { c.moveTo(item.x, y); c.lineTo(item.x + item.w, y); }
    c.stroke();
    const length = 18 / this.scale, wing = 5 / this.scale;
    for (const fraction of [.25, .5, .75]) {
      const sx = vertical ? x : item.x + item.w * fraction, sy = vertical ? item.y + item.h * fraction : y;
      const tx = sx + inward.x * length, ty = sy + inward.y * length;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(tx, ty);
      c.moveTo(tx - inward.x * wing - inward.y * wing, ty - inward.y * wing + inward.x * wing);
      c.lineTo(tx, ty); c.lineTo(tx - inward.x * wing + inward.y * wing, ty - inward.y * wing - inward.x * wing); c.stroke();
    }
    const tx = x + inward.x * 25 / this.scale, ty = y + inward.y * 25 / this.scale;
    c.font = `600 ${12 / this.scale}px system-ui`; c.textBaseline = 'middle';
    c.textAlign = inward.x > 0 ? 'left' : inward.x < 0 ? 'right' : 'center';
    c.lineWidth = 4 / this.scale; c.strokeStyle = '#111a1c';
    c.strokeText(FRONT_LABELS[item.front], tx, ty); c.fillText(FRONT_LABELS[item.front], tx, ty); c.restore();
  }
  private screen(e: MouseEvent) { const bounds = this.canvas.getBoundingClientRect(); return { x: e.clientX - bounds.left, y: e.clientY - bounds.top }; }
  private world(p: { x: number; y: number }) { return { x: (p.x - this.panX) / this.scale, y: (p.y - this.panY) / this.scale }; }
  private corners(i: MapObject) { return [{ x: i.x, y: i.y }, { x: i.x + i.w, y: i.y }, { x: i.x + i.w, y: i.y + i.h }, { x: i.x, y: i.y + i.h }]; }
  private bounds(a: { x: number; y: number }, b: { x: number; y: number }): Rect { return { gridX: Math.floor(Math.min(a.x, b.x)), gridY: Math.floor(Math.min(a.y, b.y)), widthCells: Math.max(1, Math.ceil(Math.max(a.x, b.x)) - Math.floor(Math.min(a.x, b.x))), heightCells: Math.max(1, Math.ceil(Math.max(a.y, b.y)) - Math.floor(Math.min(a.y, b.y))) }; }
  private down(e: PointerEvent): void {
    if (!commitFocused()) return; e.preventDefault(); this.canvas.focus(); this.canvas.setPointerCapture(e.pointerId);
    const screen = this.screen(e), start = this.world(screen); this.lastWorld = start;
    let mode = e.button !== 0 ? 'pan' as DrawTool : this.tool;
    const items = mapObjects(this.env.session, this.env.session.draft, this.preview).filter(i => !i.hidden && this.layers.has(i.layer));
    let item = items.find(i => i.id === this.env.session.selection), vertex = -1, corner = -1;
    const near = (p: { x: number; y: number }) => Math.hypot(p.x - start.x, p.y - start.y) * this.scale < 9;
    if (mode === 'select') {
      if (item?.kind === 'corridor') vertex = item.points?.findIndex(p => near({ x: p.x + 0.5, y: p.y + 0.5 })) ?? -1;
      if (item?.kind === 'rect' && !item.readonly) corner = this.corners(item).findIndex(near);
      if (vertex < 0 && corner < 0) item = [...items].reverse().find(i => {
        if (i.kind === 'corridor') return i.points?.some((p, n) => { const previous = i.points?.[n - 1]; if (!previous) return near(p); const dx = p.x - previous.x, dy = p.y - previous.y, length = dx * dx + dy * dy; const t = Math.max(0, Math.min(1, ((start.x - previous.x) * dx + (start.y - previous.y) * dy) / (length || 1))); return near({ x: previous.x + t * dx, y: previous.y + t * dy }); });
        if (i.kind === 'point') return Math.hypot(start.x - i.x - .5, start.y - i.y - .5) < (i.radius ?? 1);
        return start.x >= i.x && start.x <= i.x + i.w && start.y >= i.y && start.y <= i.y + i.h;
      });
      this.env.session.selection = item?.id ?? null;
      if (!item) mode = 'pan';
      this.selected();
    }
    this.drag = { start, screen, mode, item, vertex, corner, version: this.env.session.version, before: clone(this.env.session.draft), temporary: clone(this.env.session.draft), moved: false, panX: this.panX, panY: this.panY };
    if (mode === 'waterPaint' || mode === 'waterErase') this.brush(start);
    this.paint();
  }
  private brush(p: { x: number; y: number }): void {
    const d = this.drag!; const x = Math.floor(p.x), y = Math.floor(p.y);
    const list = (d.temporary.water ?? []) as JsonObject[];
    const index = list.findIndex(c => c.gridX === x && c.gridY === y);
    if (d.mode === 'waterPaint' && index < 0) { d.temporary.water = list; list.push({ gridX: x, gridY: y }); }
    if (d.mode === 'waterErase' && index >= 0) list.splice(index, 1);
    d.moved = true;
  }
  private move(e: PointerEvent): void {
    const d = this.drag; if (!d) return; const screen = this.screen(e); this.lastWorld = this.world(screen);
    if (Math.hypot(screen.x - d.screen.x, screen.y - d.screen.y) > 2) d.moved = true;
    if (d.mode === 'pan') { this.panX = d.panX + screen.x - d.screen.x; this.panY = d.panY + screen.y - d.screen.y; }
    else if (d.mode === 'waterPaint' || d.mode === 'waterErase') this.brush(this.lastWorld);
    else if (d.mode === 'select' && d.item && !d.item.readonly) {
      d.temporary = clone(d.before);
      if (d.corner >= 0) {
        const opposite = this.corners(d.item)[(d.corner + 2) % 4];
        const rect = this.bounds(opposite, { x: Math.round(this.lastWorld.x), y: Math.round(this.lastWorld.y) });
        set(d.temporary, d.item.path, { ...at(d.temporary, d.item.path) as JsonObject, ...rect });
      } else moveMapObject(d.temporary, d.item, Math.round(this.lastWorld.x - d.start.x), Math.round(this.lastWorld.y - d.start.y), d.vertex);
    }
    this.paint();
  }
  private up(e: PointerEvent): void {
    const d = this.drag; if (!d) return; this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d.version !== this.env.session.version) return this.paint();
    if (d.mode === 'waterPaint' || d.mode === 'waterErase') {
      this.env.session.change(['water'], d.temporary.water, 'Wasserzellen bearbeiten'); this.env.changed();
      if (d.mode === 'waterErase') this.env.message('Das Zellwerkzeug löscht nur Einzelzellen. Wasser aus Rechtecken wird über die jeweilige Wasserfläche bearbeitet.');
    } else if (d.moved && d.mode === 'select' && d.item && !d.item.readonly) { this.env.session.change(d.item.path, at(d.temporary, d.item.path), 'Geometrie ziehen'); this.env.changed(); }
    else if (['waterArea', 'rockWall', 'corridor', 'selected'].includes(d.mode)) { this.draw(d.mode, this.bounds(d.start, this.world(this.screen(e))), { x: Math.round(this.lastWorld.x), y: Math.round(this.lastWorld.y) }, { x: Math.round(d.start.x), y: Math.round(d.start.y) }); }
    this.paint();
  }
}
