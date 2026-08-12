/**
 * uiFonts – laedt die beiden UI-Schriften und meldet, wann sie einsatzbereit sind.
 *
 * Warum das noetig ist: `Phaser.GameObjects.Text` rastert seine Glyphen beim Anlegen in eine
 * eigene Canvas. Ist die Webfont zu diesem Zeitpunkt noch nicht geladen, rastert der Browser
 * mit dem Fallback – und zwar dauerhaft, denn ein spaeteres Eintreffen der Schrift loest von
 * sich aus keine Neurasterung aus. Deshalb wird vor dem Start gewartet und zusaetzlich nach
 * `document.fonts.ready` einmal nachgerastert.
 *
 * Die Schriftdateien liegen als woff2 unter `public/assets/fonts/` und werden in `index.html`
 * per `@font-face` deklariert. Beide Familien stehen unter SIL OFL 1.1; die Lizenztexte liegen
 * daneben.
 */

/** Schnitte, die tatsaechlich als Datei vorliegen. Andere Gewichte wuerde der Browser faelschen. */
const REQUIRED_FACES: readonly string[] = [
  '500 16px "Chakra Petch"',
  '700 16px "Chakra Petch"',
  '400 16px "JetBrains Mono"',
  '700 16px "JetBrains Mono"',
];

/**
 * Obergrenze fuer das Warten auf die Schriften. Eine langsame oder fehlende Datei darf den
 * Spielstart nicht aufhalten – der monospace-Fallback in `uiTheme` traegt die Oberflaeche dann
 * so lange, bis `whenUiFontsReady` nachrastert.
 */
const LOAD_TIMEOUT_MS = 1500;

let loadPromise: Promise<boolean> | null = null;

function hasFontLoadingApi(): boolean {
  return typeof document !== 'undefined' && 'fonts' in document;
}

/**
 * Startet das Laden aller Schnitte. Mehrfachaufrufe liefern dieselbe Zusage.
 *
 * Loest **nie** aus – der Rueckgabewert sagt lediglich, ob alle Schnitte rechtzeitig da waren.
 */
export function loadUiFonts(timeoutMs: number = LOAD_TIMEOUT_MS): Promise<boolean> {
  if (loadPromise) return loadPromise;
  if (!hasFontLoadingApi()) {
    loadPromise = Promise.resolve(false);
    return loadPromise;
  }

  const allFaces = Promise.all(REQUIRED_FACES.map((face) => document.fonts.load(face)))
    .then(() => REQUIRED_FACES.every((face) => document.fonts.check(face)))
    .catch(() => false);

  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });

  loadPromise = Promise.race([allFaces, timeout]);
  return loadPromise;
}

/**
 * Ruft `callback` auf, sobald die Schriften geladen sind – oder sofort, wenn sie es bereits
 * waren. Zusaetzlich einmal nach `document.fonts.ready`, weil ein Schnitt auch nach dem
 * Zeitlimit noch eintreffen kann und die bis dahin gerasterten Texte dann falsch aussaehen.
 *
 * Gibt eine Abmeldefunktion zurueck; nach dem Abmelden feuert `callback` nicht mehr.
 */
export function whenUiFontsReady(callback: () => void): () => void {
  let cancelled = false;
  const run = (): void => {
    if (!cancelled) callback();
  };

  if (!hasFontLoadingApi()) return () => { cancelled = true; };

  void loadUiFonts().then(run);
  // `fonts.ready` erfuellt sich, wenn keine Ladevorgaenge mehr offen sind. Der zweite Aufruf ist
  // billig: `reRasterAllText` prueft je Text, ob sich ueberhaupt etwas geaendert hat.
  void document.fonts.ready.then(run).catch(() => undefined);

  return () => { cancelled = true; };
}

/** Nur fuer Tests: verwirft die zwischengespeicherte Zusage. */
export function resetUiFontsForTesting(): void {
  loadPromise = null;
}
