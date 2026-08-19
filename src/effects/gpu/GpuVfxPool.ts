/**
 * GpuVfxPool – Ringbuffer ueber die Member eines `Phaser.GameObjects.SpriteGPULayer`.
 *
 * Der Layer bekommt seine Member einmalig bei der Initialisierung; danach werden Slots nur
 * noch zyklisch wiederverwendet. Ein gespawntes Partikel braucht kein CPU-Update pro Frame:
 * Position, Scale und Alpha laufen ueber GPU-Member-Animationen.
 *
 * ## Warum es trotzdem einen Retire-Schritt gibt
 *
 * Phasers GPU-Animationen halten nach Ablauf *nicht* auf ihrem Endwert. `SpriteGPULayer.vert`
 * benutzt bei `loop:false` `timeContinuous = rawTime`, eine lineare Animation extrapoliert also
 * unbegrenzt ueber `t = 1` hinaus. `ApplyTint.glsl` gibt `vec4(color * alpha, alpha)` ohne
 * Clamp zurueck, und `BlendModes.ADD` benutzt `src = ONE`. Ein abgelaufener Member wuerde damit
 * mit negativer Alpha die Szene aktiv *verdunkeln*, bei gleichzeitig wachsendem, gespiegeltem
 * Quad. Der klassische `ParticleEmitter` hat das Problem nicht, weil `Particle.update()` die
 * Alpha auf `[0,1]` clampt.
 *
 * Abgelaufene Slots werden deshalb genau einmal stillgelegt – ueber `patchMember()` mit
 * vorbereiteter Nullmaske auf `scaleX`/`scaleY`/`alpha`. Das ist ein Schreibzugriff pro
 * Partikeltod, kein Update pro Frame, und laesst `editMember()` ausschliesslich fuer
 * Spawn/Rearm uebrig.
 *
 * ## Ring-Invariante
 *
 * Lebende Slots liegen immer im Fenster `[tail, head)`. `acquire()` vergibt ausschliesslich
 * freie Slots, `head` laeuft also nie ueber lebendes Material; `tail` wandert nur ueber bereits
 * stillgelegte Slots nach. Damit ist der Scan pro Frame durch die maximale Lebenszeit begrenzt
 * und nicht durch die Kapazitaet. Aufrufer muessen `retireExpired()` vor `acquire()` im selben
 * Frame ausfuehren, sonst gilt ein abgelaufener, aber noch nicht stillgelegter Slot als belegt.
 */

/**
 * Der Ausschnitt von `SpriteGPULayer`, den der Pool braucht. Bewusst ohne Phaser-Import, damit
 * der Pool ohne Renderer und ohne Phaser-Mock testbar bleibt.
 */
export interface GpuVfxLayerHandle {
  readonly size: number;
  getDataByteSize(): number;
  addMember(member: object): unknown;
  editMember(index: number, member: object): unknown;
  patchMember(index: number, data: Uint32Array, mask?: number[]): void;
}

export interface GpuVfxPoolStats {
  readonly capacity: number;
  /** Slots, die aktuell als lebend gefuehrt werden. */
  readonly activeSlots: number;
  /** Laenge des Fensters, das `retireExpired()` pro Frame abgeht. */
  readonly scanWindow: number;
  readonly rearms: number;
  readonly overruns: number;
}

/** Rueckgabe von `acquire()`, wenn kein Slot frei ist. */
export const GPU_VFX_NO_SLOT = -1;

const NO_OWNER = -1;

/**
 * Wortoffsets der Animationsgruppen im Member-Buffer (je 4 Woerter: base, amplitude, duration,
 * delay+ease). Layout laut `Phaser.GameObjects.SpriteGPULayer#getMemberData`:
 * 0 x, 4 y, 8 rotation, 12 scaleX, 16 scaleY, 20 alpha, 24 frame, 28 tintBlend, 32 tints, …
 */
const WORD_SCALE_X = 12;
const WORD_ALPHA_END = 24;

export class GpuVfxPool {
  private readonly capacity: number;
  /** Ablaufzeitpunkt je Slot, in der Uhr, die der Aufrufer uebergibt. */
  private readonly expiresAt: Float64Array;
  /** Besitzer je Slot; `NO_OWNER` heisst frei bzw. bereits stillgelegt. */
  private readonly owner: Int32Array;
  /** Nullen; zusammen mit `deadMask` die stillgelegte Pose. Wird nie neu angelegt. */
  private readonly deadData: Uint32Array;
  private readonly deadMask: number[];

  /** Naechster Slot, der vergeben wird. */
  private head = 0;
  /** Anfang des Fensters, in dem noch lebende Slots liegen koennen. */
  private tail = 0;
  private activeSlots = 0;
  private rearms = 0;
  private overruns = 0;
  private overrunReported = false;
  private primed = false;

