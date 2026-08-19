/**
 * ParticleFlowScheduler – reproduziert Phasers Flow-Semantik fuer GPU-Partikel.
 *
 * Ein klassischer `ParticleEmitter` im Flow-Modus haelt einen Countdown, der pro Frame um das
 * Delta faellt; bei jedem Nulldurchgang entsteht ein Partikel und die *aktuell gueltige*
 * Frequenz wird wieder aufaddiert. Entscheidend ist, dass ein Frequenzwechsel den laufenden
 * Countdown nicht zuruecksetzt – genau daran scheitert `emitter.setFrequency()` pro Frame, und
 * genau deshalb schreibt der Airstrike heute direkt auf `emitter.frequency`.
 *
 * `tick()` liefert bewusst nur die Anzahl faelliger Spawns statt einen Callback zu rufen: der
 * Aufrufer haelt Zustand pro Strike, ein Callback waere eine Closure-Allokation pro Strike und
 * Frame. Diese Klasse kennt weder Phaser noch den Pool.
 */
export class ParticleFlowScheduler {
  private counterMs: number;
  private frequencyMs: number;

  constructor(initialCounterMs: number) {
    this.counterMs   = initialCounterMs;
    this.frequencyMs = Math.max(1, initialCounterMs);
  }

  /** Setzt die ab jetzt gueltige Frequenz, ohne den laufenden Countdown anzutasten. */
  setFrequency(frequencyMs: number): void {
    this.frequencyMs = Math.max(1, frequencyMs);
  }

  getFrequency(): number {
    return this.frequencyMs;
  }

  getCounter(): number {
    return this.counterMs;
  }

  /**
   * Ein Frame Fortschritt. Rueckgabe ist die Zahl der jetzt faelligen Partikel; nach jedem
   * davon wird die gueltige Frequenz aufaddiert, wie in Phasers `flow`. `frequencyMs` ist
   * immer >= 1, die Schleife terminiert daher auch bei grossen Deltas.
   */
  tick(deltaMs: number): number {
    this.counterMs -= deltaMs;
    let due = 0;
    while (this.counterMs <= 0) {
      due += 1;
      this.counterMs += this.frequencyMs;
    }
    return due;
  }
}
