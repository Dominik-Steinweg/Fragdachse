# Fragdachse – Test Refactoring: Implementierungsplan

**Status:** Planungsstand für das Test-Refactoring  
**Architekturvorgaben:** `01_Test_Architecture_Core.md` und `02_Test_Architecture_Details.md`  
**Laufendes Protokoll:** `04_Test_Refactoring_Migration_Status.md`

> Jede nummerierte Phase ist als eigenständiger Auftrag für eine Coding-KI geschnitten.  
> Die Umsetzung kann **phase-by-phase** oder durch einen **einzigen Orchestrator-Prompt** erfolgen.  
> Nach jeder vollständig abgeschlossenen Phase wird `04` aktualisiert und **genau ein Commit für diese Phase** erstellt.  
> `01`, `02` und `03` werden von Coding-KIs während der Umsetzung nicht selbständig umdefiniert.

---

## 1. Zweck und Zielzustand

Das Refactoring reduziert Testballast und trennt dauerhafte Regressionen von:

- historischem Refactoring-Shape;
- mutablem Config-/Balance-Tuning;
- visuellem Feintuning;
- schweren Integration-/Stress-/Asset-Harnesses;
- spezialisierten Balance-Lab-Tests.

Nach Abschluss:

1. `npm test` ist der schnelle Core-Gate.
2. `npm run check` bleibt für normale Entwicklung praktikabel.
3. Architecture, Integration, Assets, Stress und Balance Lab besitzen klare eigene Runner.
4. Lange dateispezifische Exclude-Listen sind entfernt.
5. Historische Source-Ratchets sind gelöscht oder sinnvoll migriert.
6. Mutable authored Werte werden nicht unnötig als zweite Wahrheit getestet.
7. Gute Rule-, Network-, Persistence-, Lifecycle- und Runtime-Regressionen bleiben erhalten.
8. Redundante und schwach begründete Tests wurden entfernt.
9. Die Testanzahl ist reduziert, soweit ohne relevanten Schutzverlust möglich.
10. `docs/ai/testing.md` verhindert eine erneute Akkumulation derselben Probleme.

---

## 2. Verbindliche Abgrenzung

### 2.1 Im Scope

- Analyse der gesamten Testsuite nach problematischen Testmustern;
- Runner-/Suite-Trennung;
- historische Source-/Phase-/Cutover-Ratchets;
- Architecture-Tests und Legacy-Allowlists;
- Config-/Content-/Balance-Kopplung normaler Tests;
- Visual-/VFX-/UI-Tuning-Snapshots;
- schwere Asset-/Pixeltests;
- schwere World-/Campaign-/Stress-/Benchmarktests;
- redundante Tests;
- fragiles Mock-/Spy-Testdesign, wenn sinnvoll behebbar;
- `AGENTS.md` + `docs/ai/testing.md` + Router/Dev-/Balance-Lab-Doku + Phaser-Skill.

### 2.2 Nicht im Scope

- Gameplay-/Balanceänderungen;
- Projectile-/Combat-Refactoring;
- UI-/VFX-Redesign;
- neue Coverage-Ziele;
- neue CI-Infrastruktur;
- Browser-/Sichtprüfung;
- flächendeckende Produktionscode-Umbauten nur für Tests;
- pauschales Löschen guter Tests zur Erreichung einer Zielanzahl.

---

## 3. Maßgebliche aktuelle Problemcluster

Die Coding-KI muss den aktuellen Repository-Stand erneut vollständig durchsuchen. Bereits bekannte Cluster dienen als Startpunkte, nicht als abgeschlossene Inventarliste.

### 3.1 Source-/Refactoring-Ratchets

Beispiele:

- `ArenaSceneFrameCutover.test.ts`
- `Phase11DependencyCutover.test.ts`
- `PlayerGameplayReadViewBoundary.test.ts`
- `WorldGameplayCompositionContracts.test.ts`
- weitere `readFileSync`-/`readdirSync`-basierte Contract-Tests
- historische `Phase`-/`Cutover`-/`Migration`-Tests

### 3.2 Config-/Content-Kopplung

Bekannte Kandidaten:

- `GraveTitanVoidPlasma.test.ts`
- `CoopDefenseInfernoColossusCombat.test.ts`
- `Ak47CoopDefenseUpgrades.test.ts`
- `PlasmaSwarm.test.ts`
- `CoopDefenseMaps.test.ts`
- `CoopDefenseItemStats.test.ts`
- `CoopDefenseRuntimeAffixWiring.test.ts`
- `InspectorSupportWeapons.test.ts`
- `CoopDefenseHostileBase.test.ts`