  constructor(
    private readonly layer: GpuVfxLayerHandle,
    capacity: number,
    private readonly label: string,
  ) {
    this.capacity  = Math.max(1, Math.min(capacity, layer.size));
    this.expiresAt = new Float64Array(this.capacity);
    this.owner     = new Int32Array(this.capacity).fill(NO_OWNER);

    const words = Math.max(WORD_ALPHA_END, Math.floor(layer.getDataByteSize() / 4));
    this.deadData = new Uint32Array(words);
    this.deadMask = new Array<number>(words).fill(0);
    // Bitmuster 0 ist Float 0.0: base 0, amplitude 0, duration 0. Der Shader steigt bei
    // `duration == 0` frueh aus und liefert die Basis – also Scale 0 und Alpha 0, dauerhaft.
    for (let word = WORD_SCALE_X; word < WORD_ALPHA_END; word += 1) this.deadMask[word] = 1;
  }

  /**
   * Legt alle Member einmalig an. Erst danach ist `memberCount == capacity`, was Voraussetzung
   * fuer jedes spaetere `editMember`/`patchMember` ist.
   */
  prime(deadTemplate: object): void {
    if (this.primed) return;
    for (let index = 0; index < this.capacity; index += 1) this.layer.addMember(deadTemplate);
    this.primed = true;
  }

  isPrimed(): boolean {
    return this.primed;
  }

  /**
   * Vergibt den naechsten freien Slot; der Aufrufer bespielt ihn anschliessend per
   * `editMember`. Liefert `GPU_VFX_NO_SLOT`, wenn der Ring voll ist – aktives Material wird
   * niemals ueberschrieben.
   */
  acquire(ownerId: number, nowMs: number, lifetimeMs: number): number {
    const slot = this.head;
    if (this.owner[slot] !== NO_OWNER) {
      this.overruns += 1;
      this.reportOverrun();
      return GPU_VFX_NO_SLOT;
    }

    this.owner[slot]     = ownerId;
    this.expiresAt[slot] = nowMs + lifetimeMs;
    this.head            = (slot + 1) % this.capacity;
    this.activeSlots    += 1;
    this.rearms         += 1;
    return slot;
  }

  /** Legt abgelaufene Slots still. Laeuft nur ueber das Fenster moeglicher Lebender. */
  retireExpired(nowMs: number): void {
    if (this.activeSlots === 0) return;
    let index = this.tail;
    for (let step = this.windowLength(); step > 0; step -= 1) {
      if (this.owner[index] !== NO_OWNER && this.expiresAt[index] <= nowMs) this.retire(index);
      index = (index + 1) % this.capacity;
    }
    this.advanceTail();
  }

  /** Sofortiges Ausblenden aller Member eines Besitzers – Ersatz fuer `ParticleEmitter.destroy()`. */
  releaseOwner(ownerId: number): void {
    if (this.activeSlots === 0) return;
    let index = this.tail;
    for (let step = this.windowLength(); step > 0; step -= 1) {
      if (this.owner[index] === ownerId) this.retire(index);
      index = (index + 1) % this.capacity;
    }
    this.advanceTail();
  }

  /** Rundenteardown bzw. Ablation: alles still, Ring zurueck auf Anfang. */
  releaseAll(): void {
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.owner[index] !== NO_OWNER) this.retire(index);
    }
    this.head = 0;
    this.tail = 0;
  }

  getStats(): GpuVfxPoolStats {
    return {
      capacity:    this.capacity,
      activeSlots: this.activeSlots,
      scanWindow:  this.activeSlots === 0 ? 0 : this.windowLength(),
      rearms:      this.rearms,
      overruns:    this.overruns,
    };
  }

  /**
   * Laenge von `[tail, head)`. Faellt `head` auf `tail`, ist der Ring voll – der leere Fall
   * wird nie abgefragt, weil die Aufrufer vorher auf `activeSlots === 0` pruefen.
   */
  private windowLength(): number {
    const span = (this.head - this.tail + this.capacity) % this.capacity;
    return span === 0 ? this.capacity : span;
  }

  private retire(index: number): void {
    this.layer.patchMember(index, this.deadData, this.deadMask);
    this.owner[index]     = NO_OWNER;
    this.expiresAt[index] = 0;
    this.activeSlots     -= 1;
  }

  private advanceTail(): void {
    if (this.activeSlots === 0) {
      this.tail = this.head;
      return;
    }
    while (this.owner[this.tail] === NO_OWNER) {
      this.tail = (this.tail + 1) % this.capacity;
    }
  }

  /**
   * Ein Overrun heisst, dass die feste Kapazitaet fuer das aktuelle Szenario zu klein ist. Das
   * ist eine Entwickler-Information und darf keine Runde abbrechen, muss aber sichtbar sein.
   */
  private reportOverrun(): void {
    if (this.overrunReported || import.meta.env.PROD) return;
    this.overrunReported = true;
    console.warn(
      `[GpuVfxPool:${this.label}] Kapazitaet ${this.capacity} erschoepft - Spawn verworfen, `
      + 'statt aktives Material zu ueberschreiben. Kapazitaet pruefen.',
    );
  }
}
