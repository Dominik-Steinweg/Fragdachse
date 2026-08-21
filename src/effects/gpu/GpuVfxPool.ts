/**
 * GpuVfxPool – Slot-Verwaltung ueber die Member eines `Phaser.GameObjects.SpriteGPULayer`.
 *
 * Der Layer bekommt seine Member einmalig bei der Initialisierung; danach werden Slots nur noch
 * wiederverwendet. Ein gespawntes Partikel braucht kein CPU-Update pro Frame: Position, Scale und
 * Alpha laufen ueber GPU-Member-Animationen.
 *
 * ## Warum es trotzdem einen Retire-Schritt gibt
 *
 * Phasers GPU-Animationen halten nach Ablauf *nicht* auf ihrem Endwert. `SpriteGPULayer.vert`
 * benutzt bei `loop:false` `timeContinuous = rawTime`, eine lineare Animation extrapoliert also
 * unbegrenzt ueber `t = 1` hinaus. `ApplyTint.glsl` gibt `vec4(color * alpha, alpha)` ohne Clamp
 * zurueck, und `BlendModes.ADD` benutzt `src = ONE`. Ein abgelaufener Member wuerde damit mit
 * negativer Alpha die Szene aktiv *verdunkeln*, bei gleichzeitig wachsendem, gespiegeltem Quad.
 *
 * Abgelaufene Slots werden deshalb genau einmal stillgelegt – ueber `patchMember()` mit
 * vorbereiteter Nullmaske auf `scaleX`/`scaleY`/`alpha`. Ein Schreibzugriff pro Partikeltod, kein
 * Update pro Frame.
 *
 * ## Warum ein Ring-Cursor und keine Free-List
 *
 * Zwei Eigenschaften des Layers haengen an der Slot-Reihenfolge:
 *
 * 1. **Zeichenreihenfolge.** Der Submitter zeichnet `memberCount` Instanzen in Bufferreihenfolge.
 *    Slot-Index ist damit Zeichenreihenfolge. Eine LIFO-Free-List wuerde frische Member unter
 *    aeltere legen – bei `rocket-smoke` (NORMAL, Alpha 0.95) sichtbares Flackern.
 * 2. **Buffer-Uploads.** Der Buffer ist in 24 Segmente geteilt; hochgeladen wird je dirtyem
 *    Segment, und sobald alle belegten Segmente dirty sind, kippt der Submitter auf einen
 *    Vollupload. Aufeinanderfolgende Slots halten die Spawns eines Frames in ein bis zwei
 *    Segmenten, eine gestreute Free-List kann viele bis alle Segmente dirty machen.
 *
 * Der Ring-Cursor behaelt beides und behebt trotzdem das einzige echte Problem des fruehereren
 * Rings: ein langlebiger Member bei `head` blockierte dort die Vergabe, obwohl weiter hinten
 * freie Slots lagen. `acquire()` ueberspringt belegte Slots jetzt vorwaerts – ueber ein
 * Free-Bitset, also in Wortschritten statt Slot fuer Slot.
 *
 * ## Datenstrukturen
 *
 * - `freeBits` beantwortet "wo ist der naechste freie Slot ab hier" in O(Kapazitaet/32).
 * - `liveSlots`/`slotPos` fuehren die lebenden Slots dicht; der Expiration-Sweep laeuft damit
 *   ueber *exakt die Lebenden* und nicht ueber ein Fenster oder die Kapazitaet.
 * - `sourceHead`/`nextInSource`/`prevInSource` bilden je Quelle eine intrusive doppelt verkettete
 *   Liste. `releaseSource()` ist damit O(Partikel dieser Quelle) statt O(Lane) – der Punkt, an dem
 *   die Architektur mit vielen Effekten auf einer geteilten Lane steht und faellt.
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
  readonly liveCount: number;
  /** Hoechststand seit Rundenbeginn – das eigentliche Signal fuer die Kapazitaetswahl. */
  readonly peakLive: number;
  readonly rearms: number;
  readonly retirements: number;
  /** Verworfene Spawns, weil die Lane voll war (bzw. nur noch die kritische Reserve frei). */
  readonly capacityDrops: number;
  /** Wie oft `acquire()` ueber belegte Slots hinweggehen musste. */
  readonly skipSteps: number;
  /** Summe der pro Frame beschriebenen Buffer-Segmente. */
  readonly segmentsTouched: number;
  /** Frames, in denen alle belegten Segmente dirty waren – dort laedt Phaser den ganzen Buffer. */
  readonly fullUploadFrames: number;
}

