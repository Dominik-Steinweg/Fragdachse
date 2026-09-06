# Fragdachse – Combat Runtime Migration Status

**Architektur:** [01](01_Combat_Runtime_Architecture_Core.md) + [02](02_Combat_Runtime_Architecture_Details.md) · **Plan:** [03](03_Combat_Runtime_Implementation_Plan.md) · **Betrieb:** [05](05_Combat_Runtime_Implementation_Cheatsheet.md)

> Einziger operativer Status; keine Historie. **Nur der Orchestrator schreibt diese Datei.** Worker liefern Belege, Reviewer ein Urteil. Keine Interface-Kopien, Vollinventare oder Rohlogs. Nur wenige aktuelle Git-Anker gemäß 03 § 4.4; keine SHA-Chronik. Zielgröße unter 8 KB.

## 1. Steuerung und aktueller Stand

| Feld | Aktueller Wert |
|---|---|
| Gesamtstatus | Dokumente für den einfachen Desktop-Ablauf vorbereitet; Combat-Implementierung nicht begonnen |
| Freigegebener Arbeitsblock | **Keiner** – erst der tatsächliche Nutzer-Startauftrag gibt A frei |
| Freigabequelle | Noch kein Startauftrag in der Implementierungssitzung |
| Nächster Arbeitsschritt | Kurzer Startcheck aus 05, anschließend P0 im freigegebenen Block A |
| Nächster geplanter Nutzerstopp | Nach R1; P2 benötigt gesonderte Freigabe B |
| Aktive Phase / Aufgabe | Keine |
| Arbeitsbranch / lokaler Checkout-HEAD | Noch nicht erhoben |
| Start-HEAD der laufenden Aufgabe | Keiner |
| Aktiver Worker / Thread | Keiner |
| Betriebsmodus | Codex-Desktop-App; native Subagenten per Auftrag, keine eigene Agentenkonfiguration |
| Aktuell nötiger Modell-/Reviewstopp | Keiner festgestellt; lokale Verfügbarkeit noch nicht erprobt |
| Aktueller Reparaturzähler | Kein offenes Reparaturpaket |
| Technische Endabnahme F / manuelle Abnahme M | Beide offen |
| Browserprüfung / Deployment | Nicht beauftragt, nicht durchgeführt |

Analysegrundlage: `main` @ `d5cb4519fb06dd74e22d21e8d63e635ea75bbc26` vom 06.09.2026. Der lokale Checkout kann davon abweichen. Projectile ist laut eigenem Status einschließlich C8 abgeschlossen; Sweep-Endpunkterhalt und Flight Signature sind in dieser neueren Analysebasis enthalten. Das ersetzt weder den lokalen Startcheck noch P0/F für Combat. Die Betriebsvereinfachung ist kein neuer Quellcode-Abgleich.

**Freigaberegel:** R1-Pass ≠ Freigabe B; R2-Pass ≠ Freigabe C. Der Orchestrator übernimmt eine Freigabe nur aus einer tatsächlichen Nutzernachricht und notiert sie knapp. Nach Blockende wartet er; die Spalte „nächste Aufgabe“ erteilt keine Arbeitsberechtigung.

## 2. Phasen und Review-Gates

⬜ offen · 🟨 aktiv · 🟧 blockiert · ✅ gemäß eigenem Gate abgeschlossen.

✅ bei P1–P12 bedeutet lokales Gate L, **nicht** spielbar oder global grün. Geplante Übergänge stehen in § 4. Ein noch nicht committierter Abschluss nach Unterbrechung muss gegen Git geprüft werden.

| Schritt | Block | Status | Gegenstand |
|---|:---:|:---:|---|
| P0 | A | ⬜ | Baseline / Delta |
| P1 | A | ⬜ | Contracts / World-Aufbauplan |
| R1 | A | ⬜ | Vertragsreview; danach Nutzerstopp |
| P2 | B | ⬜ | Combatant-Mutation |
| P3 | B | ⬜ | Geometrie / Queries |
| P4 | B | ⬜ | Damage / Support / Modifier / Defense |
| P5 | B | ⬜ | Status / Mechanikzustände |
| P6 | B | ⬜ | Reaktionen / Death / Kill / Player-Lifecycle |
| R2 | B | ⬜ | Semantikreview; danach Nutzerstopp |
| P7 | C | ⬜ | Projectile-Adapter |
| P8 | C | ⬜ | Hitscan / Melee / Preview |
| P9 | C | ⬜ | World-Mutation / Domain-Fan-out |
| P10 | C | ⬜ | Verbleibende Consumer |
| P11 | C | ⬜ | Gesamtgraph / Frame / Network / Presentation |
| P12 | C | ⬜ | Legacy-Entfernung / Ratchets / Wissen |
| P13 | C | ⬜ | Unabhängiger Abschluss / technisches Gate F |
| M | Nutzer | ⬜ | Gebündelte Gameplay-/Sichtabnahme |

