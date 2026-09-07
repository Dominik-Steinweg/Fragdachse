# Fragdachse – Combat Runtime Implementation Plan

**Status:** Verbindlicher Umbauplan für orchestrierte Arbeitsblöcke; Implementierung noch nicht begonnen.\
**Zielarchitektur:** [01 Core](01_Combat_Runtime_Architecture_Core.md) + [02 Details](02_Combat_Runtime_Architecture_Details.md)\
**Fortschritt / Bedienung:** [04 Status](04_Combat_Runtime_Migration_Status.md) / [05 Spickzettel](05_Combat_Runtime_Implementation_Cheatsheet.md)\
**Analysierter Ausgangspunkt:** `main` @ `d5cb4519fb06dd74e22d21e8d63e635ea75bbc26`, 06.09.2026. Die hier beschriebenen Prüfungen sind Arbeitsaufträge, keine bereits ausgeführten Abnahmen.

> **Ein zusammenhängendes Refactoring mit kontrolliert unvollständigen Zwischenständen.** Phasen schließen fachliche Arbeitspakete, nicht jedes Mal ein spielbares Release. Erst die technische Endabnahme verlangt einen vollständig integrierten, grünen Stand; danach folgt die menschliche Gameplay-Abnahme. Das rechtfertigt weder unklare Authority noch aufgeschobene Architekturentscheidungen.

## 1. Arbeitsvertrag und Dokumentbudget

**Orchestrator:** einmal den normativen Teil von 01, 04, §§ 1–4 dieses Plans und die Betriebsanleitung in 05 lesen. Danach aktuelle Phasenkarte, Gate und konkrete Befunde; nicht die vollständige Worker-Recherche nachlesen.

**Implementierungsagent:** 01 ohne Quellenanhang, aktuellen Kurzstatus 04, §§ 1.2, 2.1–2.3 und 4.2–4.3 dieses Plans, genau die zugewiesene Phasenkarte und deren referenzierte Abschnitte aus 02 lesen. Bei bereits bekanntem unverändertem Vertrag nicht erneut laden. 03 § 3.1 nur für benötigte Contract-Familien; 02 § 16 für tatsächliche Cross-Layer-Cuts.

**Reviewer:** 01 und die jeweilige Review-Karte, relevante 02-Verträge, tatsächlichen Diff/Code und Prüfnachweise lesen. Keine Übernahme des Implementierungsdialogs als Begründung für Korrektheit. 05 ist für die fachliche Worker-/Review-Arbeit kein Pflicht-Vollkontext.

Danach Symbolsuchen und betroffene Implementierungen/Tests. Quellenanhänge und Vorgängerpläne sind Nachschlageorte. Modellwahl und Reasoning stehen ausschließlich in 05. Der Hauptchat in der Codex-Desktop-App übernimmt die Orchestrator-Rolle und beauftragt native Subagenten direkt; eigene Agentenrollen, TOML-Dateien oder ein Runner sind nicht erforderlich.

01/02 definieren Semantik. Dieser Plan organisiert deren Realisierung. Konkrete Namen werden in P1 einmal materialisiert; nachfolgende Phasen benutzen sie. Zulässig sind lokale Ausgestaltungsentscheidungen innerhalb der Contracts, keine neuen Owner, Regeln oder Fallbacks unter dem Etikett „Implementierungsdetail“. Ein echter Widerspruch wird als kleiner Ist/Soll-Befund mit betroffener §-Referenz vor der abhängigen Arbeit geklärt.

Der Nutzer beauftragt standardmäßig **einen Arbeitsblock**, der Orchestrator delegiert **eine Phase pro Worker-Auftrag**. Innerhalb des freigegebenen Blocks folgt nach bestandenem Phasen-Gate automatisch die nächste Aufgabe. R1/R2 werden ebenfalls automatisch beauftragt. Bei Blocking-Findings koordiniert der Orchestrator innerhalb desselben Blocks bis zu zwei begrenzte Korrektur-/Wiederholungsreview-Schleifen gemäß § 4.3. **Nach einem Review-Pass oder einem weiterhin negativen dritten Review endet der jeweilige Block.** Erst eine ausdrückliche Nutzerfreigabe erlaubt den Folgeblock. Einzelphasenaufträge bleiben möglich und erlauben dann keine automatische Folgephase.

R1/R2 sind Code-/Architekturreviews, keine manuelle Spielprüfung. Separate dauerhafte Review-Dokumente, eine zweite Statusdatei oder ein sechstes normatives Planungsdokument werden nicht angelegt. Der einfache Desktop-Start steht in 05 und der beiliegenden Startanleitung. Fehlende Custom-Agent-Dateien sind kein Blocker. Bestehende Projektinstruktionen bleiben gültig.

### 1.1 Isolierter Umbauzweig

Auf einem dedizierten Refactoring-Branch arbeiten. Unvollständige Phasen nicht nach `main` integrieren oder automatisch deployen. Vorhandene uncommittete Nutzeränderungen nicht überschreiben, automatisch stashen oder pauschal mitcommitten. Der Orchestrator prüft den Checkout vor dem ersten Worker. Produktive Weiterentwicklung auf `main` wird an einem ruhenden Checkpoint gezielt verglichen; kein automatisches Pull/Rebase während eines Workers. Fachfremde Änderungen bleiben draußen, ein notwendiger konfliktträchtiger Merge benötigt Nutzerentscheidung. Vor Integrationsabschluss Delta-Abgleich wiederholen. Kein komplettes Re-Review unveränderter Nachbararchitektur.

Der Blockauftrag erlaubt lokale Phasen-Commits auf dem Refactoring-Branch. **Nur der Orchestrator** schreibt 04, stage-t und committet die geprüfte Lieferung einschließlich Status. Worker und Reviewer committen nicht. Kein Push, Merge nach `main`, Deployment oder destruktiver Git-Befehl ohne separaten Auftrag. Ein nicht spielbarer Stand darf ein bewusster Umbau-Commit sein, aber nicht als grünes Release bezeichnet werden.

Git bleibt die Historie. 04 darf nur die wenigen für Wiederaufnahme und Nachweisgültigkeit nötigen Anker halten: Start-HEAD einer laufenden Aufgabe und Code-HEAD der aktuellen R1/R2/P13-Belege. Keine SHA-Chronik und kein Nachtrag des eigenen Status-Commit-SHAs in denselben Commit.

### 1.2 Was zwischen Phasen unvollständig sein darf

**Zulässig:** fehlende Endverdrahtung, noch nicht migrierte Consumer, bewusst ausstehende Legacy-Entfernung, daraus folgende bekannte Typecheck-/Integrationsfehler und vorübergehende Nichtspielbarkeit. Die fachlich abgeschlossene neue Einheit muss dennoch ihren Contract erfüllen und geprüft sein.

**Immer verbindlich:** pro produktiv angeschlossenem State nur ein aktiver Writer; kein Cross-World-/Life-Leak; neue geschlossene Module typkonsistent; fokussierte Semantiktests grün; keine neuen ungeklärten Vertragsbrüche. Eine neue Implementierung darf vor ihrem Anschluss isoliert getestet werden. Sie wird nicht als zweiter Live-Writer mit alten Maps synchron gehalten.

Jede erwartete rote Prüfung erhält in 04 einen **engen Eintrag mit Ursache, betroffener Grenze und Schließphase**. Beispielsweise „alte Hitscan-Aufrufsignatur im Execution-Adapter, Anschluss P8“, nicht „Typecheck während Refactoring egal“. Ungeplante Fehler in bereits geschlossenen Contracts blockieren den Phasenabschluss. Erwartete Fehler werden nicht durch `any`, `@ts-ignore`, pauschale Test-Skips, grün gefärbte Runner oder erfolgreiche No-op-Implementierungen versteckt.

Eine Legacy-Fassade ist nur erlaubt, wenn sie den Cutover tatsächlich vereinfacht: einseitiges Delegieren, kein eigener State, festes Ende. **Keine Kompatibilitätsschicht nur deshalb bauen, damit das Spiel nach jeder Phase läuft.** Stubs gehören in Tests. Ein noch unverdrahteter notwendiger produktiver Port wird vor Aktivierung sichtbar abgelehnt.

