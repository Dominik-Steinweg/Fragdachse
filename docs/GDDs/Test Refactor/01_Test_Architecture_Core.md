# Fragdachse – Test Architecture Core

**Status:** Normative Testarchitektur – bei jeder Test-Refactoring-Phase zu laden  
**Geltungsbereich:** automatisierte Tests, Test-Suites, Architektur-Ratchets, authored Content, Visual-/Asset-Checks, Stress-/Integrationstests und AI-Testregeln  
**Detaildokument:** `02_Test_Architecture_Details.md`

> Dieses Dokument ist die kompakte, immer zu ladende Zielarchitektur.  
> `02_Test_Architecture_Details.md` präzisiert Sonderfälle und Testkategorien.  
> `03_Test_Refactoring_Implementation_Plan.md` legt nur die Migrationsreihenfolge fest und darf diese Architektur nicht überschreiben.  
> `04_Test_Refactoring_Migration_Status.md` ist ein temporäres Arbeitsprotokoll und enthält nur den aktuell handlungsrelevanten Stand.

---

## 1. Zweck

Das Test-Refactoring soll die Testsuite von historisch gewachsener Implementierungs-, Tuning- und Migrationskopplung zu einer **dauerhaften, schnellen und KI-freundlichen Regression-Suite** umbauen.

Zentraler Grundsatz:

> **Ein Test soll unerlaubte Verhaltensänderungen verhindern, nicht erlaubte Änderungen erschweren.**

Ziele:

1. `npm test` ist ein schneller, aussagekräftiger Daily Gate.
2. Ein roter Core-Test bedeutet mit hoher Wahrscheinlichkeit eine echte Regression oder Vertragsverletzung.
3. Mutable Balance-, Content- und Visual-Tuningwerte werden nicht als zweite Wahrheit dupliziert.
4. Historische Refactoring-Ratchets bleiben nicht unbegrenzt Teil der Regression-Suite.
5. Schwere und spezialisierte Prüfungen behalten ihren Wert, blockieren aber nicht jede normale Änderung.
6. Die Testanzahl darf und soll sinken, wenn redundanter oder wertloser Ballast entfernt wird.
7. Gute fachliche, technische, Netzwerk-, Persistenz- und Lifecycle-Verträge bleiben geschützt.

---

## 2. Zehn Kernprinzipien

1. **Test nach Vertrag, nicht nach Implementierung.**  
   Bevorzugt werden Verhalten, Invarianten, Zustandsübergänge, Beziehungen, Bounds und Fehlersemantik.

2. **Ein Test braucht einen benennbaren Schutzwert.**  
   Vor einem neuen oder behaltenen Test muss erklärbar sein, welche unerlaubte Regression er verhindert.

3. **Authored Tuning ist keine zweite Test-Wahrheit.**  
   Damage, HP, Range, Cooldown, Geschwindigkeit, Wahrscheinlichkeit, Modifier-Stärke, Dauer, Koordinaten und vergleichbare Werte werden nicht unabhängig im Test festgeschrieben.

4. **Exakte Zahlen sind erlaubt, wenn ihre Exaktheit selbst Vertrag ist.**  
   Dazu gehören Test-Fixtures, Format-/Protokollwerte, technische Bounds oder ausdrücklich stabile Fachsemantik.

5. **Source-Tests sind Ausnahme, nicht Standard.**  
   Quelltext-Scans schützen nur dauerhafte Architekturgrenzen, nicht private Methoden, heutige Call-Shapes oder historische Quellorte.

6. **Refactoring-Ratchets sind temporär.**  
   Nach dem Cutover wird ihr echter Schutzwert in Behavior-/Architecture-Tests überführt oder die Ratchet gelöscht.

7. **Verbesserungen dürfen Legacy-Ratchets nicht brechen.**  
   Legacy-Allowlisten sind schrumpfbar: neue Verstöße sind verboten, entfernte Verstöße bleiben grün.

8. **Schwere Tests laufen im passenden Gate.**  
   Stress, große Integration, Pixel-/Assetanalyse und Balance-Lab gehören nicht automatisch in `npm test`.

9. **Der kleinste sinnvolle Test gewinnt.**  
   Eine pure Regel wird nicht über Arena/Scene/Phaser getestet, wenn ein direkter Rule-/Runtime-Test denselben Vertrag präziser schützt.

10. **Weniger, bessere Tests sind ausdrücklich zulässig.**  
    Redundanz, Historie, Implementation Shape und frei veränderbares Tuning dürfen entfernt werden, auch wenn dadurch die Gesamtzahl der Tests deutlich sinkt.

---