### 3.3 Gute Referenzmuster

Bei der Migration als Stilreferenz prüfen:

- `CoopDefenseEnemyScaling.test.ts`
- `CoopDefenseBurrowingEnemies.test.ts`
- `CoopDefenseEnemyVoidFireChunks.test.ts`
- `CoopDefenseTimebomb.test.ts`
- `ArmageddonUpgrades.test.ts`
- `FlamethrowerUpgrades.test.ts`
- `GeneralCriticalUpgrades.test.ts`

### 3.4 Schwere/spezialisierte Kandidaten

- `LargeArenaGeneration.test.ts`
- große Teile von `ArenaLoadingContracts.test.ts`
- schwere Map-/Campaign-Materialization
- Jimp-/Pixel-/Maskenprüfungen
- Weapon-Balance-Lab-/Progression-/Benchmarktests

Diese Listen müssen im Verlauf nicht vollständig in `04` kopiert werden. Dort stehen nur offene, handlungsrelevante Cluster.

---

## 4. Unverhandelbare Invarianten

### 4.1 Kein Schutzverlust durch blindes Löschen

Vor `DELETE` prüfen:

1. Was schützt die Assertion?
2. Ist dieser Schutz heute notwendig?
3. Ist er bereits anderswo abgedeckt?
4. Falls nötig: erst robusteren Ersatz schaffen, dann löschen.

### 4.2 Keine automatische Konservierung angeblicher Verträge

Auch echte Verträge werden auf Kosten/Nutzen geprüft.  
Nicht jede aktuelle API-, Content- oder Architekturentscheidung braucht einen eigenen Test.

### 4.3 Keine fachliche Änderung

Ein Test wird an den bestehenden dauerhaften Vertrag angepasst, nicht der Produktionscode an einen veralteten Test.

### 4.4 Behavior-neutraler Produktionscode

Minimale Änderungen für Testbarkeit sind erlaubt. Neue fachliche Architektur oder Featureänderungen nicht.

### 4.5 Keine Testzahl als Selbstzweck

Die Testanzahl soll sinken, wenn Ballast vorhanden ist. Es gibt keine Mindest- oder Zielquote.

### 4.6 `04` bleibt klein

`04` enthält:

- aktive Phase;
- Phasenstatus;
- letzter Gate;
- offene Testcluster / Risiken;
- handlungsrelevante Migrationskarte;
- Dokumentations-Follow-ups;
- nächsten Schritt.

`04` enthält **keine Commit-SHA-Felder** und keine chronologische Historie. Git ist die Commit-Historie.

---

## 5. Arbeitsweise

### 5.1 Vor jeder Phase

Lesen:

1. `01_Test_Architecture_Core.md`
2. die in der Phase referenzierten §§ aus `02_Test_Architecture_Details.md`
3. nur die aktuelle Phase dieses Plans
4. `04_Test_Refactoring_Migration_Status.md`
5. `AGENTS.md`
6. relevante `docs/ai/*`

Anschließend:

- Repository mit `rg`/Code Search nach den angegebenen Mustern durchsuchen;
- nur handlungsrelevante Kandidaten in `04` aufnehmen;
- vorhandene bessere Tests/Validatoren vor Neuimplementierung suchen.

### 5.2 Nach jeder Phase

1. vorgesehenen Gate ausführen;
2. `04` auf den neuen handlungsrelevanten Zustand kürzen/aktualisieren;
3. `01`–`03` nicht verändern;
4. genau **einen Commit** für die abgeschlossene Phase erstellen.

Wenn ein Gate nicht grün ist, wird die Phase nicht als abgeschlossen markiert und kein Abschluss-Commit erzeugt.

### 5.3 Sichtprüfung

Keine Browser-/Sichtprüfung für dieses Refactoring.

---

## 6. Ausführungsmodi

### 6.1 Phase-by-phase

Kurzprompt:

> Implementiere die nächste offene Phase aus `03_Test_Refactoring_Implementation_Plan.md` gemäß `01_Test_Architecture_Core.md`, den für die Phase referenzierten Abschnitten aus `02_Test_Architecture_Details.md` und `04_Test_Refactoring_Migration_Status.md`. Prüfe jeden zu löschenden oder umzubauenden Test auf tatsächlichen Schutzwert, führe den vorgesehenen Gate aus, aktualisiere danach nur `04` und erstelle bei grünem Gate genau einen Commit für die abgeschlossene Phase. Keine Sichtprüfung und kein Dev-Server.