## 2. Prüfstrategie

### 2.1 Drei Gate-Stufen

| Gate | Wann | Verlangter Nachweis |
|---|---|---|
| **L – lokaler Phasenabschluss** | P1–P12 | betroffene geschlossene Contracts korrekt; fokussierte Tests grün; Typecheck beurteilt; nur explizit zugeordnete Übergangsfehler; Diff/Status konsistent |
| **R – Architekturreview** | R1 nach P1; R2 nach P6 | Gesamtgrenzen und riskante Semantik innerhalb des bis dahin geschlossenen Clusters bestätigt; keine neue Architektur; Vollspielbarkeit nicht verlangt |
| **F – technische Endabnahme** | P13 | alle produktiven Pfade integriert, keine Transition/Legacy-Restschuld, vollständige Gates grün, unabhängiger Architekturabgleich |

P0 erhebt einmal die tatsächliche Baseline. Ein früherer grüner Projectile-Abschluss wird nicht als Combat-Baseline ausgegeben. Bereits bestehende Fehler werden von neu verursachten getrennt; sie dürfen für F nur dann ausgenommen werden, wenn sie nachweislich außerhalb des Scopes liegen und ausdrücklich akzeptiert sind. Ein betroffener Combat-/World-Pfad darf nicht als „vorher schon kaputt“ aus dem Refactoring fallen.

### 2.2 Runner und Kosten

Maßgeblich sind `package.json`, `AGENTS.md` und `docs/ai/testing.md` im jeweiligen Checkout.[^tests]

- Für einen fokussierten Core-Test: `npm test -- tests/<vorhandener-Test>.test.ts`.
- Spezialtests gezielt mit der passenden vorhandenen Suite ausführen; ein enger Dateifilter kann als Argument übergeben werden, etwa `npm run test:integration -- tests/integration/<Test>.test.ts`. Keine ungeprüfte Paketinstallation über einen fehlenden `npx`-Befehl. `npm test` schließt die Spezialbereiche aus.
- `npm run typecheck` liefert während offener Cutover-Übergänge eine Diagnose, keine automatische Freigabe. Fehler in neuen geschlossenen Modulen sind nicht zulässig. Ein transpiliert laufender Vitest-Test ersetzt diesen Typnachweis nicht.
- `npm run check` enthält Core, Architecture und Build; Build enthält TypeScript. **Nicht unmittelbar davor nochmals Typecheck/Core/Architecture vollständig ausführen.** Zwischenphasen verwenden passende Tests, nicht jedes Mal die vollständige Matrix.
- Kein Lint-Script erfinden. Keine neue Browser-/CI-/Testplattform. Dokumentationsänderungen benötigen Pfad-/Verweisprüfung und `git diff --check`, keinen kompletten Spieltestlauf.

R1 prüft vor allem Types, Owner und exemplarische Contracts. R2 prüft zusätzlich den realisierten Mutation-/Reaction-/Lifecycle-Cluster. Breite Integrationsläufe sind dort nur soweit sinnvoll, wie die betreffenden Pfade bereits angeschlossen sind. Vollständige technische Gates laufen in P0 als Baseline und in P13 als Endabnahme; weitere breite Läufe nur bei konkretem Schutzwert.

### 2.3 Testumbau statt Testvermehrung

Die Nachweis-IDs **V1–V12 aus 02 § 18** sind die gemeinsame Prüfsprache. Passende vorhandene Tests erweitern oder an die neue Boundary umhängen. Ein Testwechsel schützt dieselbe Regression, nicht eine alte private Methode. Neue kleine Fälle sind für die Korrekturen D1–D10 gerechtfertigt; keine Vollinventare, Klassenanzahl-Assertions, Tuning-Literalsnapshots oder zweite Combat-Formel im Lab.

Keine KI-Browserprüfung, kein Dev-Server und keine Screenshots im normalen Ablauf. Ein Ausnahmebedarf wird mit der konkreten unbeantworteten visuellen Frage dokumentiert; ein Browserlauf benötigt einen gesonderten ausdrücklichen Auftrag. Manuelle Spielprüfungen werden für M gesammelt, nicht jeder Phase zugewiesen.

## 3. Reihenfolge und Integrationsverantwortung

```text
P0 Baseline
 → P1 Contracts / Composition-Entscheidungen
 → R1 Vertragsreview
 → P2 Combatant-Mutation
 → P3 gemeinsame Geometrie
 → P4 Damage / Support / Modifier / Defense
 → P5 Status und Mechanikzustände
 → P6 Reaktionen / Death / Kill / Player-Lifecycle
 → R2 Semantikreview
 → P7 Projectile-Adapter
 → P8 Hitscan / Melee / Preview
 → P9 World-Mutation / Support / Domain-Fan-out
 → P10 übrige Consumer
 → P11 Gesamtverdrahtung / Frame / Network / Presentation
 → P12 Legacy-Entfernung / Ratchets / Wissen
 → P13 unabhängige technische Endabnahme
 → M menschliche Gameplay-Abnahme
```

Die Reihenfolge ist die Standardführung. P3 ist absichtlich ein eigener, überwiegend lokaler Query-Cut; P9 übernimmt den schwierigeren World-Mutations-/Lifecycle-Cut. P10 folgt erst auf definierte und implementierte Ports, damit der breite Consumer-Umbau überwiegend mechanisch bleibt. P11 ist **kein Container für übrig gebliebene Damage-/Reward-Regeln**, sondern schließt den vorbereiteten Gesamtgraphen.

### 3.0 Freigegebene Arbeitsblöcke

| Block | Automatische Aufgabenfolge | Zwingendes Ende / nächste Freigabe |
|---|---|---|
| **A – Grundlagen** | kurzer Startcheck aus 05 → P0 → P1 → R1 | R1-Ergebnis vorlegen; **P2 nicht beginnen** |
| **B – fachlicher Kern** | P2 → P3 → P4 → P5 → P6 → R2 | R2-Ergebnis vorlegen; **P7 nicht beginnen** |
| **C – Integration und Abschluss** | P7 → P8 → P9 → P10 → P11 → P12 → P13 | technischer Abschluss oder konkreter Blocker; **M bleibt beim Nutzer** |

A benötigt den Startauftrag. B benötigt bestandenes, noch gültiges R1 **und** Nutzerfreigabe für B; C entsprechend R2 und Freigabe für C. Ein Review-Pass, ein Eintrag „nächste Phase“ oder diese Tabelle ist selbst keine Nutzerfreigabe. In 04 stehen technische Review-Gates und freigegebener Block getrennt. Bei einem frühen grundlegenden Blocker endet auch ein ansonsten freigegebener Block.

Der Standardlauf ist sequenziell mit höchstens einem aktiven schreibenden Worker. Auch P2/P3 werden nicht parallel gestartet. Der Orchestrator schreibt währenddessen weder Produktionsdateien noch 04. Keine Agentenkaskade; nach Abschluss den Worker freigeben, bevor ein neuer Thread gestartet wird.

### 3.1 Cross-Phase-Contract-Manifest

P1 materialisiert die tatsächlich benötigten öffentlichen Type-Familien aus 02 § 3. Interne Helfer werden erst bei ihrer Implementierung angelegt. Leere Processor-/Manager-Gerüste für alle denkbaren Features sind nicht erforderlich.

| Familie | Semantik in 02 | erste Realisierung / funktionaler Cut | spätere Hauptconsumer |
|---|---|---|---|
| CF-SCOPE | § 4 | P1; Life-/Target-Prüfung P2/P6 | alle Adapter und gespeicherten Reaktionen |
| CF-MUTATION | § 5 | Types P1; Combatants P2; World-Targets P9 | P4, P6–P9 |
| CF-RESOLVE | §§ 6–7 | Types P1; Regeln P4 | alle Schadens-/Support-Quellen |
| CF-READ | §§ 5, 15 | Types P1; Vitals P2; Ausgabe P11 | P3, P10/P11, Lab |
| CF-QUERY | §§ 4, 8 | Types P1; Geometrie P3; Policy P4 | P7/P8, AI/Physics/World |
| CF-ATTACK | § 8 | Types P1; Umsetzung P8 | bestehende gemeinsame Weapon-Execution |
| CF-STATUS | § 9 | Types P1; State/Advance P5 | P6–P10, Movement/Projection |
| CF-REACTION | §§ 10–11 | Types P1; Mechanik-Anschluss P5/P6 | P7–P11 |
| CF-LIFE | § 11 | Types P1; Vitals P2; Commit P6 | Player-/Activity-Composition |
| CF-FRAME | §§ 14–15 | Types P1; funktionale Schritte P5/P6; Anschluss P11 | Host-/Client-/Lifecycle-Coordinator |
| CF-WORLD | §§ 5, 7, 13 | Types P1; Implementierung P9 | World-/Environment-/Support-Consumer |
| CF-PROJECTILE | § 12 | **vorhanden**; neuer Adapter P7 | bestehende Projectile-Runtime/Continuation |