/** Rueckgabe von `acquire()`, wenn kein Slot frei ist. */
export const GPU_VFX_NO_SLOT = -1;

/** Ein Slot ohne Quelle: entweder nie einer zugeordnet oder von `detachSource()` geloest. */
export const GPU_VFX_NO_SOURCE = -1;

const NONE = -1;

/**
 * Wortoffsets der Animationsgruppen im Member-Buffer (je 4 Woerter: base, amplitude, duration,
 * delay+ease). Layout laut `Phaser.GameObjects.SpriteGPULayer#getMemberData`:
 * 0 x, 4 y, 8 rotation, 12 scaleX, 16 scaleY, 20 alpha, 24 frame, 28 tintBlend, 32 tints, …
 */
const WORD_SCALE_X = 12;
const WORD_ALPHA_END = 24;

/** Phasers `SpriteGPULayer._segments`. */
const BUFFER_SEGMENTS = 24;

export class GpuVfxPool {
  private readonly capacity: number;
  /** Ablaufzeitpunkt je Slot, in der Uhr, die der Aufrufer uebergibt. */
  private readonly expiresAt: Float64Array;
  /** Quelle je Slot, `GPU_VFX_NO_SOURCE` wenn keine (mehr). */
  private readonly sourceOf: Int32Array;

  /** Bit gesetzt = Slot frei. Bits jenseits der Kapazitaet bleiben 0 und damit nie waehlbar. */
  private readonly freeBits: Uint32Array;
  /** Dichte Liste der lebenden Slots. */
  private readonly liveSlots: Int32Array;
  /** Position eines Slots in `liveSlots`, `NONE` wenn frei. Zugleich die Belegungsprobe. */
  private readonly slotPos: Int32Array;

  private readonly sourceHead: Int32Array;
  private readonly nextInSource: Int32Array;
  private readonly prevInSource: Int32Array;

  /** Nullen; zusammen mit `deadMask` die stillgelegte Pose. Wird nie neu angelegt. */
  private readonly deadData: Uint32Array;
  private readonly deadMask: number[];

  private readonly segmentSize: number;
  private segmentMask = 0;
  private segmentsTouched = 0;
  private fullUploadFrames = 0;

  /** Naechster Slot, der geprueft wird. */
  private head = 0;
  private liveCount = 0;
  private peakLive = 0;
  private rearms = 0;
  private retirements = 0;
  private capacityDrops = 0;
  private skipSteps = 0;
  private dropReported = false;
  private primed = false;