### 6.2 Ein Orchestrator-Prompt für alle Phasen

> Führe das Test-Refactoring vollständig gemäß `01_Test_Architecture_Core.md`, `02_Test_Architecture_Details.md`, `03_Test_Refactoring_Implementation_Plan.md` und `04_Test_Refactoring_Migration_Status.md` durch. Arbeite alle offenen Phasen sequenziell ab. Nutze bei Bedarf Subagents für klar getrennte Testcluster, reviewe deren Ergebnisse aber zentral gegen die Testarchitektur. Vor jeder Löschung oder Migration den tatsächlichen Schutzwert prüfen; auch bestehende „echte Verträge“ nur behalten, wenn ein eigener Test sinnvoll und notwendig ist. Reduziere Ballast ausdrücklich, ohne wertvolle Regressionen zu verlieren. Nach jeder vollständig grünen Phase `04` aktualisieren und genau einen Commit für diese Phase erstellen. Keine Sichtprüfung und kein Dev-Server. Nach der letzten Phase alle definierten Test-Suites und den Build ausführen.

---

# 7. Implementierungsphasen

## Phase 1 – Baseline und handlungsrelevante Migrationskarte

**Detailverträge:** §§ 2–4, 7–10, 14

### Ziel

Die problematischen Testcluster sind ausreichend kartiert, ohne eine Vollinventur aller guten Tests zu erzeugen.

### Aufgaben

1. Repositoryweit suchen nach:
   - `readFileSync`, `readdirSync`, `statSync` in Tests;
   - `Phase`, `Cutover`, `Migration` in Testnamen/Describes;
   - großen Test-Timeouts;
   - Jimp/Sharp/Pixelloops;
   - aktuellen Config-/Map-/Visual-Literalen;
   - Balance-/Benchmark-Harnesses;
   - exakten privaten Source-Strings;
   - positional Spy-/Mock-Argumenten;
   - offensichtlicher Testduplikation.
2. Nur problematische oder unklare Cluster in `04` aufnehmen.
3. Cluster mit `REWRITE / CONSOLIDATE / MOVE / DELETE` markieren.
4. Gute Tests nicht einzeln katalogisieren.
5. Baseline der aktuellen Runner und grobe Laufzeit-/Dateiverteilung dokumentieren, soweit ohne neue Infrastruktur direkt verfügbar.
6. Keine neuen Characterization-Tests reflexartig erzeugen. Nur wenn eine spätere Löschung sonst einen tatsächlich wichtigen, ungeschützten Vertrag gefährden würde.

### Nicht tun

- noch keine Massenverschiebung;
- noch keine AI-Doku ändern;
- keine Vollinventur aller Tests;
- keine Zielanzahl festlegen.

### Abschlusskriterium

`04` enthält eine kleine, belastbare Arbeitskarte der noch zu behandelnden Cluster und die nächste Phase kann ohne erneute Gesamtanalyse starten.

### Automatisierter Gate

- vorhandenes `npm test`
- `npm run build` nur falls Produktions-/Buildcode verändert wurde

---

## Phase 2 – Runner- und Suite-Trennung

**Detailverträge:** §§ 3, 9, 11, 12

### Ziel

Schwere und spezialisierte Tests blockieren den Daily Loop nicht mehr.

### Aufgaben

1. Dedizierte Bereiche/Patterns herstellen für:
   - architecture
   - integration
   - assets
   - stress
   - balance-lab
2. Balance-Lab-/Progression-/Benchmarktests aus der langen dateispezifischen Exclude-Struktur in `tests/balance-lab/` bzw. ein klares Pattern überführen.
3. `test:balance` nach Möglichkeit in `test:balance-lab` umbenennen.
4. Large-Arena-/Multi-Seed-/Benchmarktests nach `test:stress`.
5. teure Jimp-/Pixel-/Maskentests nach `test:assets`.
6. große World-/Campaign-/Materializationtests nach `test:integration`.
7. Gemischte Dateien bei Bedarf teilen, wenn ein schneller Pure-/Core-Test und ein schwerer Harness sinnvoll getrennt werden können.
8. `npm test` und `npm run check` als schnelle Gates erhalten.
9. Noch keine allgemeine Testpolicy-Doku schreiben.

