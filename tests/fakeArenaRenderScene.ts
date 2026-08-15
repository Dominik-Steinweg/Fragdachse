/**
 * Attrappen fuer die gebackenen Arena-Layer.
 *
 * Zwei Eigenschaften bildet sie bewusst nach, weil genau an ihnen die realen Fehler hingen:
 *
 * - **Verzoegerte Befehle.** `clear()`, `fill()`, `draw()` und `stamp()` einer DynamicTexture landen
 *   im Kommandopuffer und werden erst von `render()` ausgefuehrt. Ein Fake, der sofort ausfuehrt,
 *   koennte einen vergessenen `render()`-Aufruf prinzipiell nicht zeigen.
 * - **Spaetes Auslesen der Quelle.** Ein geblittetes Scratch-Ziel wird erst beim Flush des *Ziels*
 *   gelesen, nicht beim Aufruf von `draw()` – genau wie die GPU es taete.
 *
 * Kein Phaser-Import: Die Datei laeuft in Testdateien, die `phaser` per `vi.mock` ersetzen.
 */

export interface FakeFill {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FakeBlit {
  localX: number;
  localY: number;
  content: string[];
}

export class FakeImage {
  active = true;
  rotation = 0;
  alpha = 1;
  displaySize = 0;
  frame = { name: 0 };

  constructor(public key: string, public x: number, public y: number) {}

  setOrigin(): this { return this; }
  setDepth(): this { return this; }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  setAlpha(alpha: number): this {
    this.alpha = alpha;
    return this;
  }
  setRotation(rotation: number): this {
    this.rotation = rotation;
    return this;
  }
  setDisplaySize(width: number): this {
    this.displaySize = width;
    return this;
  }
  destroy(): void {
    this.active = false;
  }

  /** Alles, was die Darstellung bestimmt – Grundlage jedes Paritaetsvergleichs. */
  describe(): string {
    return `${this.key}@${Math.round(this.x)},${Math.round(this.y)}`
      + `|size=${this.displaySize}|rot=${this.rotation.toFixed(4)}|alpha=${this.alpha}`;
  }
}

export class FakeRenderTexture {
  active = true;
  visible = false;
  x = 0;
  y = 0;
  content: string[] = [];
  fills: FakeFill[] = [];
  blits: FakeBlit[] = [];
  camera = { setScroll: () => {} };
  texture: { key: string };
  private pending: Array<() => void> = [];

  constructor(key: string) {
    this.texture = { key };
  }

  setOrigin(): this { return this; }
  setDepth(): this { return this; }
  setAlpha(): this { return this; }
  setBlendMode(): this { return this; }
  setRenderMode(): this { return this; }
  setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  clear(localX?: number, localY?: number): this {
    this.pending.push(() => {
      if (localX === undefined) {
        this.content = [];
        this.fills = [];
        return;
      }
      this.blits.push({ localX, localY: localY ?? 0, content: [] });
    });
    return this;
  }

  fill(_rgb: number, _alpha: number, x = 0, y = 0, width = 0, height = 0): this {
    this.pending.push(() => this.fills.push({ x, y, width, height }));
    return this;
  }

  erase(): this { return this; }

  stamp(key: string, _frame: unknown, x: number, y: number): this {
    this.pending.push(() => this.content.push(`${key}@${Math.round(x)},${Math.round(y)}`));
    return this;
  }

  draw(entries: unknown): this {
    const list = Array.isArray(entries) ? entries : [entries];
    this.pending.push(() => {
      const drawn: string[] = [];
      for (const entry of list) {
        if (entry instanceof FakeRenderTexture) drawn.push(...entry.content);
        else if (entry instanceof FakeImage) drawn.push(entry.describe());
      }
      const blit = this.blits[this.blits.length - 1];
      if (blit) blit.content = [...blit.content, ...drawn];
      this.content.push(...drawn);
    });
    return this;
  }

  render(): this {
    for (const command of this.pending) command();
    this.pending.length = 0;
    return this;
  }

  destroy(): void {
    this.active = false;
  }
}

export function createFakeArenaScene() {
  let created = 0;
  return {
    add: {
      renderTexture: () => new FakeRenderTexture(`fake_rt_${created++}`),
      image: (x: number, y: number, key: string) => new FakeImage(key, x, y),
    },
    textures: {
      exists: () => true,
      getFrame: () => ({ width: 32, height: 32 }),
      addDynamicTexture: () => null,
    },
  };
}

/** Ein lebender Fels, so wie ihn die Overlay-Pfade lesen: Position, Autotile-Frame, `active`. */
export function fakeRockImage(gridX: number, gridY: number, cellSize: number) {
  return {
    active: true,
    x: gridX * cellSize + cellSize / 2,
    y: gridY * cellSize + cellSize / 2,
    frame: { name: 0 },
    destroy(): void { this.active = false; },
  };
}
