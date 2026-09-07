# Fragdachse – Combat Runtime: einfacher Desktop-Ablauf

**Zweck:** Einmaliges Refactoring in der Codex-Desktop-App, ohne eigene Agentenarchitektur. 01/02 definieren die Architektur, 03 den Plan, 04 den Arbeitsstand. Dieses Dokument regelt nur die Bedienung und Modellwahl.

**Fachliche Basis:** unverändert `d5cb4519fb06dd74e22d21e8d63e635ea75bbc26` vom 06.09.2026. Diese Ausgabe vereinfacht den Betrieb; sie behauptet keinen neuen Repository- oder Spieltest. P0 prüft den tatsächlichen Checkout gegen die Planbasis.

## 1. Start ohne Zusatzkonfiguration

Die Dokumente 01–05 gemeinsam unter `docs/GDDs/Combat Runtime Refactor/` ablegen. Einen schon fortgeschriebenen Status 04 nicht mit dieser leeren Vorlage überschreiben. Projekt in der Codex-Desktop-App öffnen, **Sol / Medium** als Hauptmodell wählen und den Auftrag aus § 4.1 einfügen.

**Keine neue `.codex/config.toml`, keine `.codex/agents/`, keine CLI-Installation, kein SDK, kein Runner und keine neue Skill-Struktur.** Vorhandene `AGENTS.md`-/Skill-/Berechtigungsvorgaben bleiben erhalten. Das frühere Paket mit den TOML-Rollen wird für diesen Ablauf nicht benötigt. Bereits übernommene Dateien daraus nur gezielt zurücknehmen; niemals pauschal persönliche oder anderweitig genutzte Konfiguration löschen. Danach einen neuen App-Chat verwenden.

Der Hauptchat ist der **Orchestrator**: eine Aufgabe im Gespräch, kein zusätzliches Programm. Er vergibt abgegrenzte Aufträge an native Subagenten und führt 04. Codex unterstützt direkte Subagentenaufträge und die Anforderung von Modell/Reasoning per Prompt; Custom-Agent-TOMLs sind eine zusätzliche Option, keine Voraussetzung.[^agents]

## 2. Drei Arbeitsblöcke und Modellwahl

| Block | Automatische Folge | Ende |
|---|---|---|
| A | kurzer Startcheck → P0 → P1 → unabhängiges R1 | Ergebnis vorlegen; Freigabe B abwarten |
| B | P2 → P3 → P4 → P5 → P6 → unabhängiges R2 | Ergebnis vorlegen; Freigabe C abwarten |
| C | P7 → P8 → P9 → P10 → P11 → P12 → P13 | technische Endabnahme; M bleibt beim Nutzer |

Innerhalb des Blocks nach bestandenem lokalem Gate weiterarbeiten, nicht nach jeder Phase um Erlaubnis fragen. Die Standards sind **zwei geplante Freigabestopps und die abschließende manuelle Abnahme**, keine Garantie gegen technische oder fachliche Unterbrechungen. Ein Review-Pass erteilt keine Nutzerfreigabe.

### 2.1 Auswahl nach Aufgabe statt gespeicherter Rollen

Die Bezeichnungen Luna, Sol und Astra entsprechen der bisherigen Arbeitsplanung. Sie sind Empfehlungen für diesen Refactor, keine gemessene Kosten- oder Qualitätsgarantie. Tatsächlich verfügbare Modellbezeichnungen der App bzw. des Delegationswerkzeugs verwenden; keine technischen IDs aus sichtbaren Namen erfinden.

| Aufgabe | Modell / Reasoning | Grund |
|---|---|---|
| Hauptchat | Sol / Medium | Aufträge, Checkpoints, Belege und Status |
| P0 | Luna / Medium | Baseline und Delta-Abgleich |
| P1 | Sol / High | Contracts und Gesamtaufbau |
| R1 | Astra / High | unabhängiges Vertragsreview |
| P2 | Sol / High | atomare Mutation und Rettung |
| P3 | Luna / High | vorbereiteter Geometrie-/Query-Cut |
| P4 | Astra / High | Damage, Modifier und Defense |
| P5 | Sol / High | Status und Mechanik-Lifetimes |
| P6 | Astra / High | Reentrancy, Tod, Attribution, Respawn |
| R2 | Astra / High | unabhängiges Semantikreview |
| P7–P9 | Sol / High | Projectile-, Attack- und World-Anschluss |
| P10 | Luna / High | Consumer an fertige Contracts anbinden |
| P11 | Sol / High | Gesamtgraph, Zeit und Ausgabe |
| P12 | Luna / High | Legacy-Cleanup und Ratchets |
| P13 | Astra / High | unabhängige technische Endprüfung |
| M | Nutzer | praktische Gameplay-/Sichtabnahme |

