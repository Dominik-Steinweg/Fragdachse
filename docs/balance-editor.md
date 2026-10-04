# Balance-Editor

Start im Repository: `npm run balance:editor`, dann `http://127.0.0.1:8092/`.
Alternativer freier Port: `npm run balance:editor -- --port 8192`.
Build-Prüfung: `npm run build:balance-editor` (auch Bestandteil von `npm run check`).
Der statische Editor-Build besitzt keinen Speicher-Endpunkt. Der Spiel-/Produktions-Build bindet den Editor nicht ein.

Links nach Item, Upgrade, ID oder Effekt suchen und nach Spielkategorie filtern. Die Bibliothek gruppiert
Waffen, Utilities, Ultimates und Konstruktionen mit ihren vollständigen Upgrade-Zweigen. Allgemeine
Upgrades folgen denselben Voraussetzungen wie im Spiel, etwa Vitalität → HP-Regeneration → Lifeleech.
NPC-Varianten und technische Einträge bleiben in eigenen eingeklappten Kategorien erreichbar.

In der Mitte stehen Kennzahlen und ein auswählbarer Upgrade-Baum mit Original-Icons, Levelgrenzen,
Kosten und allen Voraussetzungslinien. Rechts werden die Grundwerte oder der gewählte Knoten bearbeitet.
Schaden, Tempo, Reichweite und Ressourcen (einschließlich Rage-Bedarf, Rage-Kosten und Verbrauchsdauer)
stehen oben. Primärwaffen zeigen hier nur Adrenalin-Gewinn, Sekundärwaffen nur Adrenalin-Kosten.
Authored DoT-Stärke und Tickintervalle bleiben auch bei verschachtelten Effekten sichtbar zusammen.
Brandwerte zeigen zusätzlich ihr globales, hier schreibgeschütztes Tickintervall aus der Spielkonfiguration.
Kosten je Upgrade-Level und Boss-Punkte stehen in den eingeklappten Details; spezielle Effektparameter,
Darstellung und technische Werte sind unter „Weitere Parameter“ eingeklappt. Die Feldsuche öffnet auch
Treffer in diesen Details. Effektkarten halten Zielwert, Stärke und Level-Vorschau zusammen; die
Vorschau verwendet die Wertformatierung des Spiels und zeigt den Beitrag dieses Upgrades, keinen
vollständig simulierten Build. Verknüpfte Loadout-Zielwerte führen direkt zu ihrem Basisfeld.
Angriffsdrohnen-Grundwerte und MG-Turm-Blutung sind bei ihrer Konstruktion erreichbar, ebenso
zugehörige Katalogeinträge. Bau-Cooldowns bleiben unter „Katalog & Regeln“.
Ursprungswert, Rücksetzen pro Feld und aufklappbare Herkunft helfen beim Vergleichen.
Geerbte Werte erzeugen beim Bearbeiten einen Override im gewählten Eintrag; die Basis bleibt erhalten.
Upgrade-Defaults für Startlevel, Bosskosten und Rückerstattung lassen sich ausdrücklich authorieren.

**Datei speichern** oder **Strg+S** prüft und speichert alle Änderungen in der Quelldatei des ausgewählten Eintrags.
Bei Änderungen an mehreren Dateien jede Datei einzeln speichern. Die Änderungsliste zeigt alle offenen Werte.
Undo/Redo umfasst bis zu 100 Schritte, auch nach dem Speichern; zum Übernehmen eines Undo erneut speichern.
„Ursprung“ bezeichnet den Zustand beim Laden der Editor-Sitzung. „Neu laden“ verwirft nach Bestätigung offene Änderungen.
„Export“ sichert offene Dokumente und ungültige Texteingaben als JSON zur manuellen Wiederherstellung.
Das Spiel anschließend neu laden; eine laufende Runde übernimmt die neuen Werte nicht automatisch.

## Entscheidungen und Grenzen

- Der Editor übernimmt den lokalen Vite-Server-Ansatz des Map-Editors und verwendet dessen
  formatstabilen JSON-Schreiber. Unveränderte Dateien bleiben byte-identisch, unveränderte Tokens bleiben erhalten.
  Speichern ersetzt eine Datei über eine temporäre Datei; SHA-256-Revisionen verhindern das Überschreiben
  erkannter externer Änderungen. Bei Konflikten Entwurf exportieren und bewusst neu laden.
- Die vollständigen Spielprüfungen (`buildLoadoutRegistries`, `normalizeUpgradeRegistry`,
  `validateGameContentReferences`) validieren den Entwurf vor dem Schreiben, einschließlich Vererbung und Referenzen.
  Zahlen-/Typgrenzen stammen aus gemeinsam genutzten Loadout-Regeln bzw. der Upgrade-Normalisierung.
  Spezialregeln werden zusätzlich serverseitig geprüft; die angezeigte Spanne ist deren allgemeiner Rahmen.
  Upgrade-Werte, die das Spiel sonst still begrenzen würde, werden abgewiesen. Historische Bruchteile
  in `sortOrder` bleiben erhalten (das Spiel rundet diese reine Anzeigereihenfolge ab).
- Die vorhandenen Validatoren liefern kein vollständiges Metadatenschema. Nur dokumentierte Einheiten werden
  beschriftet; fehlende Einheiten bleiben offen. IDs, Referenzen, Typdiskriminatoren und Listenstruktur sind
  schreibgeschützt. Neue Einträge, neue optionale Loadout-Strukturen oder neue Upgrade-Effekte werden weiter in JSON angelegt.
  Prozent-Effekte verwenden ihren rohen Anteil: `0.1` bedeutet `10 %` pro Level.
- Basisschaden/s ist ausschließlich `damage * 1000 / cooldown`, kein vollständiger DPS-/TTK-Simulator.
- Der Speicher-Endpunkt existiert nur im lokalen Editor-Dev-Server. Er prüft Loopback, Host, Origin,
  Sitzungstoken, Dateifreigabe, Pfade und unveränderte Dokumentstruktur. Keine Produktionseinbindung, keine neue Abhängigkeit.

Tests: `npm test -- tests/BalanceEditor.test.ts` (Lesen, Speichern, Byte-Roundtrip, minimale Diffs,
Validierung, Vererbung, Undo/Redo, Konflikte und Schreibfehler).