### Nicht tun

- keine fachliche Assertion allein wegen Verschiebung ändern;
- keine neue CI-Infrastruktur;
- keine künstliche Symmetrie durch Verschieben aller normalen Tests.

### Abschlusskriterium

Die Spezial-Suites sind über stabile Verzeichnis-/Patternregeln erreichbar; `package.json` benötigt keine lange Liste einzelner Balance-Test-Excludes mehr.

### Automatisierter Gate

- `npm test`
- `npm run test:architecture`
- `npm run test:integration`
- `npm run test:assets`
- `npm run test:stress`
- `npm run test:balance-lab`
- Build/TypeScript soweit Runner-/Configänderung es erfordert

---

## Phase 3 – Source-Ratchets und Architecture-Tests

**Detailverträge:** §§ 2–6

### Ziel

Historische Implementation-Shape-Tests verschwinden; wenige sinnvolle Architekturgrenzen bleiben robust geschützt.

### Aufgaben

1. Alle verbleibenden Production-Source-Reads nach B/R/S klassifizieren:
   - B = Verhalten nur indirekt via Source;
   - R = dauerhafte Architekturgrenze;
   - S = historischer Source-Ort / Zwischenstand.
2. B nur behalten, wenn der Vertrag wirklich relevant ist; dann möglichst Behavior-Test.
3. R auf tatsächliche Notwendigkeit prüfen und in wenige Architecture-Tests konsolidieren.
4. S löschen.
5. Phase-/Cutover-Namen entfernen, wenn keine heutige fachliche Bedeutung besteht.
6. exakte private Methodennamen, Strings und Call-Reihenfolgen entfernen, sofern nicht eigenständige Semantik.
7. Legacy-Offenderlisten von `===` auf schrumpfbare Allowlist-Semantik umstellen.
8. wiederholte Sourcebaum-Scanner konsolidieren, ohne neues großes Framework.

### Besonders prüfen

- `ArenaSceneFrameCutover.test.ts`
- `Phase11DependencyCutover.test.ts`
- `PlayerGameplayReadViewBoundary.test.ts`
- `WorldGameplayCompositionContracts.test.ts`
- weitere Ownership-/Presentation-/Scene-Source-Ratchets

### Abschlusskriterium

Source-Inspection schützt nur noch wenige langlebige Architekturgrenzen. Eine saubere interne Umbenennung oder Verbesserung erzeugt nicht unnötig Testfehler.

### Automatisierter Gate

- `npm run test:architecture`
- betroffene Behavior-/Runtime-Tests
- `npm test`

---

## Phase 4 – Config-, Content- und Visual-Tuning-Kopplung

**Detailverträge:** §§ 7–9

### Ziel

Normale Tests duplizieren keine frei veränderbaren authored oder visuellen Tuningwerte.

### Aufgaben

1. bekannte Config-Kandidaten und weitere Treffer systematisch prüfen;
2. pro Assertion unterscheiden:
   - stabile Fach-/Technikkonstante → ggf. KEEP;
   - authored Tuning → relativ zur Config REWRITE oder DELETE;
   - Content-Struktur → Validator/semantischer Test;
   - redundante Snapshot-Aussage → DELETE.
3. Map-/Persistent-Base-Tests auf exakte HP/Koordinaten/Progressionstuning prüfen.
4. Upgrade-/Item-/Class-Tests von produktiven Tuning-Literalen entkoppeln.
5. Visual-/VFX-Tests auf exakte Alpha-/Farb-/Dauer-/Strength-Snapshots prüfen.
6. zentrale Content-Validatoren bevorzugt nutzen oder klein erweitern, wenn sie mehrere Einzelassertions sinnvoll ersetzen.
7. Balance-Lab-Ausnahme nicht versehentlich „bereinigen“: Werkzeugtests dürfen Parität zur aktuellen Config prüfen.

### Bekannte Prioritätskandidaten

- `GraveTitanVoidPlasma.test.ts`
- `CoopDefenseInfernoColossusCombat.test.ts`
- `Ak47CoopDefenseUpgrades.test.ts`
- `PlasmaSwarm.test.ts`
- `CoopDefenseMaps.test.ts`
- `CoopDefenseItemStats.test.ts`
- `CoopDefenseRuntimeAffixWiring.test.ts`
- `InspectorSupportWeapons.test.ts`
- `CoopDefenseHostileBase.test.ts`
- visual-tuning-lastige Renderer-/PostFX-/Terrain-Tests

