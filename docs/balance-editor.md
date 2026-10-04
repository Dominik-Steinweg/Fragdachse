# Balance-Editor

Start im Repository: `npm run balance:editor`, dann `http://127.0.0.1:8092/`.
Alternativer freier Port: `npm run balance:editor -- --port 8192`.
Build-Prüfung: `npm run build:balance-editor` (auch Bestandteil von `npm run check`).
Der statische Editor-Build besitzt keinen Speicher-Endpunkt. Der Spiel-/Produktions-Build bindet den Editor nicht ein.

Links nach Name, ID oder Feld suchen und Typ/Kategorie filtern. Alle Waffen (auch NPC-Varianten),
Ultimates, Utilities, Coop-Upgrades und Katalogreihenfolgen werden aus den vorhandenen Dateien geladen.
Zusätzlich: authored Grundwerte der Angriffsdrohne, MG-Turm-Blutung und Bau-Cooldowns unter „Konstruktionsregeln“.
In der Mitte stehen verschachtelte Zahlen, Schalter, Farben und Upgrade-Effektmodi als Felder.
Die Feldsuche findet auch tiefe Pfade. Aufklappbare Gruppen, Ursprungswert und Quelldatei helfen beim Vergleichen.
Geerbte Werte erzeugen beim Bearbeiten einen Override im gewählten Eintrag; die Basis bleibt erhalten.
Upgrade-Defaults für Startlevel, Bosskosten und Rückerstattung lassen sich ausdrücklich authorieren.

**Datei speichern** oder **Strg+S** prüft und speichert alle Änderungen in der Quelldatei des ausgewählten Eintrags.
Bei Änderungen an mehreren Dateien jede Datei einzeln speichern. Die Änderungsliste zeigt alle offenen Werte.
Undo/Redo umfasst bis zu 100 Schritte, auch nach dem Speichern; zum Übernehmen eines Undo erneut speichern.
„Ursprung“ bezeichnet den Zustand beim Laden der Editor-Sitzung. „Neu laden“ verwirft nach Bestätigung offene Änderungen.
„Entwurf exportieren“ sichert offene Dokumente und ungültige Texteingaben als JSON zur manuellen Wiederherstellung.
Das Spiel anschließend neu laden; eine laufende Runde übernimmt die neuen Werte nicht automatisch.

## Entscheidungen und Grenzen

- Der Editor übernimmt Layout und lokalen Vite-Server-Ansatz des Map-Editors und verwendet dessen
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
