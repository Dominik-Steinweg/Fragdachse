# Fragdachse – Test Architecture Details

**Status:** Normative Detailverträge / gezielt zu laden  
**Core-Dokument:** `01_Test_Architecture_Core.md`

> Immer zuerst `01_Test_Architecture_Core.md` lesen.  
> Für eine Implementierungsphase werden nur die in `03_Test_Refactoring_Implementation_Plan.md` referenzierten Abschnitte dieses Dokuments zusätzlich geladen.

---

## 1. Router für Coding-KIs

| Aufgabe | zusätzlich laden |
|---|---|
| Runner-/Suite-Trennung | §§ 3, 11, 12 |
| Source-/Architecture-Ratchets | §§ 4–6 |
| Config-/Content-/Balance-Kopplung | §§ 7–8 |
| Visual-/UI-/VFX-Tests | §§ 8–9 |
| Asset-/Pixeltests | § 9 |
| Integration-/Stress-/Benchmarktests | §§ 9–11 |
| Mock-/Spy-/Testform-Bereinigung | § 10 |
| AI-Testpolicy / neue Tests | §§ 2, 12–15 |
| Abschlussreview | §§ 2–15 |

---

## 2. Schutzwert vor Testbestand

Die Existenz eines Tests ist kein Beweis, dass er dauerhaft wertvoll ist.

Für jeden problematischen Test werden vier Fragen in dieser Reihenfolge gestellt:

1. **Welche unerlaubte Regression verhindert er?**
2. **Ist diese Regression heute noch relevant?**
3. **Ist sie bereits auf einer besseren Ebene geschützt?**
4. **Sind Wartungs- und Laufzeitkosten dafür angemessen?**

Erst danach folgt `KEEP / REWRITE / CONSOLIDATE / MOVE / DELETE`.

### 2.1 Echte Verträge ebenfalls kritisch prüfen

Ein technisch realer Vertrag kann trotzdem keinen eigenen Regressionstest rechtfertigen, wenn:

- der Compiler/Type bereits ausreichend schützt;
- ein zentraler Validator ihn vollständiger schützt;
- ein höherwertiger Behavior-Test dieselbe Regression abdeckt;
- die Wahrscheinlichkeit und Auswirkung einer Regression sehr gering ist;
- der Test selbst stark implementation-gekoppelt ist und kaum zusätzlichen Schutz bietet.

Ziel ist nicht maximale Testabdeckung, sondern **hoher Schutzwert pro Test**.

---

## 3. Testebenen

### 3.1 Pure Rule / Policy

Bevorzugte Ebene für:

- mathematische Regeln;
- Zustandsübergänge;
- Capability-Auflösung;
- Validierung;
- Merge-/Priority-Regeln;
- Identifier-/Parserlogik.

Synthetische Zahlen sind hier ausdrücklich gute Fixtures.

### 3.2 Runtime / State Owner

Bevorzugt für:

- Lifecycle;
- stale state;
- exact-once;
- Attach/Detach;
- Cooldown-/State-Machine-Semantik;
- deterministische Zeit;
- Outcome-/Reaction-Verhalten.

### 3.3 Integration

Nur wenn die **Zusammenarbeit mehrerer realer Owner** selbst der Vertrag ist.

Nicht eine komplette World materialisieren, um eine Pure Function zu testen.

### 3.4 Architecture

Statische Boundary-Regeln, die über Runtime-Verhalten nur schwer oder nicht zuverlässig abzusichern sind.

Architecture-Tests sind wenige Querschnittsregeln, keine zweite Beschreibung des Sourcecodes.

---

## 4. Source-Test-Kategorien

### 4.1 B – Verhalten, zufällig über Source getestet

Beispielmuster:

- Replay darf keinen Continue-Callback auslösen.
- Input-Handoff darf gehaltenen UI-Press nicht ins Gameplay leaken.
- Exit-Fade darf erst nach Gameplay-Ende beginnen.

Aktion:

> **REWRITE** auf Behavior-/Runtime-Ebene, wenn sinnvoll und notwendig.