## 3. Zielstruktur der Test-Suites

```text
tests/
  ... schnelle normale Regressionstests ...

  architecture/
  integration/
  assets/
  stress/
  balance-lab/
```

Die physische Struktur darf pragmatisch an den Bestand angepasst werden. Normale Core-Tests müssen nicht massenhaft verschoben werden.

### `npm test`

Schneller Daily Gate für:

- pure Rules und Policies;
- normale Runtime-/State-Machine-Tests;
- Network-/Codec-/RPC-Verträge;
- Persistence-/Migration-Verträge;
- kleine Content-/Reference-Validatoren;
- kleine Lifecycle-/Ownership-Behavior-Tests;
- normale Regressionen.

Nicht enthalten:

- Weapon Balance Lab;
- Large-Arena-/Multi-Seed-Stress;
- teure Pixel-/Assetanalyse;
- große Campaign-/World-Materialization-Integration;
- hardwareabhängige Performance-Benchmarks.

### Spezialisierte Suites

- `npm run test:architecture`
- `npm run test:integration`
- `npm run test:assets`
- `npm run test:stress`
- `npm run test:balance-lab`

`npm run check` bleibt ein schneller Entwicklungs-Gate aus Core-Tests + Build.  
Ein vollständiger Refactoring-Abschluss darf zusätzlich alle spezialisierten Suites ausführen.

---

## 4. Fünf Entscheidungen für bestehende Tests

| Klasse | Bedeutung | Ziel |
|---|---|---|
| **KEEP** | langlebiger Vertrag, angemessene Testebene | behalten |
| **REWRITE** | Schutzwert gut, Testform fragil | robuster testen |
| **CONSOLIDATE** | mehrfach dieselbe Grenze geschützt | zusammenführen |
| **MOVE** | wertvoll, aber falscher Runner | Spezialsuite |
| **DELETE** | Historie, Tuning, Implementation Shape oder Redundanz ohne ausreichenden Schutzwert | entfernen |

Wichtig:

> **Ein Test wird nicht allein deshalb KEEP, weil er einen „echten Vertrag“ behauptet.**  
> Auch der Vertrag selbst wird auf Relevanz, Risiko, Redundanz und Kosten/Nutzen geprüft.

---

## 5. Was Core-Tests schützen sollen

Typisch langlebig:

- fachliche Regeln;
- hostautoritative Entscheidungen;
- Duplicate-/Retry-/Stale-Semantik;
- Lifecycle und Teardown;
- State-Machine-Transitions;
- Network-/Wire-/Snapshot-Kompatibilität;
- Persistenzvalidierung und Migration;
- Determinismus, wenn fachlich erforderlich;
- Referenz- und Schema-Validität;
- echte mathematische Beziehungen;
- Safety-/Technical Bounds;
- bewusst etablierte Architekturgrenzen.

Typisch nicht langlebig:

- konkrete Balancewerte;
- authored Map-Koordinaten und Zählwerte;
- exakte Visual-Tuningwerte;
- private Methodennamen;
- konkrete Source-Reihenfolgen ohne eigenständige Semantik;
- historische Refactoring-Phasen;
- exakte UI-Copy ohne fachliche Bedeutung;
- redundante Wiederholungen desselben Vertrags.

---

## 6. Authored Content und Tuning

Leitfrage:

> **Kann dieser Wert beim Balancing, Content-Authoring oder visuellen Feintuning geändert werden, ohne dass sich die Mechanik semantisch ändert?**

Wenn ja, soll ein normaler Test ihn nicht als zweite Wahrheit hardcoden.

Statt:

```text
expect(config.damage).toBe(8)
expect(shots).toHaveLength(12)
```

bevorzugt:

```text
expect(shots).toHaveLength(config.salvo.count)
expect(result.damage).toBe(config.damage)
```

oder noch besser eine fachliche Relation / Invariante.

Exakte `0`, `1` oder andere Zahlen bleiben zulässig, wenn genau diese Zahl die Mechanik definiert, z. B. eine ausdrücklich nicht schadende Support-Waffe mit `damage === 0`.

---

## 7. Source- und Architecture-Tests

Dauerhaft zulässige Source-Checks sind wenige, bewusst benannte Boundary-Regeln, z. B.:

- verbotener Import einer höheren Schicht;
- direkter Zugriff auf ein Transport-Singleton;
- direkter Kamera-/Zeit-Writer außerhalb des Owners;
- neue Leaks durch eine explizit geschützte Schichtgrenze.

Nicht dauerhaft schützen:

- konkrete private Methodennamen;
- exakte Methodenreihenfolge im Source;
- exakte Konstruktor-/Call-Syntax;
- historische Quellorte;
- „diese Klasse muss genau diese Zeichenkette enthalten“.

Wo möglich, Verhalten direkt testen.

---

## 8. Temporäre Migration-Ratchets

Während eines großen Refactorings darf eine Ratchet bewusst Implementation Shape schützen.

Dann gelten zwei Pflichten:

1. Sie muss als **temporär** erkennbar sein.
2. Ihr Exit-Kriterium muss klar sein.

Nach Abschluss:

- echtes Verhalten → Behavior-/Runtime-Test;
- dauerhafte Architekturgrenze → Architecture-Gate;
- historischer Quellort/Zwischenzustand → DELETE.

Phase-Namen wie `Phase 8`, `Phase 11B` oder `Cutover` sind nach Abschluss kein eigener Testvertrag.

---

## 9. Abgrenzung spezialisierter Tests

### Weapon Balance Lab

Balance-Lab-Tests testen das Analysewerkzeug, Szenarien, Determinismus, Reports, Storage und Parität zur aktuellen Spielkonfiguration.

Sie dürfen aktuelle Config-Werte konsumieren, definieren aber **nicht die gewünschte Balance**.

### Visuals

Automatisiert schützen:

- Lifecycle;
- finite Werte;
- gültige Bounds;
- Cleanup;
- korrekte Verdrahtung;
- deterministische technische Ableitungen, falls erforderlich.

Nicht standardmäßig schützen:

- exakte Alpha-/Glow-/Farb-/Partikel-/Dauerwerte aus rein ästhetischem Tuning.

### Assets

Existenz, Format, Referenzintegrität und technisch nötige Dimensionen können Verträge sein. Teure Pixelanalysen gehören in `test:assets`.

### Stress / Performance

Stress-Harnesses und große Generatorläufe gehören in `test:stress`.  
Hardwareabhängige Millisekundenwerte sind kein normaler Regression-Gate, sofern kein expliziter technischer Vertrag existiert.

---

## 10. Scope und No-Gos

Dieses Refactoring darf:

- Tests löschen, umschreiben, konsolidieren und verschieben;
- Runner-/Suite-Struktur anpassen;
- minimale behavior-neutrale Produktionscodeänderungen für bessere Testbarkeit durchführen;
- kleine Request-/Port-/Pure-Rule-Extraktionen nutzen, wenn sie ausschließlich einen vorhandenen Vertrag besser testbar machen;
- AI-Dokumentation und Skills anpassen.

Nicht Bestandteil:

- Gameplay- oder Balanceänderungen;
- Projectile-/Combat-Architekturrefactoring;
- UI-/VFX-Redesign;
- neue Testframeworks ohne klaren Bedarf;
- flächendeckende Produktionscode-Extraktion nur „für Testbarkeit“;
- Coverage-Zielwerte als Selbstzweck;
- eine künstliche Mindestanzahl verbleibender Tests.

---

## 11. Globale Abnahme-Gates

Das Refactoring gilt als erfolgreich, wenn:

1. `npm test` ein schneller, fokussierter Core-Gate ist.
2. `npm run check` keine Stress-/Balance-Lab-/teuren Assetläufe implizit startet.
3. Die lange dateispezifische Exclude-Liste aus `package.json` entfällt.
4. Historische Source-/Phase-Ratchets sind entfernt oder in sinnvolle Verträge überführt.
5. Source-Scans schützen nur wenige dauerhafte Architekturgrenzen.
6. Legacy-Allowlisten dürfen ohne Teständerung schrumpfen.
7. Mutable Config-/Balance-/Visual-Werte werden in normalen Tests nicht unnötig dupliziert.
8. Schwere Integration, Assets, Stress und Balance-Lab besitzen klare Runner.
9. Die Testanzahl ist durch Entfernung von Ballast reduziert, ohne wichtige Regressionen preiszugeben.
10. `docs/ai/testing.md` ist die kanonische Testpolicy; `AGENTS.md` bleibt kurz.

---

## 12. Dokumentenrollen

```text
01 Test Architecture Core
        +
02 Test Architecture Details
        │
        ▼
03 Test Refactoring Implementation Plan
        │
        ▼
04 Test Refactoring Migration Status
```

- **01 + 02** bilden gemeinsam die normative Zielarchitektur.
- **03** beschreibt Reihenfolge, Scope und Gates.
- **04** enthält nur den handlungsrelevanten Zwischenstand.
- Coding-KIs dürfen während der Umsetzung `04` fortschreiben, `01`–`03` aber nicht selbständig umdefinieren.