Pro Phase möglichst ein abgegrenzter Subagentenauftrag; keine Spezialrolle pro Methode, kein Unteragentenbaum. Kleine geklärte Folgekorrekturen im bestehenden Kontext erledigen. P0 darf der Hauptchat bei fehlender Luna-Delegation selbst übernehmen. Für anspruchsvollere Phasen gilt die Auswahl oben; ein notwendiger Modellwechsel wird nicht nur behauptet.

P3/P10/P12 bei sichtbar gewordener ungeklärter Fachsemantik zu Sol / High eskalieren. Astra gezielt bei Ownership-/Source-/Lifecycle-Konflikten einsetzen. Reparaturlimits aus 03 § 4.3 gelten unverändert. Kein pauschales Hochstufen aller Folgephasen.

### 2.2 Wenige Arbeitsregeln

**Nur ein Writer:** Während ein Subagent implementiert, schreibt der Hauptchat nicht mit. Der Hauptchat prüft anschließend die Lieferung, führt 04 und erstellt lokale Phasen-Commits. Reviewer arbeiten ohne Dateiänderungen in einem frischen Kontext. Das ist eine ausdrückliche Arbeitsregel, keine durch diese Dokumente erzeugte technische Sandbox.

**Nur nötigen Kontext:** Lesevertrag aus 03 § 1 einhalten. Worker erhalten Phasenkarte, zugeordnete 02-Abschnitte, relevante Contracts und Code; keine vollständigen Vorgängeranalysen. Kurze Rückgabe nach 03 § 4.2. Der Hauptchat wiederholt nicht die gesamte Recherche.

**Nur passende Prüfungen:** lokale Gates pro Phase; vollständige Matrix in P0/P13. Bereits für denselben Code belegte Tests nicht doppelt ausführen. Nach relevanten Änderungen Belege erneuern. Bekannte Integrationslücken bleiben nur mit Ursache und Schließphase zulässig. Keine Browserprüfung, kein automatisches Push/Merge/Deployment.

**Review-Schleifen:** Nach dem initialen R1-, R2- oder P13-Review darf der Orchestrator bei lokalen Blocking-Findings automatisch bis zu zwei begrenzte Fix-/Wiederholungsreview-Schleifen anstoßen. Damit ist Review 3 die letzte automatische Prüfung. Bleiben dort Blocker, endet der Block zur manuellen Nutzerprüfung. Fixes schreibt der passende Implementierungsagent; jedes Wiederholungsreview läuft read-only in einem frischen unabhängigen Kontext auf dem neuen Fix-Checkpoint. Grundlegende Vertragskonflikte aus 03 § 4.3 stoppen sofort.

Subagenten sind nicht kostenlos: Ihre zusätzlichen Modell-/Tool-Aufrufe verbrauchen weitere Tokens. Die geplante Ersparnis entsteht aus begrenztem Kontext und passender Aufgabenverteilung, nicht aus möglichst vielen Agenten.[^agents]

## 3. Kurzer Startcheck und einfacher Rückfallweg

Vor P0 lediglich Arbeitsbranch, Working Tree, vorhandene Projektinstruktionen und benötigte Node-/npm-Werkzeuge prüfen. Nutzeränderungen bewahren. Die Hauptsitzung soll Sol / Medium verwenden. Keine Teststarts aller Modelle, kein Rollenmanifest und kein Versionsaudit als eigenes Arbeitspaket.

**Delegation bei der ersten echten Aufgabe prüfen:** Modell und Reasoning beim Start ausdrücklich anfordern. Ohne entsprechende Auswahl können Subagenten die Einstellungen des Hauptagenten erben.[^agents] Nur sichtbar bestätigte Einstellungen als bestätigt melden; eine Selbstauskunft des Modells ist kein Laufzeitnachweis. Bei fehlender Auswahl für die nächste anspruchsvolle Aufgabe einen gezielten Nutzerstopp setzen, statt Konfiguration zu erzeugen oder angeblich als anderes Modell weiterzuarbeiten.

**Kein Subagent verfügbar:** P0 kann im Hauptchat erfolgen. Anschließend denselben Phasenplan im passend gewählten Hauptmodell innerhalb des freigegebenen Blocks abarbeiten; beim nächsten erforderlichen Modellwechsel kurz anhalten. R1/R2/P13 dann in einem neuen App-Chat mit Astra / High prüfen lassen. Ein Selbstreview im Implementierungschat ersetzt diese Reviews nicht. Dies ist der erlaubte Rückfallweg ohne neue Infrastruktur; er kann mehr Bedienung erfordern.

**Goal optional:** Die dokumentierte Funktion `/goal` unterstützt die Weiterarbeit über mehrere Turns bis zu einer Stoppbedingung.[^goals] Wird sie in der App angeboten, pro Lauf ausschließlich den freigegebenen Block als Ziel setzen. Fehlt sie, den normalen Mehrphasenauftrag verwenden. Endet dieser vorzeitig, § 4.4 nutzen. Keine Clientkonfiguration automatisch ändern; kein CLI-Befehl ist Voraussetzung. Auch ein Goal ersetzt keine Freigabe-, Berechtigungs- oder Prüfgrenze.