### Abschlusskriterium

Typische Balance-, Map- und Visual-Anpassungen verändern Core-Tests nur dann, wenn dadurch tatsächlich ein Vertrag verletzt wird.

### Automatisierter Gate

- betroffene Tests
- Content-Validation
- `npm test`

---

## Phase 5 – Redundanz, Mock-Shape und verbleibender Ballast

**Detailverträge:** §§ 2, 3, 10, 13, 14

### Ziel

Die Suite wird zusätzlich kleiner und wartbarer, ohne wertvolle Regressionen zu verlieren.

### Aufgaben

1. In den bereits berührten Clustern redundante Tests identifizieren.
2. Prüfen, ob Compiler/Type/Validator bereits vollständig schützt.
3. Doppelte Unit-/Integration-Assertions ohne unterschiedlichen Schutzwert entfernen.
4. Exakte UI-Copy-Tests auf semantische Notwendigkeit prüfen.
5. Fragile positional Spy-/Mock-Tests nur dort umbauen, wo hoher Wartungsnutzen entsteht.
6. Minimale behavior-neutrale Produktivcodeänderungen für echte Testbarkeit durchführen, falls erforderlich.
7. Keine Repository-weite Stilbereinigung außerhalb der identifizierten Cluster erzwingen.
8. `04` nach jedem bereinigten Cluster wieder kürzen.

### Abschlusskriterium

Es existiert kein größerer bekannter Cluster mehr, dessen Tests primär Historie, Redundanz oder zufällige Call-Shape schützen.

### Automatisierter Gate

- betroffene fokussierte Tests
- `npm test`
- relevante Spezial-Suites

---

## Phase 6 – Dauerhafte AI-Testpolicy und finaler Gate

**Detailverträge:** §§ 11–15

### Ziel

Die neue Testqualität bleibt nach Abschluss erhalten.

### Aufgaben

1. `docs/ai/testing.md` als kanonische Testpolicy erstellen:
   - Schutzwert;
   - Tuning vs. Vertrag;
   - Testebenen;
   - Source-/Architecture-Ratchets;
   - temporäre Migration-Ratchets;
   - Suite-Zuordnung;
   - neue Testentscheidung;
   - wenige gute/schlechte Beispiele.
2. `AGENTS.md` bewusst kurz halten, sinngemäß nur:
   > Neue/geänderte Tests schützen langlebiges Verhalten oder Invarianten, nicht aktuelles Tuning oder zufällige Implementierungsdetails. Bestehende passende Tests bevorzugt erweitern. Details: `docs/ai/testing.md`.
3. `docs/ai/index.md` um `testing.md` ergänzen.
4. `docs/ai/local-dev-environment.md` nur um Runner-/Gate-Semantik ergänzen und auf `testing.md` verweisen.
5. `docs/ai/weapon-balance-lab.md` um die Werkzeugtest-/Config-Paritäts-Ausnahme und `test:balance-lab` ergänzen.
6. `.ai/skills/fragdachse-phaser/SKILL.md` höchstens um einen kurzen Verweis ergänzen, dass ästhetisches Tuning nicht unnötig eingefroren wird.
7. `npm run ai:sync`.
8. Finales Review:
   - verbleibende Source-Ratchets;
   - Runner;
   - Exclude-Listen;
   - offene problematische Cluster;
   - Testanzahl-/Ballastreduktion qualitativ bewerten.
9. Alle Gates ausführen.

### Nicht tun

- keine doppelte ausführliche Testpolicy in `AGENTS.md`, `CLAUDE.md` oder mehreren Fachseiten;
- keine neue CI-Infrastruktur;
- keine Browserprüfung.

### Abschlusskriterium

Die Zielarchitektur aus `01`/`02` ist umgesetzt und für künftige Coding-KIs als dauerhafte Policy auffindbar.

### Finaler automatisierter Gate

- `npm test`
- `npm run test:architecture`
- `npm run test:integration`
- `npm run test:assets`
- `npm run test:stress`
- `npm run test:balance-lab`
- `npm run build`
- `npm run ai:sync`
- `git diff --check`

Danach `04` auf Abschlussstatus und verbleibende echte Follow-ups reduzieren und genau einen Commit für Phase 6 erstellen.