04 hält eine kurze Zuordnung zu tatsächlichen Types/Dateien, keine Interface-Kopien. Semantische Ergänzungen werden beim vorhandenen Contract vorgenommen. Eine zusätzliche Familie braucht einen nachgewiesenen Unterschied, keine bloß andere Aufrufstelle.

### 3.2 Übergangsfenster

| Übergang, falls tatsächlich nötig | spätestens geschlossen |
|---|---|
| lokaler neuer Vitals-Writer vs. alte Combatant-API | P4 für Damage/Heal; P6 für Lifecycle |
| alte Geometrie-/Status-Reads und ihre Consumer | P10 |
| alte Projectile-/Hitscan-/Melee-Aufrufe | P7 bzw. P8; äußerer Anschluss P11 |
| World-Mutation in Visual-/Host-Helfern | P9; äußere Consumer P10 |
| alter Scene-/World-Binding-Graph und Ausgabe | P11 |
| produktive `CombatSystem`-Imports, Reexports und befristete Fassaden | P12 |

Dies ist ein Schließvertrag, keine vorab als existent markierte Schuldenliste. 04 enthält nur tatsächlich aktive Übergänge. Ein überschrittenes Fenster muss vor nachfolgender abhängiger Arbeit geschlossen werden; ein begründeter Planumschnitt benötigt Nutzerfreigabe. Ein Reviewer oder Orchestrator darf es nicht selbständig bis P13 verschieben.

## 4. Einheitliche Phasenführung und Orchestrator-Vertrag

### 4.1 Ablauf und Zuständigkeit

Der Orchestrator prüft Voraussetzungen, Freigabe und Checkout, setzt die Aufgabe in 04 auf aktiv und beauftragt einen nativen Subagenten mit der in 05 empfohlenen Modell-/Reasoning-Auswahl. Es werden keine dauerhaften Rollen eingerichtet. Kleine geklärte Folgekorrekturen darf der Hauptchat selbst erledigen, solange kein anderer Agent schreibt; für ihn gelten dann dieselben fachlichen Gates. Im Rückfallweg aus 05 § 3 darf der passend konfigurierte Hauptchat auch eine ganze Phase selbst ausführen; dann übernimmt er deren Implementierungs- und Checkpoint-Pflichten, aber nicht das unabhängige Review seiner eigenen Arbeit. Worker-Auftrag: Phase bzw. begrenztes Reparaturpaket, Start-HEAD, erlaubter Änderungsbereich, Ladepaket, Gate, erwartete offene Anschlüsse und Rückgabeformat aus § 4.2. Fachlich notwendige Consumer dürfen innerhalb des zugewiesenen Cuts mit angepasst werden; neue Scope-Ausweitung wird gemeldet.

Ein Worker-Kontext darf für höchstens zwei unmittelbar zusammenhängende Phasen mit gleichem Modell wiederverwendet werden, wenn das erste Gate samt Checkpoint erfüllt ist. Jede Phase bleibt ein eigener Auftrag; der Folgeauftrag nennt den neuen HEAD und verlangt einen gezielten Abgleich der zwischenzeitlich geänderten Dateien. Modellkontinuität allein ist kein Grund für Wiederverwendung. Nicht benachbarte Phasen und breite Integrationsphasen beginnen grundsätzlich in einem neuen Kontext.

Nach Rückgabe prüft der Orchestrator tatsächlichen Diff einschließlich neuer/untracked Dateien, Contract-Anschluss, Tests und Übergangsfristen. Er prüft zumindest repräsentative Eintritts-/Ausgangsstellen sowie alle vom Worker gemeldeten Semantikänderungen. Eine Meldung „fertig“ oder „Tests grün“ ohne ausgeführten Befehl/Ergebnis genügt nicht. Reine Fehlersuche, langes Warten oder hohe LOC sind kein Fortschrittsnachweis.

Ist das Gate erfüllt, aktualisiert und committet der Orchestrator Code und 04 gemeinsam. Er kontrolliert den Commit-Inhalt und den verbleibenden Working Tree. Begrenzte Zwischen-/Fix-Commits sind zum Sichern einer Lieferung oder Herstellen einer eindeutigen Review-Basis zulässig; die Phase bleibt dabei aktiv, solange ihr Gate fehlt. Ein solcher Commit darf nicht als Phasenabschluss ausgegeben werden. Nur dann startet er innerhalb desselben freigegebenen Blocks die nächste Aufgabe. Unveränderte erfolgreiche Läufe werden nicht allein wegen dieses Commit wiederholt. Der Checkpoint nennt knapp Phase, belegtes Gate, offene Übergänge und nächste Aufgabe; kein vollständiger neuer Architekturbericht.

### 4.2 Worker- und Review-Vertrag

**Worker:** genau eine Phase oder ein begrenztes Fixpaket. Keine weiteren Agenten; keine automatische Folgephase. Keine Änderungen an 01–05 oder der Agenten-/Clientkonfiguration, keine Änderungen am Git-Index, keine Commits, kein Push/Merge/Reset/Checkout. Notwendige Änderungen der Projekt-Wissensseiten in P12 bleiben erlaubt. Nicht eigenmächtig Tests überspringen, Formeln vereinfachen, Models austauschen oder Required Ports erfolgreich stubben.

**Reviewer:** Das initiale R1/R2/P13-Review beginnt in einem frischen Kontext und ändert keine Produktions-, Test-, Status- oder Konfigurationsdateien. Es prüft den realen Code gegen Verträge, nicht nur die Implementierungszusammenfassung, und bündelt Findings aus einer endlichen, zur Review-Karte passenden Risikomatrix. Ein R-Gate stoppt nur bei einem auf dem aktuellen Code reproduzierbaren Fehler in einem plausiblen Produktivpfad, der einen bereits geschlossenen Vertrag materiell verletzt: falscher Zustand oder Autorität, verlorene/falsche Attribution, doppelte Wirkung oder ein relevanter Ownership-/Lifetime-Übergriff. Naming, Strukturwünsche, zusätzliche Härtung, theoretische Varianten ohne Produktivpfad, Performance ohne belegte relevante Regression und erwartete P7–P13-Anschlüsse sind keine Blocker. Findings benötigen Datei/Symbol, Auswirkung, Repro, Produktiv-Erreichbarkeit, betroffenen §/V-Nachweis und Schwere. Das Urteil lautet bestanden, nicht bestanden oder nicht ausreichend verifiziert und erteilt niemals eine Nutzerfreigabe.

Ein Reviewer im Read-only-Modus fordert nötige Testläufe beim Orchestrator an, falls der Runner Cache-/Build-Dateien schreiben muss. Exakte Nachweise desselben Code-HEAD dürfen übernommen werden; der Reviewer wiederholt nur die für seine unabhängige Aussage nötigen Repros und Stichproben. Der Orchestrator wiederholt grüne unveränderte Suiten nicht allein zur Bestätigung einer Agentenmeldung, prüft aber Diff, Commit-Inhalt und kritische Ein-/Ausgänge. Ein blockierter Test wird nicht als bestanden interpretiert.

**Rückgabe, kurz und überprüfbar:**

```text
Aufgabe / Start-HEAD / ausführender Agent:
Ergebnis: Gate erfüllt | blockiert | unvollständig
Geänderte Dateien und realisierte Contracts: nur relevante Pfade/Symbole
Nachweise: exakter Befehl, Exit-Code, Ergebnis, geprüfter Code-Stand
Offene Übergänge: Ursache → Grenze → Schließphase
Findings / nicht geprüft / notwendige Entscheidung:
```

