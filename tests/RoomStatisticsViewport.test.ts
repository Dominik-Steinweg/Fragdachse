import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/graphics/RenderResolution', () => ({ toDesignSpace: (_scale: unknown, value: number) => value }));
import { RoomStatisticsOverlay } from '../src/ui/RoomStatisticsOverlay';

function fixture() {
  const off = vi.fn();
  const overlay: any = new RoomStatisticsOverlay({ scale: {}, input: { off } } as never);
  const rows: any[] = [];
  overlay.container = { setVisible: vi.fn(), destroy: vi.fn() };
  overlay.content = { removeAll: () => { rows.length = 0; }, add: (row: unknown) => rows.push(row) };
  const bar = () => ({ visible: false, displayHeight: 0, y: 0,
    setVisible(value: boolean) { this.visible = value; return this; },
    setDisplaySize(_w: number, h: number) { this.displayHeight = h; return this; },
    setY(y: number) { this.y = y; return this; } });
  overlay.scrollThumb = bar(); overlay.scrollTrack = bar(); overlay.scrollHit = bar();
  overlay.buildTableRow = (entry: unknown, index: number) => ({ entry, index });
  const entries = Array.from({ length: 40 }, (_, i) => ({ name: `Player ${i}`, damageDealt: i, damageTaken: i }));
  return { overlay, rows, entries, off };
}

describe('room statistics viewport', () => {
  it('renders only a bounded slice and reaches both ends without moving the surrounding panel', () => {
    const { overlay, rows, entries } = fixture();
    overlay.show(entries);
    const capacity = rows.length;
    expect(capacity).toBeGreaterThan(0); expect(capacity).toBeLessThan(entries.length);
    expect(rows[0].entry.name).toBe('Player 39');
    const root = overlay.container;
    overlay.firstRow = 999; overlay.renderRows();
    expect(rows).toHaveLength(capacity); expect(rows.at(-1).entry.name).toBe('Player 0');
    expect(overlay.container).toBe(root);
    overlay.firstRow = -999; overlay.renderRows();
    expect(rows[0].entry.name).toBe('Player 39');
    expect(rows.map(row => row.index)).toEqual(Array.from({ length: capacity }, (_, i) => i));
    overlay.wheel({ x: 0, y: 0 }, [], 0, 120);
    expect(overlay.firstRow).toBe(0);
  });
  it('cancels dragging on new data, ignores hidden input and unregisters all scroll listeners', () => {
    const { overlay, entries, off } = fixture();
    overlay.show(entries); overlay.dragging = true;
    overlay.show(entries.slice(0, 1));
    expect(overlay.dragging).toBe(false); expect(overlay.scrollHit.visible).toBe(false);
    overlay.dragging = true; overlay.dragScroll({ y: 999 });
    expect(overlay.firstRow).toBe(0);
    overlay.hide(); overlay.wheel({ x: 500, y: 500 }, [], 0, 120);
    expect(overlay.firstRow).toBe(0);
    overlay.destroy();
    expect(off.mock.calls.map(([name]) => name).sort()).toEqual(['pointermove', 'pointerup', 'wheel']);
    expect(overlay.content).toBeNull(); expect(overlay.scrollHit).toBeNull();
  });
});
