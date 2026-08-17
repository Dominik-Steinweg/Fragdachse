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
  drawX?: number;
  drawY?: number;
  method?: 'draw' | 'stamp';
  originX?: number;
  originY?: number;
  content: string[];
}

interface FakeStampConfig {
  originX?: number;
  originY?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
}

function translateContent(content: readonly string[], offsetX: number, offsetY: number): string[] {
  return content.map((entry) => entry.replace(
    /@(-?\d+),(-?\d+)/,
    (_match, x: string, y: string) => `@${Number(x) + offsetX},${Number(y) + offsetY}`,
  ));
}

export class FakeImage {
  active = true;
  rotation = 0;
  alpha = 1;
  displaySize = 0;
  displayWidth = 0;
  displayHeight = 0;
  originX = 0.5;
  originY = 0.5;
  frame = { name: 0 };

  constructor(public key: string, public x: number, public y: number) {}

  setOrigin(x = 0.5, y = x): this {
    this.originX = x;
    this.originY = y;
    return this;
  }
  setDepth(): this { return this; }
  /** Vier Ecktints wie beim echten Image; fuer die Paritaetsvergleiche irrelevant. */
  setTint(): this { return this; }
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
  setDisplaySize(width: number, height = width): this {
    this.displaySize = width;
    this.displayWidth = width;
    this.displayHeight = height;
    return this;
  }
  destroy(): void {
    this.active = false;
  }

  /** Alles, was die Darstellung bestimmt – Grundlage jedes Paritaetsvergleichs. */
  describe(x = this.x, y = this.y): string {
    return `${this.key}@${Math.round(x)},${Math.round(y)}`
      + `|size=${this.displaySize}|rot=${this.rotation.toFixed(4)}|alpha=${this.alpha}`;
  }
}

export class FakeRenderTexture {
  private static readonly textures = new Map<string, FakeRenderTexture>();

  active = true;
  visible = false;
  x = 0;
  y = 0;
  originX = 0.5;
  originY = 0.5;
  content: string[] = [];
  fills: FakeFill[] = [];
  blits: FakeBlit[] = [];
  readonly renderCameraScrollYs: number[] = [];
  readonly pixels: Uint8Array;
  camera = {
    scrollX: 0,
    scrollY: 0,
    setScroll: (x: number, y: number) => {
      this.camera.scrollX = x;
      this.camera.scrollY = y;
    },
  };
  texture: { key: string };
  private pending: Array<() => void> = [];

  constructor(key: string, readonly width = 256, readonly height = 256) {
    this.texture = { key };
    this.pixels = new Uint8Array(width * height);
    FakeRenderTexture.textures.set(key, this);
  }

  setOrigin(x = 0.5, y = x): this {
    this.originX = x;
    this.originY = y;
    return this;
  }
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

  clear(localX?: number, localY?: number, width = this.width, height = this.height): this {
    this.pending.push(() => {
      if (localX === undefined) {
        this.content = [];
        this.fills = [];
        this.pixels.fill(0);
        return;
      }
      this.writeRect(localX, localY ?? 0, width, height, 0);
      this.blits.push({ localX, localY: localY ?? 0, content: [] });
    });
    return this;
  }

  fill(_rgb: number, _alpha: number, x = 0, y = 0, width = this.width, height = this.height): this {
    this.pending.push(() => {
      this.fills.push({ x, y, width, height });
      this.writeRect(x, y, width, height, 1);
    });
    return this;
  }

