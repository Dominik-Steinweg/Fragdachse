import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
/** Einziger Ort, an dem Kamerabewegung erzeugt werden darf. */
const CAMERA_OWNER_DIR = join('src', 'effects', 'camera');

function collectTypeScriptFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTypeScriptFiles(full, out);
      continue;
    }
    if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function findViolations(pattern: RegExp, allow: (relativePath: string) => boolean): string[] {
  const violations: string[] = [];
  for (const file of collectTypeScriptFiles(SRC_ROOT)) {
    const relativePath = relative(process.cwd(), file);
    if (allow(relativePath)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      // Kommentare duerfen die Regel erklaeren, ohne sie zu verletzen.
      const code = line.replace(/\/\/.*$/u, '').replace(/^\s*\*.*$/u, '');
      if (pattern.test(code)) violations.push(`${relativePath}:${index + 1}`);
    });
  }
  return violations;
}

/**
 * Strukturelle Absicherung statt Verhaltenspruefung.
 *
 * Phasers `Shake.start(duration, intensity, force = false)` bricht ab, solange bereits ein Shake
 * laeuft. Mehrere Systeme im Projekt forderten pro Frame ein schwaches Rumpeln an und
 * blockierten damit jede staerkere Erschuetterung. Seit Stufe 1 laeuft alle Kamerabewegung ueber
 * `CameraFeedbackController`, der Quellen gewichtet zusammenfuehrt und begrenzt.
 *
 * Dieser Test verhindert dauerhaft, dass eine vierzehnte direkte Shake-Stelle entsteht – die
 * einzige Massnahme, die das zuverlaessig leistet.
 */
describe('Kamera- und Zeitsteuerung bleiben in einer Hand', () => {
  it('ruft ausserhalb von src/effects/camera nirgends camera.shake()', () => {
    const violations = findViolations(
      /cameras\s*\.\s*main\s*\.\s*shake\s*\(|\bshakeEffect\b/u,
      (path) => path.startsWith(CAMERA_OWNER_DIR),
    );
    expect(violations).toEqual([]);
  });

  /**
   * Kein globaler Hit-Stop: das Spiel ist mehrspielerorientiert, ein Einfrieren der Simulation
   * laese sich nicht von Netzwerkverzoegerung oder Interpolationsfehlern unterscheiden.
   */
  it('veraendert nirgends die Zeitskalierung von Szene, Tweens, Physik oder Animationen', () => {
    const violations = findViolations(
      /\b(?:time|tweens|world|anims)\s*\.\s*(?:timeScale|globalTimeScale)\s*=|\bglobalTimeScale\s*=/u,
      () => false,
    );
    expect(violations).toEqual([]);
  });

  it('findet den Besitzer-Ordner tatsaechlich', () => {
    // Schuetzt den Test davor, still gruen zu werden, wenn der Ordner umbenannt wird.
    const cameraFiles = collectTypeScriptFiles(join(SRC_ROOT, 'effects', 'camera'));
    expect(cameraFiles.length).toBeGreaterThan(0);
    expect(cameraFiles.some((file) => file.endsWith(`${sep}CameraFeedbackController.ts`))).toBe(true);
  });
});