Testausgaben dürfen unter dem bereits ignorierten `tmp/combat-refactor/` liegen. 04 hält nur Zusammenfassung und nötige Referenz; temporäre Logs sind kein zweites Statussystem. Worker erfinden keinen Nachweis für einen abgebrochenen, nicht gestarteten oder vom Environment verhinderten Lauf.

### 4.3 Begrenzte Reparatur und Eskalation

Normale lokale Korrekturen erfolgen beim zuständigen Worker. Ein initiales R1-, R2- oder P13-Review darf bei Blocking-Findings automatisch höchstens **zwei** begrenzte Korrektur-/Wiederholungsreview-Schleifen auslösen: Review 1 → Fix 1 → Review 2 → gegebenenfalls Fix 2 → Review 3. Das initiale Review prüft seine endliche Risikomatrix vollständig und bündelt alle erkannten Findings. Ein Wiederholungsreview prüft die gemeldeten Findings, direkt berührte Verträge und deren Regressionen; es startet keine neue unbeschränkte Suche im gesamten bisherigen Delta. Ein dabei offensichtlich reproduzierter echter Blocker wird trotzdem gemeldet.

Den Fix schreibt abhängig von Umfang und Komplexität entweder ein **Luna-/xhigh-Worker** für klar begrenzte lokale Änderungen oder der identifizierende **Astra-/high-Reviewer**, wenn dessen bestehender Analysekontext bei einer verflochtenen Ownership-/Source-/Lifecycle-Korrektur wesentlich ist. Sobald ein Reviewer schreibt, ist er für diesen Fix kein unabhängiger Prüfer mehr; das nächste Review muss dann in einem anderen frischen Astra-/high-Kontext erfolgen. Schreibt Luna den Fix, darf der weiterhin read-only gebliebene Astra-Reviewer die begrenzte Nachprüfung im vorhandenen Kontext fortsetzen. Zu jedem Zeitpunkt gibt es höchstens einen Writer.

Jeder Fix erhält einen geprüften lokalen Checkpoint; jedes Wiederholungsreview arbeitet unabhängig und read-only auf dem neuen Code-HEAD. Besteht Review 3 nicht, hält der Block mit kleinem Repro-/Contract-/Diff-Paket zur manuellen Nutzerprüfung an. Keine vierte automatische Reviewrunde, kein Reset des Zählers durch neue Agenten und keine unbeschränkte Schleife. Während einer automatisch fortgesetzten Schleife wird ein reiner Zwischenstatus nicht separat committet, sondern mit dem nächsten Fix-Checkpoint gebündelt; ein tatsächlicher Nutzerstopp erhält weiterhin einen Status-Commit.

Neue grundlegende Ownership-/Lifetime-/Provenance-Fragen, gefährdete Nachbarcontracts oder notwendige Änderungen an 01/02 gehen unabhängig von der Rundenzahl sofort zur Nutzerentscheidung. Lokale Fixes innerhalb klarer bestehender Verträge brauchen dagegen in den zwei erlaubten Schleifen keine manuelle Einzelabnahme. Mehrere Findings eines Reviews werden nach Möglichkeit in einem begrenzten Fixpaket gebündelt; ein neuer unabhängiger Grundsatzkonflikt ist keine lokale Korrektur.

Für P13 gilt dieselbe Rundenzählung und Blocker-Schwelle. Der Orchestrator darf ein negatives Review nicht selbst in einen Pass umdeuten; ein Review-Autor darf seinen eigenen Fix nicht freigeben.

### 4.4 Checkpoint, Unterbrechung und Wiederaufnahme

04 ist die einzige operative Wahrheit, **abzugleichen mit Git und tatsächlichen Belegen**. Beim Wiederanlauf zuerst aktuellen Branch/HEAD, Index, Working Tree und neue Dateien lesen; keine frühere Phase blind erneut ausführen. Offene Worker-Prozesse/Threads beenden oder eindeutig übernehmen, bevor ein neuer Writer startet.

Ein nicht committierter ✅-Eintrag nach Unterbrechung ist kein abgeschlossener Checkpoint. Lieferung und Belege prüfen, den gemeinsamen Code-/Status-Commit nachholen oder die Aufgabe wieder auf aktiv/blockiert setzen. Kein automatisches Verwerfen angefangener Arbeit. Gehören Änderungen nicht eindeutig zur unterbrochenen Aufgabe, erst klären; Nutzerarbeit bleibt unangetastet.

R1/R2/P13 beziehen sich auf einen konkreten Code-HEAD. Nötige Review-Fixes werden deshalb vom Orchestrator vor dem erneuten unabhängigen Review als Fix-Checkpoint gesichert; 04 hält das Review bis zu seinem tatsächlichen Pass offen. Worker-Tests vor einem Commit beziehen sich nachvollziehbar auf Start-HEAD plus unveränderte Prüflieferung; der Orchestrator bestätigt, dass genau diese Lieferung committed wurde. Nachträgliche relevante Änderungen invalidieren die betroffenen Review-/Testbelege und benötigen gezielte erneute Prüfung. Reine 04-/Betriebsdokument-Commits machen einen ansonsten unveränderten Code-Nachweis nicht ungültig. Keine selbstreferenzielle SHA-Schleife: 04 darf einen vorherigen geprüften Code-Commit benennen; der aktuelle Stand und der Unterschied zu diesem Anker sind mit Git überprüfbar.

Nach technisch erfülltem R1/R2 setzt der Orchestrator den Zustand auf **„wartet auf Nutzerfreigabe B/C“** und beendet das Blockziel. Freigaben werden nur aus tatsächlichem Nutzerauftrag übernommen. Eine unterbrochene Sitzung besitzt weiterhin höchstens die vorherige Blockfreigabe. Fehlendes `/goal` blockiert den normalen Mehrphasenauftrag nicht; bei einer Unterbrechung wird derselbe Block fortgesetzt. Fehlende Modellwahl oder Subagenten führen nur dann zu einem gezielten Nutzerstopp, wenn die nächste Aufgabe bzw. ein unabhängiges Review sie benötigt (05 § 3). Echte Tool-/Berechtigungs- oder Ressourcenfehler werden gemeldet, nicht durch Sicherheitslockerung umgangen.

## 5. Phasenkarten

### P0 – Baseline und gezielter Delta-Abgleich

**Laden:** 02 §§ 2, 16–18; aktuelle Projekt-Testpolicy; Projectile-Abschlussstatus, nicht erneut dessen gesamten Implementierungsplan.\
**Voraussetzung:** Block A beauftragt; kurzer Startcheck aus 05 erledigt, Arbeitsbranch und unverfälschter Ausgangsstand bekannt. Eine eigene Agentenkonfiguration oder ein verfügbarer CLI-Befehl ist keine Voraussetzung für P0 in der Desktop-App.

**Arbeit:** Den aktuellen Checkout gegen die hier dokumentierte Analysebasis vergleichen. Mit Symbol-/Import-Suche Combat-Consumer und kanonische Mutationsstellen den Clustern in 02 § 16 zuordnen. Vorhandene Testfälle für V1–V12 identifizieren. Baseline mit den in § 6 genannten technischen Runnern erheben; Ergebnisse knapp festhalten. Die besonders riskanten Pfade D1–D10 über aktuelle Codeausschnitte prüfen. Noch keine neue Gesamtarchitektur und kein breit angelegtes Testprojekt. Die neue Basis enthält bereits Sweep-Endpunkterhalt und Flight Signature; ihre bestehenden Tests gehören zur aktuellen Baseline, nicht in eine erneut zu beauftragende Projectile-Phase.

**Ergebnis:** belastbare Baseline; wenige konkrete neu entdeckte Abweichungen; P1 kennt bestehende Type-/Owner-Anschlüsse. Nur fehlende kleine Charakterisierung ergänzen, die eine folgende semantische Entscheidung wirklich absichert. Unveränderte Quelle ist nicht erneut zu inventarisieren.

**Gate:** Baseline wahrheitsgemäß klassifiziert, offene fachliche Fragen zugeordnet. Das Projectile-Refactoring wird nicht als offen geführt. **Danach P1.**