### 4.2 R – dauerhafte Architekturgrenze

Beispielmuster:

- Domain darf `network/bridge` nicht importieren.
- Kamera-Shake entsteht nur im Camera-Owner.
- eine definierte Schicht darf keinen höheren Runtime-Context kennen.

Aktion:

> **KEEP oder CONSOLIDATE** in `test:architecture`.

### 4.3 S – historischer Source-Ort / Migration Shape

Beispielmuster:

- `ArenaScene.update()` muss exakt bestimmte Strings in bestimmter Reihenfolge enthalten.
- eine private Methode muss exakt einen bestimmten Namen besitzen.
- eine alte Fassade muss aus genau dieser Datei verschwunden sein.
- „Phase 11B“-Zwischenstand muss exakt der damaligen Migration entsprechen.

Aktion:

> **DELETE**, sobald kein anderer echter Vertrag daran hängt.

Diese B/R/S-Denkweise gilt unabhängig vom Dateinamen.

---

## 5. Dauerhafte Architecture-Ratchets

Ein Architecture-Ratchet soll bevorzugt eine **negative Regel** ausdrücken:

```text
Kein Domain-Code importiert network/bridge.
```

statt eine positive Implementierungsform:

```text
RpcCoordinator enthält genau Port A, B, C und Methode X.
```

### 5.1 Schrumpfbare Legacy-Allowlist

Falls Altbestand vorübergehend Ausnahmen benötigt:

```text
actualViolations ⊆ allowedLegacyViolations
```

Erlaubt:

- bestehende Ausnahme bleibt;
- Ausnahme verschwindet;
- Liste wird später verkleinert.

Nicht erlaubt:

- neue Ausnahme entsteht.

Nie:

```text
actualViolations === frozenHistoricalList
```

wenn das Entfernen einer Legacy-Abhängigkeit eine Verbesserung ist.

### 5.2 Konsolidierung

Mehrere Tests, die denselben Sourcebaum wiederholt traversieren, sollen möglichst einen gemeinsamen Helper bzw. einen fokussierten Architecture-Gate nutzen.

Kein großes generisches Architekturframework einführen; ein kleiner Dateiscan-/Dependency-Helper genügt.

---

## 6. Temporäre Refactoring-Ratchets

Neue Migration-Ratchets dürfen eingesetzt werden, wenn ein laufender Cutover sonst leicht zurückfällt.

Pflichtkommentar:

- welche Migration sie schützt;
- warum Behavior-Test noch nicht genügt;
- wann sie entfernt oder umgewandelt wird.

Spätestens im Final-Cleanup des jeweiligen Refactorings muss entschieden werden:

```text
Behavior → REWRITE
Architecture → KEEP/CONSOLIDATE
Historie → DELETE
```

Eine temporäre Ratchet darf nicht allein durch Vergessen dauerhaft werden.

---

## 7. Authored Content: Struktur vs. Tuning

### 7.1 Typisch testwürdige Struktur

- Referenz-ID existiert;
- Typ/Capability ist zulässig;
- Upgrade-Graph ist gültig;
- benötigtes Objekt existiert;
- Map-/Activity-Definition kann aufgelöst werden;
- Zahlen sind finite und technisch valide;
- ein Content-Element erfüllt eine fachliche Rolle.

### 7.2 Typisch nicht als zweite Wahrheit testen

- HP;
- Damage;
- Radius;
- Cooldown;
- Range;
- Speed;
- Modifier-Prozentwerte;
- Salvenanzahl;
- konkrete Map-Koordinaten;
- authored Spawnzahl;
- Item-/Map-Level;
- konkrete Progressionstuningwerte.

### 7.3 Relative Tests

Wenn aktuelles Tuning für das Verhalten notwendig ist:

```text
config → Runtime → Ergebnis
```

und nicht:

```text
Test-Literal → Runtime → Ergebnis
```

Beispiel:

```ts
expect(fired).toHaveLength(config.salvo.count);
```

statt:

```ts
expect(fired).toHaveLength(12);
```

