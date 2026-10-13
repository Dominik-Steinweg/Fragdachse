/**
 * Deterministischer Zufall der Dawn-Komposition (Mulberry32).
 *
 * Nur der Host komponiert; trotzdem muss derselbe Seed denselben Plan liefern, damit Runden
 * reproduzierbar und testbar bleiben. Jede Teilentscheidung (Sites, Nacht, Tag) zieht aus einem
 * eigenen Strom, damit eine Aenderung an einem Teil die anderen nicht verschiebt.
 */
export interface DawnRandom {
  /** Gleichverteilt in [0, 1). */
  next(): number;
  /** Ganzzahl in [0, count). */
  int(count: number): number;
  /** Gewichtete Auswahl; Eintraege mit Gewicht <= 0 werden nie gewaehlt. `null` ohne Kandidaten. */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T | null;
  /** Neue, gemischte Kopie. */
  shuffle<T>(items: readonly T[]): T[];
}

export function createDawnRandom(seed: number, stream: string): DawnRandom {
  if (!Number.isSafeInteger(seed)) throw new Error(`[DawnRandom] Seed must be a safe integer: ${seed}`);
  let state = mixSeed(seed, stream);
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (count: number): number => Math.floor(next() * count);
  return {
    next,
    int,
    pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T | null {
      const weighted = items.map((item) => ({ item, weight: Math.max(0, weightOf(item)) }))
        .filter(({ weight }) => weight > 0);
      const total = weighted.reduce((sum, { weight }) => sum + weight, 0);
      if (total <= 0) return null;
      let roll = next() * total;
      for (const { item, weight } of weighted) {
        roll -= weight;
        if (roll < 0) return item;
      }
      return weighted[weighted.length - 1].item;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = int(index + 1);
        [result[index], result[swap]] = [result[swap], result[index]];
      }
      return result;
    },
  };
}

/** Faltet Seed (auch jenseits von 32 Bit) und Stromname per FNV-1a in einen 32-Bit-Startwert. */
function mixSeed(seed: number, stream: string): number {
  let hash = 0x811c9dc5;
  const text = `${seed}:${stream}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash | 0;
}