### P1 – Neutrale Contracts und verbindlicher Aufbauplan

**Laden:** 02 §§ 2–4, 5.1, 6.2, 10.1, 11.1, 14.3, 16.\
**Voraussetzung:** P0.

**Einstiege:** `CombatSystem.ts`, `PlayerCombatIntegrationPort.ts`, `WeaponReactionPort.ts`, Projectile-Ports, `ArenaWorldGameplayComposition.ts`, `ArenaWorldCombatComposition.ts`, `PlayerWorldRuntimeComposition.ts`.

**Arbeit:** Neutrale Source-/Target-/Scope-/Outcome-/Capability-Types materialisieren. Die vorhandenen Projectile-Verträge bleiben bestehen. Aufbau und Aktivierung der World-Combat-Boundary mit benötigten Attach-/Detach-Punkten festlegen; keine ganze Scene-Runtime als Dependency. Notwendige Boundary-Schnittstellen dürfen früh entstehen, produktive Required-Port-Prüfung jedoch nicht als erfolgreicher No-op.

Faktorherkunft und Rückgabesemantik je Eintrittsfamilie anhand 02 §§ 6/17 konkret zuordnen. Source- vs. Target-Faktoren, echte Trigger und terminale Fakten müssen vor der nachfolgenden Implementation klar sein. Die Zuordnung gehört als kleine typisierte Contract-Dokumentation bzw. passende synthetische Fälle in den Code/Test, nicht als zweites dauerhaftes Planungsinventar in 04.

**Nachweis:** CF-SCOPE/CF-MUTATION und repräsentativer Damage-/Support-/Projectile-Adapter typkonsistent; repräsentative Tests für getrennte Attribution/Allegiance, abgeleitete Damage-Basis und Target-Instanz. Noch keine vollständige Spielverdrahtung nötig.

**Gate L:** keine Doppelcontracts oder universellen Contexts; tatsächliche Namen in 04. **Automatisch R1 im freigegebenen Block A; danach Nutzerstopp.**

### R1 – Vertrags- und Gesamtarchitekturreview

**Laden:** 01; 02 §§ 2–6, 12, 14.3, 16–17; P1-Diff und neutrale Types.

Unabhängig prüfen: passen Vitals-/World-Writer, Status, Reaktionen, Respawn, Geometrie und Ausgabe ins bestehende World-/Activity-Modell? Sind Source-Dimensionen und Scaling-Zustände konkret genug, ohne die Projectile-Grenze umzubauen? Werden erzwungene Zwischenverdrahtungen oder ein neuer God-Owner vermieden?

**Review-Gate R1:** keine ungeklärte grundlegende Contract-/Ownership-Frage. Kleine Korrekturen nach § 4.3 beheben und erneut prüfen. Orchestrator hält Ergebnis und Code-Anker in 04 fest. Kein Browser und keine menschliche Spielabnahme. **Block A endet hier; P2 erst nach ausdrücklicher Nutzerfreigabe B.**

### P2 – Kanonische Combatant-Mutation

**Laden:** 02 §§ 4–5, 7, 11.1, 11.3.\
**Voraussetzung:** R1 technisch bestanden und weiterhin gültig; Block B vom Nutzer freigegeben.

**Einstiege:** Player-Maps und Init/Heal/Regen/Respawn-Zustand in `CombatSystem`; `EnemyManager.applyDamage`, `EnemyLethalDamageGuard`, `EnemyDeathInfo`; `DecoySystem.applyDamage`; `NecromancySystem`-Rettung.

**Arbeit:** Player-Vitals hinter einem kanonischen Writer von Combat etablieren. Enemy-/Decoy-Writer um belastbare Mutation-Outcomes erweitern; Storage nicht zentralisieren. HP-Verteilung, tatsächliche Verluste, Rettungsheilung und Life-Transition atomar abschließen. Der Lethal-Guard liefert eine fachliche Rettungsentscheidung statt selbst an fremdem Health vorbeizuschreiben. Terminale Facts vor Entfernung sichern. Death-Spawns/Folgecallbacks werden erst nach abgeschlossenem Target-Commit zugelassen.

Alte aktive Health-Writer beim jeweiligen Anschluss entfernen. Eine neue Einheit darf bis zu P4/P6 isoliert bleiben; kein zweiter synchronisierter Live-Health-Bestand. Regeneration und Cap-Reconciliation verwenden denselben Writer, ihre Taktung wird noch nicht verlagert.

**Nachweis:** V2 und Mutationsteil V4: Null/Overkill/Armor, Rettung mit Damage- und Heal-Anteil, einmaliger Tod, erneuter Zugriff auf entfernte Instanz, Init vs. Respawn. Passende bestehende Enemy-/Respawn-/Combat-Tests migrieren.

**Gate L:** Mutation-Receipt ist eigenständig korrekt, spätere Callbacks können ihn nicht ändern. Noch offene Damage-/Life-Anschlüsse schließen in P4/P6. **Danach P3.**

### P3 – Gemeinsame World-Geometrie und reine Queries

**Laden:** 02 §§ 4.1–4.2, 8, 14.3; Query-Zeilen aus § 16.\
**Voraussetzung:** P1-Contracts; Standardfolge nach P2.

**Einstiege:** `CombatGeometry`, `ArenaObstacleIndex`, `WorldGeometryBinding`, `arenaWorldQueries`, bestehende Direct-Hit-Regeln und `CombatSystem`-Queries.

**Arbeit:** Den bereits geteilten Hindernisindex unter die gebundene World-Geometrie führen. Sicht-/Schusslinie, sichere Mündung und benötigte Target-Maße über schmale Queries verfügbar machen. Keine zweite Index-Instanz für Projectile und Combat; Fire-/Light-Indizes nicht aus Symmetrie verschmelzen. Engine-Adapter von numerischen Regeln und Client-/Host-Datenquellen trennen. Bestehende Treffermaße als Gameplay-Geometrie übernehmen, nicht ungeprüft durch einen anders dimensionierten Physics-Radius ersetzen.

**Nachweis:** V6 Query-Teil und V1: Zug blockiert Schusslinie, korrekte Ausnahme beim gezielten Zugtreffer, zerstörter Zug kein Phantomblocker, World-Metrics/Rebind, Base-/Rock-Invalidierung, gleicher Output ohne Renderer. `CombatSystemLineOfFire` und `WorldGeometryBindingLifecycle` sind Einstiegstests, keine vorgeschriebenen endgültigen Namen.

**Gate L:** Queries ohne Damage-/Status-Mutation und ohne Combat-Instanz nutzbar. Hitscan/Melee-Auflösung folgt P8; übrige Consumer P10. **Danach P4.**

### P4 – Damage, Support, Modifier und Defense

**Laden:** 02 §§ 4–7, 10.1, 17.1; Target-Ports aus P2/P3.\
**Voraussetzung:** P2; benötigte Query-Verträge aus P3.

**Einstiege:** `applyDamage`, `applyEnemyDamage`, `applyBaseDamage`, `resolveExternalTargetDamage`, Runtime-Damage-Multiplier, Heal/Armor/Regen; Modifier-Callbacks aus `WorldCombatGameplayBinding`; Defense-Senken.

**Arbeit:** Gemeinsame Resolution mit eindeutiger Damage-Basis und aktueller Eligibility implementieren. Mutationen nur über die kanonischen Ports. Separate Heal-/Armor-/Repair-Bedeutung, tatsächliche Ergebnisse und Cap-Reconciliation wahren. Modifiers/Defense mit expliziter Host-Zeit und RNG speisen; Source- und Target-Faktoren nicht doppeln. Zentrale Damage-Regeln wissen nichts von Waffen-IDs, `NetworkBridge`, Sprites oder Respawn.

Vorhandene Shield-/Dome-Owner anbinden, nicht neu implementieren. Drei Projectile-Defense-Pfade nicht vermischen. Beziehung ist Domain-Policy; Support-Zulassung nicht als Negation von Damage ableiten. Noch nicht implementierte World-Mutationsports werden im fokussierten Test gefakt, nicht durch produktive Direktzugriffe ersetzt.