### 7.4 Generische Validatoren bevorzugen

Ein guter zentraler Content-Validator kann dutzende Einzeltests ersetzen, die lediglich dieselbe Referenz-/Bounds-Regel pro konkretem Content-Element wiederholen.

---

## 8. Fachliche Konstante vs. Tuningwert

Eine Zahl ist nicht allein deshalb Vertrag, weil sie als `const` im Source steht.

Prüfkriterien:

### Fachliche/technische Konstante

Eine Änderung würde die Mechanik, das Format oder eine technische Invariante ändern.

Beispiele:

- Support-Waffe verursacht definitionsgemäß `0` direkten Schaden;
- RGB-Pixel benötigt exakt drei Bytes;
- Protokoll-/Formatversion;
- Bitmasken-/Enum-Semantik;
- mathematisch notwendige Normierung.

### Mutable Tuning

Eine Änderung justiert Stärke, Pacing, Darstellung oder Content, ohne die Mechanik zu ändern.

Beispiele:

- 10 statt 12 Projektile;
- 8 statt 10 Damage;
- 7000 statt 6000 ms;
- 0.58 statt 0.62 Alpha;
- 1650 statt 1800 Base HP.

Im Zweifel wird die Zahl **nicht** als eigene Test-Wahrheit behandelt.

---

## 9. Visual-, Asset-, Integration- und Stress-Tests

### 9.1 Visual-Tuning

Automatisiert sinnvoll:

- finite Werte;
- Bounds;
- Cleanup;
- Lifecycle;
- korrekte Pfade;
- deterministische Transformation;
- technisch nötige Reihenfolge.

Typisch löschen/umbauen:

- exakte rein ästhetische Farben im Source;
- exakte Glow-/Alpha-/Shockwave-Stärke;
- Partikelgröße nur als Style-Snapshot;
- private Renderer-Methoden als String.

### 9.2 Asset-Integrität

Sinnvoll:

- referenzierte Datei existiert;
- Texture-/Mask-Dimension technisch kompatibel;
- Registry und Dateien stimmen zusammen;
- technisch notwendige Alpha-/Mask-Invariante.

Teure Bilddekodierung/Pixel-Loops → `test:assets`.

### 9.3 Integration

`test:integration` für z. B.:

- echte World-/Activity-Materialization;
- Campaign-/Map-Zusammenspiel;
- mehrere reale Owner, deren Composition selbst Regression-Risiko besitzt.

Einzelne pure Teile derselben Datei sollen, wenn sinnvoll, in Core-Tests getrennt werden.

### 9.4 Stress

`test:stress` für:

- Large Arena;
- viele Seeds;
- hohe Entity-/Grid-Mengen;
- Benchmarks;
- Generator-Stress.

Performancewerte dürfen geloggt werden, aber nicht als hardwareabhängige Millisekunden-Grenze failen, solange keine explizite technische SLO existiert.

---

## 10. Mock-, Spy- und UI-Tests

### 10.1 Positional Call Shape

Fragil:

```ts
expect(call[19]).toEqual(...)
```

Besser, wenn ohne unverhältnismäßigen Produktionsumbau möglich:

- Request-Objekt;
- semantischer Port;
- `toMatchObject`;
- direkte Outcome-Prüfung.

Aber:

> Das Test-Refactoring ist kein Auftrag, jede bestehende positional API allein für schönere Tests umzubauen.

Nur anfassen, wenn der Wartungsnutzen klar ist.

### 10.2 Exakte UI-Copy

Wortlaut nur exakt testen, wenn er selbst Vertrag ist.

Sonst bevorzugen:

- Translation-Key vorhanden;
- Text nicht leer;
- Parameter ersetzt;
- fachlich erwartete Information vorhanden.

### 10.3 Phaser-Mocks

Phaser-Mocks sind zulässig, wenn die getestete Logik ohne echten Renderer sinnvoll isolierbar ist.

Nicht versuchen, visuelle Qualität über immer detailliertere Phaser-Mocks zu beweisen.

---

