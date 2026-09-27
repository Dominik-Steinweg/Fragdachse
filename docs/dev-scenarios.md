# Dev-Szenarien

Mit `npm run dev:browser` starten und [dev-scenario.html](http://127.0.0.1:8090/dev-scenario.html) öffnen.
Die Seite startet das echte Spiel mit einem lokalen Host, ohne Broker oder Mitspieler.
LocalStorage und SessionStorage werden **vor dem Import des Spiels** durch flüchtige Speicher ersetzt.
Der normale Spielstand und seine Freischaltungen werden dadurch weder gelesen noch verändert.
Der Einstieg und die Bedienoberfläche werden vom normalen Produktionsbuild nicht ausgeliefert.

## Bedienung

1. Map, Klasse, Seed und Waffen wählen. Alle für die Klasse erlaubten Freischaltungen stehen bereit.
2. Werkzeuge ergänzen, Upgrade-Stufen setzen und bei Bedarf Items erzeugen. Voraussetzungen werden ergänzt;
   ungültige Stufen, Klassenkombinationen, Slots und Itemwerte werden abgelehnt.
3. **Szenario starten / neu aufbauen** betätigen. Der normale World-/Activity-/Ready-Ablauf wird durchlaufen.
4. Ein Ziel in Grid-Koordinaten einstellen. Eine Zelle hat 32 Pixel; `(0,0)` ist die erste Zellenmitte relativ
   zum World-Offset. **Freie Zelle suchen** zeigt die nächstgelegene freie Zelle, **Zum Ziel teleportieren** versetzt den Spieler.
5. Gegner oder Bauwerke platzieren. Bauwerke müssen ausgerüstet sein und verwenden echte Bauflächen-,
   Reichweiten-, Cooldown- und Kapazitätsregeln. Gegner können an ihrer Position gehalten werden; ihre KI und Angriffe bleiben aktiv.
6. Bewegung wird als Richtung plus Dauer ausgelöst. **weapon1/2 halten** erzeugt gehaltenen Diagnose-Input
   zusammen mit normalen Waffenaktionen. **Alle Aktionen stoppen** gibt Waffen, Bewegung, Utility-Aufladung und Ultimate frei.
7. Pause, 1/10 Frames, Zeitlupe, Tagesminute und Kamera-Zoom dienen der Sichtprüfung.
   **PNG aufnehmen** zeigt einen scrollbar dargestellten Screenshot in der tatsächlichen Canvas-Auflösung.
   **PNG im Workspace speichern** legt ihn unter `build/dev-scenarios/` ab und zeigt den absoluten Dateipfad an.
   So hängt die Übergabe an KI-Werkzeuge nicht von Browser-Downloads ab.

Das Utility-Kommando verwendet das **erste Utility im Werkzeug-Loadout** und lädt aufladbare Utilities voll auf.
Für ein anderes Utility die Werkzeugreihenfolge im JSON ändern und neu starten. Ultimate hat getrennte
Drücken-/Loslassen-Kommandos; beim Drücken wird Rage aufgefüllt.
Adrenalin und HP können pro Simulationsframe aufgefüllt werden. HP-Auffüllen verhindert keinen tödlichen Einzeltreffer.

## Wiederholbare Aufbauten

Der URL-Hash enthält ein versioniertes JSON-Rezept. Start, Teleport, Gegner- und Bauaktionen sowie laufende
Ressourcen-/Tageszeitänderungen aktualisieren den Link. Nach Reload wird das Rezept automatisch gestartet.
Gespeicherte Bauwerke entstehen vor den konfigurierten Gegnern; für den Bau wird kurz eine gültige Position
in Reichweite verwendet und danach die Beobachterposition wiederhergestellt.

Das Rezept ist **kein Savegame oder Frame-Replay**: verbleibende HP, aktuelle Projektile, abgebaute Felsen,
abgelaufene Missionszeit, laufende Eingaben und Kamerazustand werden nicht rekonstruiert.
Seed und Inhalt stabilisieren den Weltaufbau; Worker, Browser-Timer und nicht gesäte Zufallsquellen bleiben asynchron.
Pause stoppt die Phaser-Schleife und die ganzzahlige Gameplay-Uhr im isolierten Tab. Eine PNG-Aufnahme bei Pause
führt genau einen weiteren Simulationsframe aus. Sehr kurze Effekte lassen sich über Schritte oder Zeitlupe erfassen.

JSON lässt sich im Panel bearbeiten, validieren und exportieren. Items enthalten die echten vollständigen
Itemdaten einschließlich Affix-IDs und Werten; der Katalog-Export liefert die aktuellen Definitionen.
Der Bericht enthält angeforderte Konfiguration, tatsächlich übernommenes Loadout, World-Seed/Fingerprint,
Ladezustand, Spieler-/Gegnerpositionen, Effekt- und Konstruktionszustand sowie die letzte Aktionsantwort.
`pendingSetupConstructions` muss für einen vollständig aufgebauten Testfall `0` sein.

## Browser-Agenten

Alle Steuerelemente sind HTML mit Labels und stabilen `dev-*`-IDs. Ein Canvas-Klick, Cheat-Menü oder Zugriff
auf private Scene-Felder ist für den Aufbau nicht nötig. Bei fehlerhafter Klickskalierung des Browser-Panes
funktionieren fokussierte Buttons mit Enter und Checkboxen mit Leertaste. Selects unterstützen normale Auswahlaktionen.

Beispiel für einen vollständig über die Oberfläche geprüften Aufbau: Map `7`, Klasse `inspector_gadachs`,
Werkzeug `construction:flame_turret`, Spieler bei Grid `(98,26)`, Flammenturm bei `(102,25)`, fixierter
`zombie-badger` mit erhöhten HP bei `(106,25)`, Seed `12345`. Andere Maps/Klassen/Inhalte verwenden dieselben Kommandos.

## Grenzen

- Die Oberfläche konfiguriert Coop-Defense-Aktivitäten. Multiplayer-/Client-Replikation braucht separate Prüfungen.
- Unterdrückte Encounter verwenden die vorhandene Analysis-Policy, die auch automatische Missionsereignisse beeinflusst.
  Für normale Missionsabläufe die Option ausschalten. Sie garantiert kein selektives Ausschalten einzelner Spawnquellen.
- Der normale Loader und die echten Renderer bleiben aktiv. Der Modus beseitigt Broker-Wartezeit und manuelle Vorbereitung;
  er stellt keine vollständige Optimierung des initialen Asset-/Modul-Ladens und kein Shader-Hot-Swapping dar.
- Einzelne Spezialaktionen, etwa ein direkter Tesla-Nova-Trigger ohne vorherige Ladung, sind keine separaten Effekt-Fixtures.
  Sie werden durch Ausrüstung, Upgrades und echte Kampfaktionen erzeugt.

Browserprüfung bleibt gemäß `AGENTS.md` opt-in. Diese Seite erteilt keine pauschale Erlaubnis für Browserstarts in anderen Aufgaben.
