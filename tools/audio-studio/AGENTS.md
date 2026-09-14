# Audio Studio: Catalog Builder für Codex/Astra

Die Projektregeln gelten weiterhin. Dieses Unterprojekt hat eigene Node-/Python-Abhängigkeiten; Spielcode importiert niemals Tool-Module.

Für Katalogpflege zuerst `uv run --inexact audio-studio sync` ausführen, Fundstellen der betroffenen Keys lesen und erst dann Autorenfelder mit demselben CLI bearbeiten. `revision` ist der Konfliktschutz. Neue Keys/Ziele kommen ausschließlich aus dem zentralen Spielkatalog, nicht hier erfinden.

Neue Einträge brauchen Soundabsicht, englischen SFX-Prompt, belegten oder ausdrücklich als Produktionsvorgabe gekennzeichneten Wiedergabemodus, Modell/Dauer/Kandidatenanzahl und Profil. Medium ist der Startwert; Small-SFX eine bewusste Alternative. Kandidaten werden nacheinander berechnet, keine Ingame-Varianten angelegt. Dynamische Verwendung nicht aus einem Namen als Loop behaupten.

Bestehende Prompts und manuelle Defaults erhalten. Änderungen mit `edit ... --propose` vorschlagen; eine ausdrückliche Benutzeranweisung zur Änderung darf unmittelbar mit `edit` umgesetzt werden. Verwaiste Einträge, Vorschläge, Herkunft und ausgeblendete Hinweise behalten. Gleiche aktuelle Hashes beweisen keine eindeutige Kopierquelle.

Tool 1 erzeugt/veröffentlicht keine Game-Assets. Menschliche Veröffentlichung erfolgt im Studio anhand des tatsächlichen OGG, aktuellen Ziels und aller gemeinsam betroffenen Keys. Keine Git-Commits, Pushes, Deployments oder Cloudfallbacks als Nebenwirkung.

Für Codeänderungen passende Tool-Tests erweitern und `npm test` im Unterprojekt ausführen. Bei Spielvorbereitung zusätzlich Root-Prüfungen durchführen. GPU-unabhängige Tests ersetzen keine lokalen Modell- oder Hörtests. Ausstehende Hardware-/Hörabnahme ausdrücklich dokumentieren.
