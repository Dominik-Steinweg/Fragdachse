# Testpolicy

## Zweck und Schutzwert

Tests schützen langlebiges Verhalten, fachliche Regeln, Netzwerk-/Persistence-Verträge und
Architekturgrenzen. Sie sind keine zweite Quelle für aktuelle authored Konfiguration und kein
Archiv vergangener Implementierungsstände. Vor jedem neuen oder geänderten Test sind vier Fragen
zu beantworten:

1. Welche konkrete Regression wird verhindert?
2. Ist die Aussage dauerhaft und fachlich oder technisch notwendig?
3. Ist dies die kleinste sinnvolle Testebene?
4. Wird authored Tuning oder zufällige Implementierungsform doppelt festgeschrieben?

Bestehende passende Tests werden bevorzugt erweitert. Mehr Tests oder eine höhere Testzahl sind
kein Qualitätsziel.

## Source- und Architecture-Tests

Production-Source-Reads werden nach ihrem Schutzwert beurteilt:

- **B – Verhalten:** Der Test schützt Verhalten nur indirekt über Source-Text. Nach Möglichkeit
  in einen Runtime-/Behavior-Test überführen; ohne eigenständige Regression löschen.
- **R – dauerhafte Architektur:** Eine stabile Ownership-, Dependency- oder Boundary-Regel darf
  in einer kleinen Architecture-Suite bleiben. Negative Regeln und schrumpfbare Allowlists sind
  robuster als vollständige historische Listen.
- **S – historischer Zwischenstand:** Phase-, Cutover-, Migrations- oder private
  Implementierungsform ohne heutigen Vertrag wird gelöscht.

Exakte private Methodennamen, Source-Reihenfolgen und alte Dateipfade sind nur dann geschützt,
wenn genau diese Form selbst ein dauerhaftes, nicht anders prüfbares Architekturverhalten ist.
Compiler, öffentliche Types, Validatoren und vorhandene Runtime-Tests werden vor einem neuen
Source-Scanner geprüft.

## Config, Content und Visuals

Normale Tests prüfen die Beziehung `Config/Content → Runtime → Ergebnis`, nicht dieselbe
Konfiguration als Literalsnapshot. Sinnvoll sind Struktur, IDs, Rollen, erlaubte Zustände,
Referenzen, endliche Werte und Resolver-/Parity-Verträge. Aktuelle HP-, Damage-, Radius-,
Cooldown-, Range-, Speed-, Modifier-, Salven-, Koordinaten-, Spawnanzahl-, Itemlevel- und
Progressionswerte gehören in authored Config, Validatoren oder das Balance-Lab.

Visuelle Tests dürfen Asset-Existenz, Dateiformat, Ownership, deterministische Geometrie,
Render-Lifecycle und lesbarkeitsrelevante Semantik schützen. Exakte Farben, Alphas, Partikel-
und Effektzahlen, Dauern oder andere ästhetische Feintuningwerte werden im Core nicht unnötig
eingefroren. Eine Paritätsprüfung zur aktuellen Config ist im Balance-Lab ausdrücklich zulässig.

Beispiele:

- schlecht: `expect(attack.salvo.count).toBe(12)` in einem normalen Combat-Test;
- gut: `expect(shots).toHaveLength(attack.salvo.count)` und ein Verhaltenstest für den Salven-
  Ablauf;
- schlecht: `source.toContain('private ...')` als Beleg für einen internen Umbau;
- gut: einen öffentlichen Runtime-Vertrag über Zustand, Ergebnis oder Teardown prüfen.

## Runner und Verzeichnisgrenzen

| Zweck | Runner | Inhalt |
|---|---|---|
| Core | `npm test` | schnelle, headless und deterministische Runtime-/Regeltests ohne Spezial-Harnesses |
| Architecture | `npm run test:architecture` | wenige dauerhafte Source-/Dependency-Grenzen |
| Integration | `npm run test:integration` | modulübergreifende World-, Activity- und Composition-Verträge |
| Assets | `npm run test:assets` | Dateisystem-, Asset-, Pixel- und Maskenprüfungen |
| Stress | `npm run test:stress` | große Inputs, Multi-Seed, Benchmarks und Belastungstests |
| Balance Lab | `npm run test:balance-lab` | Weapon-Balance-, Progression- und Benchmark-Parität zur aktuellen Config |

Die Spezial-Suites liegen unter `tests/architecture/`, `tests/integration/`, `tests/assets/`,
`tests/stress/` und `tests/balance-lab/`. `npm run check` bleibt das tägliche Gate aus Core und
Build; die Spezial-Suites werden gezielt für ihre Änderung ausgeführt. Browser, Dev-Server und
Sichtprüfung gehören nicht zum normalen Test-Gate.

## Mocks und Reduktion

Phaser-Mocks sind zulässig, wenn die getestete Logik ohne Renderer sinnvoll isoliert werden kann.
Mock- und Spy-Assertions sollen Ergebnisse, Zustandsübergänge und echte semantische Ports prüfen.
Positions- oder Call-Shape-Assertions bleiben nur dort, wo die Argumente selbst ein stabiler
Netzwerk-, Lifecycle- oder Renderer-Vertrag sind. Zufällige Hilfsobjekt-Form und interne
Aufrufreihenfolge sind kein eigener Schutzwert.

Vor dem Löschen, Zusammenführen oder Verschieben eines Tests:

1. den konkreten Schutzwert und die geschützte Regression benennen;
2. Compiler, Types, Validatoren und bestehende Tests auf Ersatzschutz prüfen;
3. bei echtem Vertrag die kleinste notwendige Assertion behalten oder migrieren;
4. fokussierten Test und den passenden Runner ausführen;
5. bei einem Refactoring-Cluster `04_Test_Refactoring_Migration_Status.md` aktuell halten.

Ein Test darf entfallen, wenn er nur eine historische Sourceform, doppeltes Verhalten, aktuelles
Visual-/Balance-Tuning oder eine bereits vollständig garantierte Type-/Validator-Aussage schützt.
