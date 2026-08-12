import type { AmbientIntensity, AmbientTemplateId } from './AmbientSequenceCatalog';
import type { AmbientWeaponEntry, AmbientWeaponFamily } from './AmbientWeaponPool';

export interface AmbientSequenceRecord {
  template:        AmbientTemplateId;
  zoneId:          string;
  intensity:       AmbientIntensity;
  weaponIds:       readonly string[];
  weaponFamilies:  readonly AmbientWeaponFamily[];
  enemyKinds:      readonly string[];
  /** Tatsächlich zerstörte Ambient-Felsen. */
  destroyedRocks:  number;
  /** Kam mindestens eine aktuell gewählte Loadout-Waffe vor? */
  usedLoadoutFocus: boolean;
  atMs:            number;
}

/** Wie viele Einträge in die Bewertung eingehen. */
const WINDOW = 12;
/** Mindestabstand zwischen zwei starken Sequenzen. */
const STRONG_LOCKOUT_MS = 45_000;
/** Ein Inspector-Auftritt zählt als eigenes Aufmerksamkeitsereignis. */
const INSPECTOR_ATTENTION_MS = 12_000;
/** Ab dieser Zahl zerstörter Felsen gilt eine Sequenz als schwer und sperrt länger. */
const HEAVY_DESTRUCTION_ROCKS = 5;

/**
 * Gedächtnis des Directors.
 *
 * Bewertet mindestens Template, Zone, Gegnerfamilie, Waffenfamilie, Intensität,
 * Felsschaden und Loadout-Fokus – und liefert daraus Abwertungsfaktoren zwischen 0 und 1.
 * Ein Faktor 0 heisst „kommt jetzt nicht in Frage", nicht „nie wieder".
 *
 * Bewusst rein rechnend und ohne Zeitgeber: Die Uhr kommt von aussen, damit sich die Auswahl
 * über tausende künstliche Sequenzen durchsimulieren lässt.
 */
export class AmbientSequenceHistory {
  private readonly records: AmbientSequenceRecord[] = [];
  private lastInspectorAtMs = Number.NEGATIVE_INFINITY;
  private lastStrongAtMs = Number.NEGATIVE_INFINITY;
  private lastHeavyDestructionAtMs = Number.NEGATIVE_INFINITY;

  record(entry: AmbientSequenceRecord): void {
    this.records.push(entry);
    if (this.records.length > WINDOW) this.records.shift();
    if (entry.intensity === 'strong') this.lastStrongAtMs = entry.atMs;
    if (entry.destroyedRocks >= HEAVY_DESTRUCTION_ROCKS) this.lastHeavyDestructionAtMs = entry.atMs;
  }

  recordInspectorAppearance(atMs: number): void {
    this.lastInspectorAtMs = atMs;
  }

  /** Zuletzt gezeigtes Template – wird nie direkt wiederholt. */
  lastTemplate(): AmbientTemplateId | null {
    return this.records.length > 0 ? this.records[this.records.length - 1].template : null;
  }

  /**
   * Darf jetzt eine starke Sequenz laufen?
   *
   * Starke Effekte sperren länger, und ein frischer Inspector-Auftritt zählt dabei mit: zwei
   * Aufmerksamkeitsereignisse dicht hintereinander wirken hektisch.
   */
  canRunStrong(nowMs: number): boolean {
    if (nowMs - this.lastStrongAtMs < STRONG_LOCKOUT_MS) return false;
    if (nowMs - this.lastHeavyDestructionAtMs < STRONG_LOCKOUT_MS) return false;
    return nowMs - this.lastInspectorAtMs >= INSPECTOR_ATTENTION_MS;
  }

  /** 0 = gesperrt, sonst Abwertung nach Häufigkeit im Fenster. */
  templatePenalty(template: AmbientTemplateId): number {
    if (this.lastTemplate() === template) return 0;
    return decayFor(this.countBy((record) => record.template === template));
  }

  zonePenalty(zoneId: string): number {
    return decayFor(this.countBy((record) => record.zoneId === zoneId));
  }

  enemyPenalty(kind: string): number {
    return decayFor(this.countBy((record) => record.enemyKinds.includes(kind)));
  }

  /**
   * Abwertung einer Waffe – zwei getrennte Faktoren: die Waffe selbst und ihre Familie.
   *
   * Der Faktor für die einzelne Waffe fällt bewusst steiler als der Loadout-Bonus steigt.
   * Damit hat Anti-Repetition Vorrang vor der Loadout-Gewichtung: Eine gerade gezeigte
   * Fokuswaffe fällt hinter eine frische Normalwaffe derselben Familie zurück, statt sie mit
   * ihrem Bonus weiter zu überstimmen.
   */
  weaponPenalty(entry: AmbientWeaponEntry): number {
    const byId = this.countBy((record) => record.weaponIds.includes(entry.id));
    const byFamily = this.countBy((record) => record.weaponFamilies.includes(entry.family));
    return decayFor(byFamily) / (1 + byId * 1.6);
  }

  /** Anteil der jüngsten Sequenzen, in denen eine gewählte Loadout-Waffe vorkam. */
  loadoutFocusShare(): number {
    if (this.records.length === 0) return 0;
    return this.countBy((record) => record.usedLoadoutFocus) / this.records.length;
  }

  size(): number {
    return this.records.length;
  }

  reset(): void {
    this.records.length = 0;
    this.lastInspectorAtMs = Number.NEGATIVE_INFINITY;
    this.lastStrongAtMs = Number.NEGATIVE_INFINITY;
    this.lastHeavyDestructionAtMs = Number.NEGATIVE_INFINITY;
  }

  private countBy(predicate: (record: AmbientSequenceRecord) => boolean): number {
    let count = 0;
    for (const record of this.records) if (predicate(record)) count += 1;
    return count;
  }
}

/**
 * Je häufiger etwas zuletzt vorkam, desto stärker die Abwertung – aber nie auf null, damit
 * kein Element dauerhaft aus dem Programm fällt.
 */
function decayFor(occurrences: number): number {
  return 1 / (1 + occurrences * 0.85);
}