**Nachweis:** V2/V3; D1/D3/D5/D9 mit synthetischen, unterscheidbaren Faktoren; auch Basis/Struktur als Port-Target. Vollblock, Null-Damage-Support, Direct-vs.-Folgeschaden, Crit-Zulassung, Telefrag-Ausnahme und abgeleiteter Reaction-Damage.

**Gate L:** neue Regeln korrekt und Player-/Enemy-Damage-/Support-Writer angeschlossen; numerische Änderungen aus D3 sind begründet, keine pauschalen Balancekorrekturen. **Danach P5.**

### P5 – Status und zielgebundene Mechanikzustände

**Laden:** 02 §§ 9–10, 14.1–14.2.\
**Voraussetzung:** P4.

**Einstiege:** `BurnStateMachine`, Combat-Burn/Slow/Plasma-State, `WorldTargetingRuntime`, `TargetStatusSystem`, `PlasmaCharge`, Weapon-/Item-Reaktionsowner.

**Arbeit:** Burn als Combatant-Status mit bestehendem Regelkern anschließen. Allgemeine Slow-/Vulnerability-Daten beim passenden Target-Owner konsolidieren; Movement und Presentation lesen nur. Plasma-/AK47-nahe Mechanikzustände aus dem allgemeinen Damage-Core lösen, ohne aus target-weitem State versehentlich getrennte Shooter-Stacks zu machen. Status-Eligibility, vor/nach Damage liegende Anwendungen und Source-Ende gemäß 02 umsetzen.

Explizite Advance-/Prune-/Clear-Operationen mit passiven Reads. Keine versteckte Statusmutation in `getEnemyMovementFactor`, HUD- oder Snapshot-Abfrage. Periodische Methoden bereitstellen, aber nicht zusätzlich einen zweiten World-Tick installieren.

**Nachweis:** V5 und Statusanteil V4: Stack-/Expiry-/Catch-up-Parität, Slow-Merge, reine Reads, Target-Detach, Source-Tod vs. endgültiger Player-Detach, keine Double-Procs.

**Gate L:** ein Writer je Status; konkrete Mechanik-Trigger benannt, anschließbare Ports fertig. Frame-Anschluss folgt P11. **Danach P6.**

### P6 – Reaktionen, Tod, Attribution und Player-Lifecycle

**Laden:** 02 §§ 10–11, 4.3–4.4, 13.1, 14; D2/D4/D7/D10 aus § 17.\
**Voraussetzung:** P2/P4/P5.

**Einstiege:** `WorldCombatGameplayBinding`-Damage/Death/Kill-Callbacks, `PlayerCombatIntegrationPort`, `WorldPlayerGameplayRuntime`, `WeaponReactionRuntime`, `CoopMissionPlayerRuntime`, Respawn-Pfade, Timebomb/Necromancy und On-Kill-Consumer.

**Arbeit:** Parent-Outcome vor reentranten Folgen festhalten. Direkte Hit-Trigger, tatsächlicher Damage, Cull, Reflect, Leech, Kill und passive Statistik trennen; geordnete konkrete Aufrufe statt eines Event-Busses. Terminale Facts und Attribution ohne späteren Entity-Lookup bereitstellen. Activity-/Reward-Owner entscheiden XP, Budget und Missionsfolgen; Network bleibt Transport. Waffen-/Item-/World-Reaktionen bleiben ihren Owners zugeordnet.

Player-Lifecycle einschließlich Respawn-Deadline, Reconnect, Actor-Reaktivierung, Ressourcenreset und Budget-Commit aus dem Damage-Core lösen. Nur ein Commit nach gültiger Teilnahme, Life-Instanz und verfügbarem Actor; keine Timer-Reste. Vorhandene Player-in-World-/Activity-Anschlussstellen weiterverwenden. Enemy-/Decoy-Death-Folgen nach dem Mutation-Commit anschließen, Removal ohne Kill getrennt halten.

**Nachweis:** V4 und Player-/Enemy-Anteil V9: gegenseitiger Reflect, Cull nach nichttödlichem Parent, Rettung, Quelle/Victim bereits entfernt, zweimalige Death-Meldung, reentranter World-Teardown, mehrfacher Reconnect und Activity-Wechsel vor Respawn. Bestehende WeaponReaction-/Respawn-/Timebomb-Tests erweitern.

**Gate L:** lokale Damage-/Status-/Life-Kette geschlossen; keine XP-/Drop-Regeln im numerischen Core. World-Objekt-Folgen bleiben P9 zugeordnet. **Automatisch R2 im freigegebenen Block B; danach Nutzerstopp.**

### R2 – Semantik- und Reentrancyreview

**Laden:** 01; 02 §§ 4–7, 9–11, 17–18; realisierter Contract-Graph und Diffs P2–P6.

Unabhängig anhand öffentlicher Ergebnisse prüfen: ein Writer, tatsächlicher Damage trotz Rettung, Parent-/Child-Trennung, eindeutige Attribution, kein doppelter Kill/Reward, Quellen-/Life-/Activity-Ende, deterministische Zeit und keine mutable Reads. Mindestens ein kleiner integrierter Test der neuen Damage→Mutation→Reaction→Life-Kette muss laufen, nicht nur isolierte Mocks aller Stufen.

**Review-Gate R2:** die bis hier geschlossene Semantik ist belastbar; fehlende Anschlüsse passen in P7–P11. R2 verlangt keine fertige UI oder spielbare Arena. Blocking-Findings nach § 4.3 beheben und erneut prüfen; erwartete spätere Consumer-Migration ist kein Finding. **Block B endet hier; P7 erst nach ausdrücklicher Nutzerfreigabe C.**

### P7 – Projectile-Grenze auf neue Combat-Owner umstellen

**Laden:** 02 §§ 6, 10, 12–13; bestehende Projectile-Ports und tatsächlich betroffene Consumer.\
**Voraussetzung:** R2 technisch bestanden und weiterhin gültig; Block C vom Nutzer freigegeben.

**Einstiege:** `ProjectileCombatPort`, `ProjectileExplosionPort`, Combat-Direct-/Explosion-Implementierung, `WorldCombatGameplayBinding.bindProjectiles`, bestehende Barrier-/Swarm-/Injector-Anschlüsse.

**Arbeit:** Adapter hinter den bestehenden Ports implementieren. Source-Dimensionen erhalten; Direct nur Player/Enemy/Decoy. Actual-Damage/Death aus eigenem Mutation-Receipt, nicht HP-Reread. AK47/Plasma/Injector/Adrenalin genau einmal auslösen. Barrier/Defense-Ergebnisse weitergeben, Projectile-Mutation beim Projectile-Owner lassen.

Combat-AoE/Explosion-Key-Projektion und Same-Frame-Continuation vorbereiten; World-Fan-out aus P9 benutzt dieselben Contracts. Geprüfte Continuation-Key-Bedeutung erhalten. Keine neue Flight-, Physics-, Replica- oder Spawn-Technik und kein „C9“ des abgeschlossenen Projectile-Refactorings. Den Sweep-Vertrag aus 02 § 12.2 für rejected, nichtterminales Piercing und terminalen Impact anhand bestehender Tests erhalten.

**Nachweis:** V7, relevante V3/V4: rejected/blocked/support, Rettung/Cull, reflektierte Provenance, keine Double-Reaction, tatsächliche Damage-Keys, Mini-Rocket-Continuation am vorhandenen Flush-Punkt mit gefaktem World-Anteil. Mindestens ein Fall verbindet den realen Direct-Adapter mit dem realen Mutation-Writer: gleicher Receipt trotz Rettung oder nachfolgendem Cull, keine erneute HP-/Alive-Rückrechnung.

**Gate L:** alter Combat-Port-Produzent ersetzt; Runtime-Record-Zugriff ausgeschlossen. Vollständiger World-Fan-out folgt P9/P11. **Danach P8.**

### P8 – Hitscan, Melee, Chains und passive Vorschau

**Laden:** 02 §§ 6–8, 10.1/10.3, 13.1, 15.\
**Voraussetzung:** P3–P6.

**Einstiege:** alte Hitscan-/Melee-/Chain-Methoden, `WorldWeaponExecutionRuntime`, `WeaponFireExecutor`, `ClientUpdateCoordinator`-Vorschau; vorhandene `combat/rules`.