## 3. Realisierte Contracts

Noch keine neuen Combat-Contracts realisiert. P1 trägt nur tatsächliche Namen und Dateipfade für die benötigten CF-Familien aus 03 § 3.1 ein. Spätere Phasen verwenden sie, statt parallele Typen anzulegen.

Vorhandene Nachbargrenze: `ProjectileCombatPort`, `ProjectileDirectImpactRequest/Outcome`, `ProjectileCombatExplosionRequest/Outcome`, `ProjectileExplosionResolutionPort` und Continuation. Vorhanden bedeutet nicht bereits an neue Combat-Owner angeschlossen.

## 4. Aktive Übergänge und Blocker

Keine Implementierung begonnen; keine als aktiv behauptete Migration.

Nur tatsächliche offene Punkte eintragen:

| Art / Befund | Betroffene Grenze und Ursache | Schließphase / nächste Aktion |
|---|---|---|
| – | – | – |

Erlaubte Arten: geplanter Integrationsübergang, bestehender Baseline-Fehler, neue Regression, Contract-Blocker oder Betriebsblocker. Keine Sammelausnahme „alles rot wegen Refactoring“. Übergänge nach Schließung löschen. Abweichende fachliche Entscheidungen nicht allein über 04 legitimieren.

## 5. Nachweise und Reviews

**P0-Baseline:** nicht ausgeführt. **Letztes lokales Gate:** keines. Kein früherer Projectile-Testlauf wird hier als Combat-Nachweis übernommen.

| Review | Ergebnis | Geprüfter Code-HEAD | Offene Blocking-Findings |
|---|---|---|---|
| R1 | Nicht ausgeführt | – | – |
| R2 | Nicht ausgeführt | – | – |
| P13 | Nicht ausgeführt | – | – |

Nach Tests nur Befehl/Testgruppe, Exit-Code, Ergebnis und gültigen Code-Bezug festhalten. Abgebrochene, nicht gestartete oder von Berechtigungen verhinderte Läufe nicht grün markieren. Kurze Logs optional unter `tmp/combat-refactor/`; sie sind keine Voraussetzung für Wiederaufnahme, wenn sie fehlen. Fehlender Beleg bedeutet nötige erneute Prüfung.

Nach relevantem Code-Delta gilt ein alter Review-Pass nicht automatisch weiter. Reine Status-Commits sind davon unterscheidbar. Code-Anker müssen erreichbar sein; keinen eigenen noch nicht existierenden Commit-SHA in diese Datei schreiben.

## 6. Fortschreibung und Wiederanlauf

Vor Workerstart Freigabe, Voraussetzungen und Working Tree prüfen; Aufgabe auf 🟨, Start-HEAD und aktiven Worker eintragen. Während der Worker schreibt, bleibt der Orchestrator schreibend inaktiv. Nach Rückgabe reale Lieferung, lokale Gates und Übergangsfristen prüfen; nur erfüllte Arbeit ✅ setzen und gemeinsam mit Code committen. Ein Zwischen-/Review-Fix-Commit sichert Arbeit, lässt das noch unerfüllte Gate aber offen. Danach Worker schließen und nächste zulässige Aufgabe wählen.

Beim Wiederanlauf zuerst Branch/HEAD, Index, Working Tree und offene Threads mit § 1 abgleichen. Keine Phase blind wiederholen, keine Nutzeränderung verwerfen. Nach R1/R2 ausdrücklich „wartet auf Nutzerfreigabe B/C“ setzen. 01–03/05 werden nicht eigenmächtig umdefiniert. Keine Clientkonfiguration oder zusätzliche Agentenarchitektur erzeugen.

Nach P13: „technisch/architektonisch abgeschlossen; M offen“. Ohne Nutzerrückmeldung bleibt M offen. Ein gemeldeter In-Scope-Defekt öffnet P13 zur beauftragten gezielten Korrektur wieder.