  constructor(
    private readonly layer: GpuVfxLayerHandle,
    capacity: number,
    private readonly label: string,
    maxSources: number,
  ) {
    this.capacity  = Math.max(1, Math.min(capacity, layer.size));
    this.expiresAt = new Float64Array(this.capacity);
    this.sourceOf  = new Int32Array(this.capacity).fill(GPU_VFX_NO_SOURCE);
    this.liveSlots = new Int32Array(this.capacity);
    this.slotPos   = new Int32Array(this.capacity).fill(NONE);

    this.freeBits = new Uint32Array(Math.ceil(this.capacity / 32));
    for (let slot = 0; slot < this.capacity; slot += 1) this.markFree(slot);

    this.sourceHead   = new Int32Array(Math.max(1, maxSources)).fill(NONE);
    this.nextInSource = new Int32Array(this.capacity).fill(NONE);
    this.prevInSource = new Int32Array(this.capacity).fill(NONE);

    this.segmentSize = Math.max(1, Math.ceil(this.capacity / BUFFER_SEGMENTS));

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

  getCapacity(): number {
    return this.capacity;
  }

  getLiveCount(): number {
    return this.liveCount;
  }

  /**
   * Vergibt einen freien Slot ab dem Ring-Cursor; der Aufrufer bespielt ihn anschliessend per
   * `editMember`. Liefert `GPU_VFX_NO_SLOT`, wenn die Lane voll ist – aktives Material wird
   * niemals ueberschrieben.
   */
  acquire(sourceIndex: number, nowMs: number, lifetimeMs: number): number {
    if (this.liveCount >= this.capacity) {
      this.recordCapacityDrop();
      return GPU_VFX_NO_SLOT;
    }

    const slot = this.findFree(this.head);
    if (slot === GPU_VFX_NO_SLOT) {
      // Kann nur passieren, wenn `liveCount` und Bitset auseinanderlaufen; defensiv behandelt.
      this.recordCapacityDrop();
      return GPU_VFX_NO_SLOT;
    }

    this.skipSteps += (slot - this.head + this.capacity) % this.capacity;
    this.markUsed(slot);
    this.slotPos[slot] = this.liveCount;
    this.liveSlots[this.liveCount] = slot;
    this.liveCount += 1;
    if (this.liveCount > this.peakLive) this.peakLive = this.liveCount;

    this.expiresAt[slot] = nowMs + lifetimeMs;
    this.linkToSource(slot, sourceIndex);

    this.head = slot + 1 === this.capacity ? 0 : slot + 1;
    this.rearms += 1;
    this.markSegment(slot);
    return slot;
  }

  /** Legt abgelaufene Slots still. Laeuft ueber exakt die lebenden Member. */
  retireExpired(nowMs: number): void {
    for (let index = this.liveCount - 1; index >= 0; index -= 1) {
      const slot = this.liveSlots[index];
      if (this.expiresAt[slot] <= nowMs) this.retire(slot);
    }
    // Leerer Pool: den Cursor zurueckstellen, damit bursty Lanes ihre Indizes unten halten.
    if (this.liveCount === 0) this.head = 0;
  }

  /** `kill-with-source`: alle Member einer Quelle sofort stilllegen. */
  releaseSource(sourceIndex: number): void {
    if (sourceIndex < 0 || sourceIndex >= this.sourceHead.length) return;
    let slot = this.sourceHead[sourceIndex];
    while (slot !== NONE) {
      const next = this.nextInSource[slot];
      this.retire(slot);
      slot = next;
    }
    this.sourceHead[sourceIndex] = NONE;
    if (this.liveCount === 0) this.head = 0;
  }

  /**
   * `linger`: die Quelle verschwindet, ihre Member leben aus.
   *
   * Die Member werden dabei von der Quelle geloest. Das ist kein Detail, sondern die Bedingung
   * dafuer, dass Source-Indizes ueberhaupt recycelt werden duerfen: ein spaeterer Besitzer
   * desselben Index wuerde sonst beim `releaseSource()` fremde, laengst vergessene Member
   * stilllegen.
   */
  detachSource(sourceIndex: number): void {
    if (sourceIndex < 0 || sourceIndex >= this.sourceHead.length) return;
    let slot = this.sourceHead[sourceIndex];
    while (slot !== NONE) {
      const next = this.nextInSource[slot];
      this.sourceOf[slot]     = GPU_VFX_NO_SOURCE;
      this.nextInSource[slot] = NONE;
      this.prevInSource[slot] = NONE;
      slot = next;
    }
    this.sourceHead[sourceIndex] = NONE;
  }

  /** Rundenteardown bzw. Ablation: alles still, Cursor zurueck auf Anfang. */
  releaseAll(): void {
    for (let index = this.liveCount - 1; index >= 0; index -= 1) {
      this.retire(this.liveSlots[index]);
    }
    this.sourceHead.fill(NONE);
    this.head = 0;
  }

  /**
   * Setzt die Statistik auf ein neues Messfenster zurueck. Der Zustand der Slots bleibt
   * unangetastet; `peakLive` startet beim aktuellen Stand, nicht bei null.
   */
  resetStats(): void {
    this.peakLive = this.liveCount;
    this.rearms = 0;
    this.retirements = 0;
    this.capacityDrops = 0;
    this.skipSteps = 0;
    this.segmentsTouched = 0;
    this.fullUploadFrames = 0;
  }

  /**
   * Einen verworfenen Spawn buchen, ohne einen Slot anzufassen. Das Backend weist Spawns schon
   * vor `acquire()` ab, wenn nur noch die kritische Reserve frei ist – ohne diesen Weg fehlte
   * der Verwurf in der Lane-Statistik, waehrend die Effektstatistik ihn zaehlt.
   */
  recordCapacityDrop(): void {
    this.capacityDrops += 1;
    this.warnOnceAboutCapacity();
  }

  /** Rollt die Segment-Diagnose des vergangenen Frames ab. Genau einmal pro Frame aufrufen. */
  beginFrame(): void {
    if (this.segmentMask !== 0) {
      this.segmentsTouched += countBits(this.segmentMask);
      if (this.allOccupiedSegmentsDirty()) this.fullUploadFrames += 1;
      this.segmentMask = 0;
    }
  }

  getStats(): GpuVfxPoolStats {
    return {
      capacity:         this.capacity,
      liveCount:        this.liveCount,
      peakLive:         this.peakLive,
      rearms:           this.rearms,
      retirements:      this.retirements,
      capacityDrops:    this.capacityDrops,
      skipSteps:        this.skipSteps,
      segmentsTouched:  this.segmentsTouched,
      fullUploadFrames: this.fullUploadFrames,
    };
  }

  // ── Interna ────────────────────────────────────────────────────────────────

  /**
   * Naechster freier Slot ab `start`, zyklisch. Laeuft in Wortschritten: `freeBits & mask`
   * verwirft alles vor `start`, `bits & -bits` isoliert das niedrigste gesetzte Bit.
   */
  private findFree(start: number): number {
    const words = this.freeBits.length;
    let word = start >>> 5;
    let mask = (0xffffffff << (start & 31)) >>> 0;

    for (let step = 0; step <= words; step += 1) {
      const index = word % words;
      const bits = this.freeBits[index] & mask;
      if (bits !== 0) {
        const lowest = bits & -bits;
        return index * 32 + (31 - Math.clz32(lowest));
      }
      word += 1;
      mask = 0xffffffff;
    }
    return GPU_VFX_NO_SLOT;
  }

  private markFree(slot: number): void {
    this.freeBits[slot >>> 5] |= (1 << (slot & 31));
  }

  private markUsed(slot: number): void {
    this.freeBits[slot >>> 5] &= ~(1 << (slot & 31));
  }

  private retire(slot: number): void {
    if (this.slotPos[slot] === NONE) return;

    this.layer.patchMember(slot, this.deadData, this.deadMask);
    this.markSegment(slot);
    this.unlinkFromSource(slot);

    // Swap-Remove aus der dichten Liste.
    const position = this.slotPos[slot];
    const last = this.liveSlots[this.liveCount - 1];
    this.liveSlots[position] = last;
    this.slotPos[last] = position;
    this.slotPos[slot] = NONE;
    this.liveCount -= 1;

    this.markFree(slot);
    this.expiresAt[slot] = 0;
    this.retirements += 1;
  }

  private linkToSource(slot: number, sourceIndex: number): void {
    if (sourceIndex < 0 || sourceIndex >= this.sourceHead.length) {
      this.sourceOf[slot] = GPU_VFX_NO_SOURCE;
      this.nextInSource[slot] = NONE;
      this.prevInSource[slot] = NONE;
      return;
    }
    const head = this.sourceHead[sourceIndex];
    this.nextInSource[slot] = head;
    this.prevInSource[slot] = NONE;
    if (head !== NONE) this.prevInSource[head] = slot;
    this.sourceHead[sourceIndex] = slot;
    this.sourceOf[slot] = sourceIndex;
  }

  private unlinkFromSource(slot: number): void {
    const source = this.sourceOf[slot];
    if (source === GPU_VFX_NO_SOURCE) return;

    const previous = this.prevInSource[slot];
    const next     = this.nextInSource[slot];
    if (previous !== NONE) this.nextInSource[previous] = next;
    else this.sourceHead[source] = next;
    if (next !== NONE) this.prevInSource[next] = previous;

    this.sourceOf[slot]     = GPU_VFX_NO_SOURCE;
    this.nextInSource[slot] = NONE;
    this.prevInSource[slot] = NONE;
  }

  private markSegment(slot: number): void {
    const segment = Math.floor(slot / this.segmentSize);
    if (segment < 32) this.segmentMask |= (1 << segment);
  }

  /**
   * Naeherung an Phasers `occupiedSegmentsAllUpdated`: `memberCount` ist nach dem Priming die
   * Kapazitaet, belegt sind damit die Segmente 0..floor(capacity/segmentSize).
   */
  private allOccupiedSegmentsDirty(): boolean {
    const lastSegment = Math.min(31, Math.floor((this.capacity - 1) / this.segmentSize));
    for (let segment = 0; segment <= lastSegment; segment += 1) {
      if ((this.segmentMask & (1 << segment)) === 0) return false;
    }
    return true;
  }

  /**
   * Ein Kapazitaets-Drop heisst, dass die feste Kapazitaet fuer das aktuelle Szenario zu klein
   * ist. Das ist eine Entwickler-Information und darf keine Runde abbrechen, muss aber sichtbar
   * sein. (Bei `rocket-smoke` ist es der bewusst nachgebildete `maxAliveParticles`-Deckel.)
   */
  private warnOnceAboutCapacity(): void {
    if (this.dropReported || import.meta.env.PROD) return;
    this.dropReported = true;
    console.warn(
      `[GpuVfxPool:${this.label}] Kapazitaet ${this.capacity} erschoepft - Spawn verworfen, `
      + 'statt aktives Material zu ueberschreiben. Kapazitaet pruefen.',
    );
  }
}

function countBits(value: number): number {
  let bits = value - ((value >> 1) & 0x55555555);
  bits = (bits & 0x33333333) + ((bits >> 2) & 0x33333333);
  return (((bits + (bits >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}