**Arbeit:** Unmittelbare Capabilities auf Query→Resolution→Mutation umstellen. Bestehende Normalisierung der Weapon-Execution nutzen; lange Legacy-Aufrufketten entfernen. Gameplay-Mündung, Cursor-Range, Favor-the-Shooter, Support-Selbsttreffer und Detonationsreihenfolge bewahren. Melee-Grundmenge vor erster Mutation festlegen; eigene Chain-Hop-/LoS-Semantik beibehalten. Weltobjekttreffer über den vorgesehenen Domain-Port aus P9 beauftragen.

Client-Vorschau nur auf replizierter Geometry/Eligibility ohne Damage-/Status-/Reward-Capabilities. Tracer/Swing/Hit-Projektion von der Entscheidung trennen. Noch keine optische Neugestaltung.

**Nachweis:** V6/V8 und Trigger-Parität: gemeinsam genutzte Blocker, hinter Felsen/Zug, mehrere Base-Zellen, keine Double-Hits, Support bei null Damage, Chain/Detonable, Prediction ohne Mutation.

**Gate L:** unmittelbare Attack-Logik und lokale Vorschau sind unabhängig vom Legacy-Combat. World-Target-Ports dürfen bis P9 noch isolierte Testprovider haben. **Danach P9.**

### P9 – World-Mutation, Reparatur und Domain-Fan-out

**Laden:** 02 §§ 5.3, 6–7, 11.1–11.2, 13, 16; D6/D8 aus § 17.\
**Voraussetzung:** P4/P6–P8.

**Einstiege:** `RockHpRegistry`/`RockRegistry`, `PlacementSystem`/`ConstructionWorldRuntime`, Base-/Train-Owner; `RockVisualHelper`-Damage/Repair/Destroyed; `arenaWorldQueries`; Host-/Support-/Nuke-/Grenade-/Environment-Fan-out; Base-/Podest-Bindings.

**Arbeit:** World-Writer um atomare Damage-/Repair-/Destroyed-Ergebnisse erweitern, ohne HP zu Combat zu verschieben. Mutation, physische/Grid-Entfernung und fachlicher Cleanup dürfen nicht vom Renderpfad abhängen. Rock-Collapse, Armor-Drop, Podest-Deregistrierung, Base-Objective-Folgen und Train-Removal über bestätigte Outcomes genau einmal ausführen. Ursache Damage/Decay/Removal/Teardown erhalten.

Schmale World-Orchestrierung verbindet Combat, Environment, Impulse und Fields/Spawns. Gemeinsame Mehrziel-Einheiten vor ihrer ersten Mutation vorbereiten; spätere Cluster/Explosionen bleiben eigenständig. Kein universeller Explosion-Manager, kein Durchreichen aller Systeme. Gemeinsame Damage-Regeln wiederverwenden, spezielle Environment-/Support-Policies beim Fachowner belassen. Neue Podest-Lifetime-Korrektur erhalten; TD-10/RK-6 nicht mitplanen.

**Nachweis:** V8/V9: dieselbe Struktur über Rock-/Construction-Alias nur einmal, Repair/Destroyed ohne Renderer, doppelte Removal, indestructible/inert, Collider-freies Konstrukt, Death-Spawn erst in späterer Wirkung, World-Podest über Activity-/Arena-Zeitwechsel, tatsächliche World-Damage-Keys.

**Gate L:** keine fachliche Mutations-/Cleanup-Authority mehr in den berührten Visual-Helfern; der vorbereitete World-Fan-out funktioniert gegen reale Zielowner in einem kleinen Headless-Integrationstest. **Danach P10.**

### P10 – Verbleibende Consumer auf vorhandene Capabilities migrieren

**Laden:** 02 § 16; je Consumer nur zugehörige §§ 4, 6–9 oder 11–13.\
**Voraussetzung:** P7–P9; Ports und Bedeutungen stehen fest.

**Einstiege:** verbleibende produktive Combat-Imports per `rg`; insbesondere HostPhysics, Burrow, Tunnel, Translocator, Turret/Tesla, RepairDrone/Guardian, PowerUps, WorldTrain/Support, `CoopMission*Composition`, EnemyAttack/Ability/Dodge/Positioning, Upgrade-/Item-Consumer und Balance-Lab.

**Arbeit:** Clusterweise die tatsächlich benötigten Capabilities injizieren und alte Concrete-Types entfernen. Source-Slot/-Kind, Rückgabebedeutung, Zeit und gespeicherte Target-Instanz korrekt übersetzen. Ein kleiner Lookup/Read braucht nicht die ganze Combat-Boundary. Bereits erledigte Consumer nicht neu umgestalten. Tests und Lab auf die gemeinsamen Regeln/öffentlichen Ports heben, keine zweite Formel.

Ein Consumer mit unerwarteter eigener Damage-/Reward-/Lifecycle-Regel ist **kein mechanisches Rename**: ihn dem entsprechenden Contract und Owner zuordnen; bei ungelöster Semantik gezielt eskalieren, nicht im Adapter konservieren. Kein allgemeiner AI-/Enemy-/Physics-Rewrite.

**Nachweis:** betroffene bestehende Consumer-Tests und V3/V9/V12-Anschlüsse; Suche zeigt nur noch ausdrücklich bis P11/P12 geführte Composition-/Legacy-Reste. Fokus auf Telefrag, Zug/Pusher-Attribution, Alliierte/Turret-Quelle und echte Modifier-Rückgaben.

**Gate L:** Consumer-Cutover vollständig zugeordnet; offene reine Endverdrahtung in 04 eng benannt. **Danach P11.**

### P11 – Gesamtgraph, Frame, Network und Presentation schließen

**Laden:** 02 §§ 2, 4.1, 14–16; realisierte Ports aus 04.\
**Voraussetzung:** P2–P10 funktional abgeschlossen.

**Einstiege:** `ArenaWorldGameplayComposition`, alle betroffenen `ArenaWorld*Composition`, `WorldRuntime`, `ArenaLifecycleCoordinator`, Player-Composition, `WorldCombatGameplayBinding`, Host-/Client-/RPC-Coordinator und bestehende Snapshot-/FX-Adapter.

**Arbeit:** Build/Bind/Activate und umgekehrte Besitz-/Detach-Reihenfolge integrieren. Combat aus Scene-Ownership lösen, Activity nur über austauschbare Policy/Target-Bindings. Fachliche Rules aus Host-/Binding-Callbacks sind bereits umgesetzt und werden nicht hier neu erfunden. Required Ports vor Aktivierung prüfen; alte Leases dürfen neue Bindings nicht entfernen.

Host-Zeit am Frame-/Action-Eintritt bereitstellen; alle bisherigen relativen Stages erhalten, Burn/Regen/Respawn nicht doppelt takten. Insbesondere Vitals-Regen weiterhin nach Item-Update und vor Burrow-/Loadout-/Weapon-Reaction-Verarbeitung prüfen, nicht nur die Anzahl der Tick-Aufrufe. Projectile-Interaction/Finalisierung/PostProjectile/deferred Feedback nicht verschieben. Bestehende Network-Snapshots und FX-RPCs aus Read Models/Outcomes bedienen; keine neue Combat-Replica. Flight-Signature-Profile, Pfadhistorie, terminale Nachlieferung und verzögertes Playback gemäß 02 § 15.1 erhalten, ohne daraus Combat-/Target-Authority abzuleiten. Host ohne lokale Presentation und Client-Preview ohne Player-Runtime unterstützen.

**Nachweis:** V1/V9/V10: World ohne Activity, Activity-Rebind, Leave/Reconnect, Rebuild derselben World-Revision, stale Callback, Preview/Late-Join, Bootstrap/Removal, Host/Client-FX-Korrelation und vollständige Outcome→Domain-Folgen-Kette. Kein Renderer als Erfolgsbedingung.

**Gate L:** produktiver Zielgraph vollständig angeschlossen, keine absichtlich unverdrahteten Funktionspfade mehr. Verbleibende technische Fehler sind konkrete Befunde, nicht mehr geplante Integrationslücken. **Danach P12.**