  erase(entries: unknown, x?: number, y?: number): this {
    const list = Array.isArray(entries) ? entries : [entries];
    this.pending.push(() => {
      for (const entry of list) {
        if (typeof entry === 'string') {
          const source = FakeRenderTexture.textures.get(entry);
          if (source) this.compositeTexture(source, x ?? 0, y ?? 0, 0.5, 0.5, true);
          continue;
        }
        if (!entry || typeof entry !== 'object') continue;
        const positioned = entry as {
          x?: number;
          y?: number;
          key?: string;
          displaySize?: number;
          displayWidth?: number;
          displayHeight?: number;
          originX?: number;
          originY?: number;
        };
        const drawX = (x ?? positioned.x ?? 0) - this.camera.scrollX;
        const drawY = (y ?? positioned.y ?? 0) - this.camera.scrollY;
        const source = positioned.key ? FakeRenderTexture.textures.get(positioned.key) : undefined;
        if (source) {
          this.compositeTexture(
            source,
            drawX,
            drawY,
            positioned.originX ?? 0.5,
            positioned.originY ?? 0.5,
            true,
          );
          continue;
        }
        const width = positioned.displayWidth ?? positioned.displaySize ?? 32;
        const height = positioned.displayHeight ?? positioned.displaySize ?? 32;
        this.writeRect(
          drawX - width * (positioned.originX ?? 0.5),
          drawY - height * (positioned.originY ?? 0.5),
          width,
          height,
          0,
        );
      }
    });
    return this;
  }

  stamp(
    key: string,
    _frame: unknown,
    x: number,
    y: number,
    config?: FakeStampConfig,
  ): this {
    this.pending.push(() => {
      const source = FakeRenderTexture.textures.get(key);
      if (!source || source === this) {
        this.content.push(`${key}@${Math.round(x)},${Math.round(y)}`);
        const scaleX = Math.abs(config?.scaleX ?? config?.scale ?? 1);
        const scaleY = Math.abs(config?.scaleY ?? config?.scale ?? 1);
        const width = Math.max(1, Math.round(32 * scaleX));
        const height = Math.max(1, Math.round(32 * scaleY));
        this.writeRect(
          x - width * (config?.originX ?? 0.5),
          y - height * (config?.originY ?? 0.5),
          width,
          height,
          1,
        );
        return;
      }

      const drawn = translateContent(source.content, x, y);
      this.compositeTexture(source, x, y, config?.originX ?? 0.5, config?.originY ?? 0.5, false);
      const blit = this.blits[this.blits.length - 1];
      if (blit) {
        blit.drawX = x;
        blit.drawY = y;
        blit.method = 'stamp';
        blit.originX = config?.originX;
        blit.originY = config?.originY;
        blit.content = [...blit.content, ...drawn];
      }
      this.content.push(...drawn);
    });
    return this;
  }

  draw(entries: unknown, x?: number, y?: number): this {
    const list = Array.isArray(entries) ? entries : [entries];
    this.pending.push(() => {
      const drawn: string[] = [];
      for (const entry of list) {
        if (entry instanceof FakeRenderTexture) {
          const drawX = (x ?? entry.x) - this.camera.scrollX;
          const drawY = (y ?? entry.y) - this.camera.scrollY;
          drawn.push(...translateContent(
            entry.content,
            drawX,
            drawY,
          ));
          this.compositeTexture(entry, drawX, drawY, entry.originX, entry.originY, false);
        }
        else if (entry instanceof FakeImage) {
          const drawX = (x ?? entry.x) - this.camera.scrollX;
          const drawY = (y ?? entry.y) - this.camera.scrollY;
          drawn.push(entry.describe(
            drawX,
            drawY,
          ));
          const width = entry.displayWidth || 32;
          const height = entry.displayHeight || 32;
          this.writeRect(
            drawX - width * entry.originX,
            drawY - height * entry.originY,
            width,
            height,
            1,
          );
        }
      }
      const blit = this.blits[this.blits.length - 1];
      if (blit) {
        blit.drawX = (x ?? (list[0] instanceof FakeRenderTexture ? list[0].x : 0)) - this.camera.scrollX;
        blit.drawY = (y ?? (list[0] instanceof FakeRenderTexture ? list[0].y : 0)) - this.camera.scrollY;
        blit.method = 'draw';
        blit.content = [...blit.content, ...drawn];
      }
      this.content.push(...drawn);
    });
    return this;
  }

  render(): this {
    this.renderCameraScrollYs.push(this.camera.scrollY);
    for (const command of this.pending) command();
    this.pending.length = 0;
    return this;
  }

  snapshotPixels(): number[] {
    return Array.from(this.pixels);
  }