## 4. Kopierbare Aufträge

### 4.1 Start: nur Block A

```text
Bearbeite das Combat-Runtime-Refactoring gemäß
"docs/GDDs/Combat Runtime Refactor/01–05" in der Codex-Desktop-App.
Du koordinierst im Hauptchat; verwende bei Bedarf native Subagenten
mit der Modell-/Reasoning-Empfehlung aus 05, keine gespeicherten Rollen.
Keine neue Agentenkonfiguration, TOML-Dateien, Skills oder Runner anlegen.

Freigegeben ist ausschließlich Block A: kurzer Startcheck, P0, P1, R1.
Arbeite nach lokalen Gates selbständig weiter. Pro Phase ein begrenzter
Auftrag, höchstens ein Writer. R1 in einem frischen Review-Kontext.
Bei fehlender Modellwahl/Delegation gilt der einfache Rückfallweg aus 05.

Du führst 04 und erstellst lokale geprüfte Phasen-Commits auf einem
Refactoring-Branch. Bestehende Nutzeränderungen bewahren. Keine Browser-
prüfung, kein Push/Merge/Deployment, keine Änderung der Zielarchitektur.
Lese nur die nach 03 nötigen Abschnitte; begrenzte Reparaturschleifen.

Verwende ein natives Goal für genau diesen Block, soweit verfügbar;
sonst den normalen Auftrag. Ende mit R1-Ergebnis und Freigabeempfehlung
oder einem konkreten Blocker. P2 nicht beginnen.
```

### 4.2 Nach R1: Block B

```text
Block B ist freigegeben: P2 bis P6 und anschließend unabhängiges R2.
Prüfe 04, Git-Stand und Gültigkeit von R1. Arbeite nach 03/05 automatisch
weiter, ohne neue Agentenkonfiguration. Nach R2-Ergebnis anhalten;
P7 nicht beginnen. Kein Browser, Push/Merge/Deployment.
```

### 4.3 Nach R2: Block C

```text
Block C ist freigegeben: P7 bis P13. Prüfe 04, Git-Stand und Gültigkeit
von R2. Folge 03/05 ohne neue Agentenkonfiguration. P13 benötigt ein
unabhängiges Review und die technischen Gates auf dem finalen Code;
Reviewer ändern ihre Prüfgrundlage nicht selbst. Kein Browser,
Push/Merge/Deployment. Manuelle Abnahme M bleibt offen.
```

### 4.4 Fortsetzen nach Unterbrechung

```text
Setze ausschließlich den in 04 bereits freigegebenen Arbeitsblock fort.
Gleiche Status, Git, uncommittete Änderungen und offene Agenten ab;
wiederhole keine abgeschlossene Phase blind. Fahre mit der nächsten
zulässigen Aufgabe bis zum bestehenden Blockstopp fort. Keine neue
Infrastruktur, keine zusätzliche Blockfreigabe, keine Browserprüfung.
```

### 4.5 Review im separaten App-Chat, falls Delegation fehlt

```text
Prüfe den aktuell ausstehenden Review-Punkt R1, R2 oder P13 gemäß 04
und der zugehörigen Karte in 03. Lies 01, die betroffenen 02-Verträge,
den tatsächlichen Code/Diff und Nachweise. Keine Dateiänderungen,
kein Browser. Melde überprüfbare Findings und bestanden / nicht bestanden /
nicht ausreichend verifiziert samt geprüftem Code-Stand. Erteile keine
Freigabe für den Folgeblock. Fordere notwendige Testbelege konkret an.
```

Das Ergebnis an den koordinierenden Chat zurückgeben; dieser trägt es in 04 ein. Bei Findings gelten die höchstens zwei automatischen Fix-/Wiederholungsreview-Schleifen aus 03 § 4.3; nach einem weiterhin negativen Review 3 wird angehalten. Nach A/B genügt bei bestandenem Review normalerweise die nächste Blockfreigabe; nach C folgt M gemäß 03 § 6.3.

## Technische Quellen

Nur bei Betriebsfragen laden, nicht in jedes Worker-Kontextpaket übernehmen. Lokale App-/Account-Funktionen wurden durch diese Dokumenterstellung nicht ausgeführt oder verifiziert.

[^agents]: OpenAI, [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), geprüft am 06.09.2026: direkte Aufträge, Modell-/Reasoning-Anforderung, Vererbung und optionale Custom Agents.
[^goals]: OpenAI, [Follow a goal](https://learn.chatgpt.com/use-cases/follow-goals), geprüft am 06.09.2026: Zielverfolgung über Turns mit begrenztem Ziel und Stoppbedingung.