### P12 – Legacy beseitigen und dauerhafte Grenzen sichern

**Laden:** 02 §§ 3.2, 16–18; aktuelle Test-/Knowledge-Policy.\
**Voraussetzung:** P11.

**Arbeit:** Produktiven `CombatSystem`, `ctx.combatSystem`-Zugriffe, alte Type-Reexports, Setter-Fallbacks, tote Maps/Timer und befristete Delegationsfassaden entfernen. Breite Bindings dürfen als Composition bestehen, aber nicht als versteckter neuer Gameplay-Owner. Keine künstliche File-/Klassenanzahl als Erfolgskriterium.

Bestehende Architecture-Suite um wenige dauerhafte Dependency-/Writer-/Read-Regeln erweitern, möglichst anhand Types/TypeScript-Syntax statt Sourceform. Überholte Tests migrieren oder bei fehlendem Schutzwert entfernen. `docs/ai/gameplay.md`, `architecture.md` und `networking.md` nur an tatsächlich verifizierten neuen Combat-Grenzen aktualisieren; historische Refactoring-Dokumente nicht umschreiben. Kein pauschaler neuer Test-/Browser-Workflow.

**Nachweis:** V11; Quellen-/Import-/Writer-Suche plus relevante Runtime-Tests; Lab-/Harness-Verbindungen kontrollieren. Alle in § 3.2 geplanten Übergänge sind geschlossen. Ein echter noch offener Defekt wird als solcher mit kleinem Repro an P13 übergeben, nicht als erledigte Abnahme.

**Gate L:** keine produktive Legacy-Authority oder geplante offene Migration, Dokumente/Types/Status stimmig. **Danach P13.**

### P13 – Unabhängiger Architekturabschluss und technische Endabnahme

**Laden:** 01 vollständig; 02 §§ 16–18 und betroffene Detailcontracts; § 6 dieses Plans; aktueller Code, nicht nur die bisherigen Findings.

**Arbeit:** Das gesamte Zielbild unabhängig prüfen, einschließlich ausgelagerter Regeln in World/Activity/Player/Network/Presentation. Durch einen erneuten Consumer-/Writer-Audit nach versteckten Restsystemen suchen. V1–V12 gegen vorhandene Nachweise abgleichen; kein grüner Einzeltest ersetzt die Ownership-Prüfung. Inzwischen relevante `main`-Änderungen an einem ruhenden Checkpoint vergleichen; notwendige Integration gemäß § 1.1 durchführen und deren Auswirkungen erneut prüfen.

P13 ist die vom Orchestrator geführte Abschlussphase mit **separatem Read-only-Reviewer**. Reproduzierbare Findings werden nach 05 und § 4.3 an Luna / XHigh oder den identifizierenden Astra-Agenten gegeben. Wechselt dieser Astra zum Writer, prüft ein anderer frischer Astra-Kontext den Fix; niemand gibt die eigene Änderung frei. Anschließend muss die vollständige Gate-Matrix auf dem **finalen Produktionscode** bestehen; bereits auf exakt diesem Code erfolgreiche Gates nicht nochmals laufen lassen.

Review-, Test- und finaler Code-Stand müssen übereinstimmen; letzte Reparaturen dürfen keinen vorherigen Pass erben. Der Orchestrator dokumentiert den verifizierbaren Code-Anker und fasst die Ergebnisse in 04 zusammen. Bei nicht bestandener Endabnahme bleibt P13 aktiv/blockiert, M offen. Keine Testzahlen als dauerhafte Zielmetrik.

**Gate F:** § 6 vollständig erfüllt; keine aktive Transition, kein offener In-Scope-Defekt. 04: „technisch/architektonisch abgeschlossen; manuelle Abnahme offen“. **Danach M, keine weitere automatische Refactoring-Phase.**

## 6. Finale Abnahme

### 6.1 Technische Gate-Matrix für P0 und P13

| Lauf | Aussage |
|---|---|
| `npm run check` | Core + Architecture + TypeScript/Build |
| `npm run test:integration` | World-/Activity-/Composition-Verträge |
| `npm run test:stress` | Last, Reentrancy-/Queue-Grenzen, relevante Hot Paths |
| `npm run test:balance-lab` | vorhandene Runtime-/Lab-Parität; Abweichungen nur aus erklärten D-Korrekturen |
| `npm run test:assets` | bestehende Asset-/Render-Verträge bleiben intakt |
| `git diff --check` | keine Whitespace-/Patchfehler |

Ein gesonderter Typecheck ist für F nicht nochmals nötig, wenn `check` auf demselben Endstand erfolgreich den TypeScript-Build ausgeführt hat. Das ist ein vollständiger Typnachweis, keine abgeschwächte Abnahme. Zusätzliche spezifische V-Nachweise laufen nur, soweit sie nicht schon von den obigen Suites erfasst sind.

### 6.2 Architektur-Exit

Alle folgenden Bedingungen sind notwendig: einzige world-owned Combat-Boundary; ein Writer pro State mit atomaren Transitions; keine produktiven Legacy-/Fallback-Pfade; echte Source-/Outcome-Verträge; passive Reads; Status/Resources/Rewards bei passenden Ownern; gemeinsame Geometrie; Projectile-Nachbarcontracts unbeschädigt; vollständiger World-Mutations-/Cleanup-Pfad ohne Renderer-Authority; geordnete Stages/Teardown; kein doppelter Tick, Hit, Kill oder Reward; keine neue generische Infrastruktur. Die gesamte Nachweismatrix aus 02 § 18 ist durch konkrete vorhandene Tests/Prüfungen abgedeckt.

Performance wird gegen reproduzierbare Baseline-Szenarien beurteilt, nicht anhand zufälliger Einzelmessungen. Kein neues Vollwelt-Scanning pro Einzeltreffer, keine unbeschränkte History und kein pauschales Allokieren kompletter World-Snapshots. Eine echte Regression wird behoben, ein Messrauschen nicht als Architekturumbau missverstanden.

### 6.3 M – Einmalige menschliche Gameplay-/Sichtabnahme

**Erst nach P13.** Die KI bereitet eine kleine Prüfliste vor; der Nutzer führt sie durch. Ein technischer Abschluss beweist keine visuelle oder praktische Spielbarkeit.

| Bündel | Manuell prüfen |
|---|---|
| World und Teilnahme | Testgelände ohne Mission; Mission starten/beenden; Lobby zurück und erneut betreten; Host/Client-Join und Reconnect nach Tod |
| Treffer und Support | Projectile, Hitscan, Melee; Fels/Base/Zug als Blocker; Support-Selbstheilung/Strukturreparatur; Damage/Armor/Regeneration/Respawn sichtbar plausibel |
| Spezialfälle | Schild-/Dome-Reflection, ASMD-Detonation, Mini-Rocket-Folgeexplosion/Rückkehr, AK47/Plasma und mindestens eine Cull-/Reflect-/On-Kill-Kette |
| World-Folgen | zerstörte Felsen/Konstrukte verschwinden korrekt, keine Phantomblocker, Drops und Podest-Respawns; eigene/verbündete/feindliche Quellen |
| Multiplayer und Last | dieselben Host-/Client-Ereignisse ohne Doppel-FX/Kills; späte Teilnahme; typische Horde/Flächenwirkung ohne auffällige neue Hänger |

Nur auffällige Ergebnisse werden mit Repro an P13 zurückgegeben. Keine automatische Browserkampagne und keine Forderung, alle Weapon-/Upgrade-Kombinationen manuell durchzuspielen. Erst nach erfolgreicher M-Abnahme darf 04 den vollständigen Abschluss behaupten.

## Quellen und vorhandene Leitplanken

Der intensive Codeabgleich und seine Quellen stehen in 02; Phaseneinstiege sind dort verankert. Der Plan legt keine zusätzlichen fachlichen Regeln gegenüber 01/02 fest.

[^tests]: [`AGENTS.md`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/AGENTS.md), [`package.json`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/package.json) und [`docs/ai/testing.md`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/ai/testing.md). Die abweichende Zwischenstandsführung dieses Refactoring-Branches folgt ausdrücklich dem Arbeitsauftrag; sie ändert nicht die allgemeinen Release-/Testanforderungen des Repositorys.