  private writeRect(x: number, y: number, width: number, height: number, value: number): void {
    const minX = Math.max(0, Math.floor(x));
    const minY = Math.max(0, Math.floor(y));
    const maxX = Math.min(this.width, Math.ceil(x + width));
    const maxY = Math.min(this.height, Math.ceil(y + height));
    for (let py = minY; py < maxY; py += 1) {
      for (let px = minX; px < maxX; px += 1) {
        this.pixels[py * this.width + px] = value;
      }
    }
  }

  private compositeTexture(
    source: FakeRenderTexture,
    x: number,
    y: number,
    originX: number,
    originY: number,
    erase: boolean,
  ): void {
    const left = Math.round(x - source.width * originX);
    const top = Math.round(y - source.height * originY);
    for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
      const targetY = top + sourceY;
      if (targetY < 0 || targetY >= this.height) continue;
      for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
        if (source.pixels[sourceY * source.width + sourceX] === 0) continue;
        const targetX = left + sourceX;
        if (targetX < 0 || targetX >= this.width) continue;
        this.pixels[targetY * this.width + targetX] = erase ? 0 : 1;
      }
    }
  }

  destroy(): void {
    this.active = false;
    if (FakeRenderTexture.textures.get(this.texture.key) === this) {
      FakeRenderTexture.textures.delete(this.texture.key);
    }
  }
}

/**
 * Ein losgeloestes Bild, wie es die Bake-Pfade ueber `new Phaser.GameObjects.Image(...)` bauen.
 *
 * Die Argumentreihenfolge folgt Phaser (`scene, x, y, key, frame`), der Rumpf ist {@link FakeImage}.
 */
export class FakeDetachedImage extends FakeImage {
  constructor(_scene: unknown, x: number, y: number, key: string, frame?: string | number) {
    super(key, x, y);
    if (frame !== undefined) this.frame = { name: frame as number };
  }
}

/**
 * Ersatzmodul fuer `vi.mock('phaser', ...)`.
 *
 * Seit die Bake-Pfade ihre kurzlebigen Bilder losgeloest erzeugen – statt ueber `scene.add.image`,
 * dessen Anzeigelisten-Eintrag je Objekt drei lineare Suchen kostet – muss die Attrappe auch
 * `Phaser.GameObjects.Image` liefern und nicht nur die Szene.
 */
export function createFakePhaserModule(): Record<string, unknown> {
  return {
    BlendModes: { NORMAL: 0, MULTIPLY: 1, ADD: 2, ERASE: 17, SKIP_CHECK: -1 },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
      Between: (min: number) => min,
      FloatBetween: () => 0.5,
      Angle: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1) },
      Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
      RND: { pick: <T>(items: readonly T[]) => items[0] },
      Vector2: class { x = 0; y = 0; },
    },
    Geom: { Rectangle: class {} },
    GameObjects: { Image: FakeDetachedImage },
  };
}

export function createFakeArenaScene() {
  let created = 0;
  const layers: Array<{ list: unknown[] }> = [];
  return {
    add: {
      renderTexture: (_x = 0, _y = 0, width = 32, height = 32) =>
        new FakeRenderTexture(`fake_rt_${created++}`, width, height),
      image: (x: number, y: number, key: string) => new FakeImage(key, x, y),
      existing: <T>(gameObject: T): T => gameObject,
      layer: () => {
        const layer = {
          list: [] as unknown[],
          active: true,
          add(child: unknown) { layer.list.push(child); return layer; },
          setDepth() { return layer; },
          destroy() { layer.active = false; },
        };
        layers.push(layer);
        return layer;
      },
    },
    textures: {
      exists: () => true,
      getFrame: () => ({ width: 32, height: 32 }),
      addDynamicTexture: () => null,
    },
    layers,
  };
}

/** Ein lebender Fels, so wie ihn die Overlay-Pfade lesen: Position, Autotile-Frame, `active`. */
export function fakeRockImage(gridX: number, gridY: number, cellSize: number, offsetX = 0, offsetY = 0) {
  return {
    active: true,
    x: offsetX + gridX * cellSize + cellSize / 2,
    y: offsetY + gridY * cellSize + cellSize / 2,
    texture: { key: 'rocks' },
    displayWidth: cellSize,
    displayHeight: cellSize,
    originX: 0.5,
    originY: 0.5,
    frame: { name: 0 },
    destroy(): void { this.active = false; },
  };
}
