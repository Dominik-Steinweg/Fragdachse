# Dev-Szenario: manuelle Browserprüfung

Geprüft am 27.09.2026 über den Codex In-app Browser und den lokalen Vite-Server auf Port 8090.

- Map 7 mit `inspector_gadachs` direkt gestartet; tatsächlich übernommenes Loadout und Map im HTML-Bericht geprüft.
- Spieler zur freien Zelle `(98,26)` versetzt, Flammenturm bei `(102,25)` über die reguläre Bauaktion errichtet.
- Fixierten `zombie-badger` bei `(106,25)` erzeugt. Abnehmende HP und sichtbare Flammen bestätigen laufenden Kampf.
- Bewegung für eine Sekunde per HTML-Kommando ausgeführt; Positionsänderung im Bericht bestätigt.
- Pause, einzelne Frames, zehn Frames und PNG-Aufnahme geprüft. Die Aufnahme führt bei Pause einen zusätzlichen Frame aus.
- Zweifacher Kamera-Zoom mit Ziel-Fokus geprüft. [Aufnahme](dev-scenario-flame-turret.png).
- Reload rekonstruierte Seed, Layout-Fingerprint, Spielerposition, Flammenturm und Gegner aus dem Link.
- Zweiter Fall: interne Balance-Map, `dachs_of_steel`, `TESLA_DOME`, Überladungs-Puls-Upgrade und generiertes Helm-Item.
  Der Bericht bestätigte Klasse, Waffe, Upgrade-Stufe und vollständiges Item einschließlich Affix.
  „weapon2 halten“ lieferte erfolgreiche Gameplay-Aktionen; die Kuppel war im PNG sichtbar.
- JSON-Import des ersten Aufbaus und erneuter Szenariostart geprüft.

Browser-Pane-Klicks und Download-Übergaben waren teilweise unzuverlässig. Enter für fokussierte Buttons,
Leertaste für Checkboxen und normale Select-Auswahl funktionierten. Der zusätzliche PNG-Workspace-Export
lieferte eine lesbare Datei unter `build/dev-scenarios/`, ohne Browser-Download.

Automatisiert erfolgreich: `npm run check`, vollständige Integrationssuite, gezielte Tests für Konfiguration,
Zeitsteuerung, Storage-Isolation, lokalen Host und Screenshot-Endpunkt sowie die erweiterten
Arena-Exit-Lifecycle-Tests. Der normale Produktionsoutput enthält weder Dev-Szenario-HTML noch dessen Controller.

Nicht als verifiziert behauptet: jede einzelne Waffe/Utility/Spezialaktion, Multiplayer-Parität,
vollständig deterministische Simulation, kalte Startzeit oder Shader-Änderungen ohne Reload.