## 11. Runner-Semantik

### Core

`npm test`

- schnell;
- deterministisch;
- häufig;
- kein Browser;
- keine großen Asset-/World-Harnesses.

### Architecture

`npm run test:architecture`

- wenige Source-/Dependency-Regeln;
- darf Sourcebaum scannen;
- soll schnell bleiben.

### Integration

`npm run test:integration`

- echte modulübergreifende Composition;
- darf merklich langsamer sein.

### Assets

`npm run test:assets`

- Dateisystem;
- Jimp/Sharp;
- Pixel-/Maskenprüfung.

### Stress

`npm run test:stress`

- große Inputs;
- Multi-Seed;
- Benchmarks/Stress.

### Balance Lab

`npm run test:balance-lab`

- Weapon Balance Lab;
- Progression-/Benchmark-Harnesses;
- Parität zur aktuellen Config ist legitim.

### `npm run check`

Soll als Daily Gate Core-Tests + Build enthalten.  
Spezialsuites werden nicht automatisch Teil jeder normalen Produktivänderung.

---

## 12. Dateiorganisation und npm-Skripte

Spezialisierte Tests sollen über Verzeichnis-/Pattern-Struktur adressiert werden, nicht über lange Listen einzelner `--exclude`-Dateien.

Bevorzugt:

```text
tests/architecture/**/*.test.ts
tests/integration/**/*.test.ts
tests/assets/**/*.test.ts
tests/stress/**/*.test.ts
tests/balance-lab/**/*.test.ts
```

Die konkrete Vitest-CLI darf an vorhandene Möglichkeiten angepasst werden.

Keine neue CI-/Test-Infrastruktur allein aus Symmetriegründen.

---

## 13. Minimale Produktionscodeänderungen

Erlaubt, wenn behavior-neutral und klar nützlich:

- kleine Pure Rule extrahieren;
- vorhandenen Request als Objekt ausdrücken;
- schmalen Read-/Command-Port exponieren;
- nicht-exportierte Logik gezielt testbar machen, wenn sie einen echten Vertrag besitzt.

Nicht erlaubt:

- neue Domain-Architektur nur für Tests;
- große Facades;
- Service Locator;
- Test-only Produktivpfade;
- Gameplay-/Balanceänderungen.

Wird bei der Bereinigung ein echter Produktionsbug sichtbar, darf er nur lokal behoben werden, wenn Ursache und Sollverhalten eindeutig sind. Größere fachliche Änderungen werden als Follow-up dokumentiert.

---

## 14. Redundanz und Testanzahl

Mehr Tests sind kein Qualitätsziel.

Löschen oder zusammenführen, wenn:

- derselbe Vertrag mehrfach auf fast identische Weise geprüft wird;
- Validator + Einzeltests dieselbe Regel duplizieren;
- Integrationstest und Unit-Test keinen unterschiedlichen zusätzlichen Schutz liefern;
- Test nur vergangene Bug-Implementierung statt fachliche Regression schützt;
- Compiler/Type-System die Aussage bereits vollständig garantiert.

Die Gesamtzahl soll nach dem Refactoring **spürbar sinken, wenn die Analyse entsprechenden Ballast bestätigt**. Es gibt aber keine Zielquote.

---

## 15. Regeln für neue Tests nach dem Refactoring

Vor einem neuen Test:

1. Welche konkrete Regression verhindere ich?
2. Ist sie langlebig?
3. Ist der Test die kleinste sinnvolle Ebene?
4. Dupliziere ich authored Tuning?
5. Dupliziere ich einen Validator oder vorhandenen Test?
6. Teste ich Verhalten oder Implementation Shape?
7. Benötige ich wirklich Source-Inspection?
8. Gehört der Test in Core oder eine Spezialsuite?
9. Kann ich einen bestehenden Test sinnvoll erweitern?
10. Sind Wartungs- und Laufzeitkosten gerechtfertigt?

Wenn keine klare Antwort auf 1 und 2 existiert, wird standardmäßig **kein neuer Test** erzeugt.
