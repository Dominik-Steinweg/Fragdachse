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

## Nachprüfung des Bedienungsfeedbacks

- Balance-Map: Rezeptposition `(14,23)` ergab `(464,764)`; der ursprüngliche Positionsfehler trat
  in diesem Durchlauf nicht auf. Die neue Prüfung bestätigt die Position nach dem Host-Frame.
  Ein Regressionstest simuliert ein überschreibendes Spawn-Reconcile in diesem Frame.
- Gehaltene Tesla-Kuppel blieb beim Teleport nach `(15,23)` aktiv; im Bericht weiterhin `trigger: weapon2`.
- Hash-only-Wechsel zur Map 7 ohne Reload rekonstruierte Spieler `(98,26)`, einen Flammenturm und einen Gegner.
  Bericht: `ready: true`, keine ausstehenden Bauwerke und verifizierte Startposition.
- Der fixierte Gegner meldete `moving: false`, während `desiredMovement.moving: true` die KI-Absicht zeigte.
- Panel eingeklappt: nur der kleine Öffnen-Knopf blieb sichtbar. PNG-Workspace-Export funktionierte über die API.
- Map 0: Missionszeit blieb bei 1 ms, Respawn-Budget bei 99, Steuerungshilfe ausgeblendet.
  Wiederholte echte Tod-/Respawn-Budgetübergänge mit pausiertem Verbrauch und anschließendes Fortsetzen
  wurden zusätzlich headless geprüft; im Browser wurde dafür kein Tod erzwungen.
- Befehle wurden über das JSON-Feld ausgeführt, das dieselbe API wie `window.devScenario.run` verwendet.
  `whenReady`, ungültige Kommandos, isolierte Snapshots, Hashwechsel und Capture-Abbruch beim Teardown
  sind durch Regressionstests abgedeckt.

Erfolgreich: `npm run check` (4420 Core- und 54 Architekturtests, Spiel- und Map-Editor-Build),
`npm run test:integration` (614 Tests). Nach der abschließenden Capture-Zuordnungskorrektur nochmals
19 gezielte Tests und Produktionsbuild. Dev-Panel/API-Texte fehlen im Produktionsbundle.
