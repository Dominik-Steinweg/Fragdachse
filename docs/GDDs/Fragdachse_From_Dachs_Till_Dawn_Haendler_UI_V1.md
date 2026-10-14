# Schrotthändler-Menü V1 – Gestaltungsvorgabe

Stand 2026-10-14, Leit-Session. Anlass: Playtest-Feedback (Menü zu klein, Texte über zwei Seiten verteilt,
nicht schön, nicht auf mehr Inhalt vorbereitet). Grundlage: Entwurf **A „Seitenleiste + Raster + Detailspalte“**
(`art/poc/dawn/ui/dealer/layout-A-sidebar-grid.png`, lokal) – gewählt wegen Skalierbarkeit (50+ Angebote,
6–8 Kategorien) und durchgehender Leseflächen. Bildsprache: `Fragdachse_From_Dachs_Till_Dawn_Art_Direction_V1.md`.

## Layout (16:9, Designraum 1920×1080, skaliert mit)
- Fenster ca. **88 % × 86 %** der Bildschirmfläche, zentriert. Darüber liegt die Lobby gedimmt.
- **Kopfzeile, ca. 13 % Höhe:**
  - links das Händler-Porträt (`dawn/art/dealer-portrait`) und der Name „Schrotthändler“
  - darunter der Schrott-Kontostand mit Icon, groß
  - Mitte ein gedrucktes Wald-Panorama-Band als Dekor
  - rechts der Schließen-Knopf
- **Kategorien links, ca. 20 % Breite:**
  - eine scrollbare Liste aus Kategorien, aufklappbar zu Unterkategorien
  - je Zeile Icon und Name, rechts ein Zähler für kaufbare bzw. neue Angebote
  - die aktive Kategorie trägt ein rotes Druckband
- **Raster in der Mitte, ca. 45 % Breite:** Angebotskarten in 3 Spalten, vertikal scrollbar (Mausrad, Ziehen, Scrollbalken).
  - Oben stehen ein Suchfeld und ein Filter (alle, kaufbar, gesperrt, gekauft). Beides darf in V1 noch fehlen, der Platz bleibt aber reserviert.
- **Detailspalte rechts, ca. 35 % Breite:** Sie zeigt das gewählte Angebot vollständig, ohne Seitenumbruch.
  - großes Icon, Name, Typ/Kategorie, Stufenanzeige „aktuell → nächste“
  - die volle Beschreibung, bei Überlänge in einer eigenen Scrollfläche
  - Effekte als Liste
  - Voraussetzungen als Häkchenliste: erfüllt ✓ / offen ☐ / gesperrt 🔒 mit Grund
  - unten Kosten mit Schrott-Icon und der große Kaufen-Knopf (rotes Druckband)
  - Rekalibrierung erscheint hier als eigener Aktionsblock

## Angebotskarte
- Icon groß, ca. 60 % der Karte; darunter Name in maximal 2 Zeilen, Stufen-Pips und Kosten.
- Ecke: Status-Abzeichen.
  - **kaufbar:** heller Rahmen
  - **zu teuer:** Kosten rot
  - **gesperrt:** gedimmt, Schloss
  - **ausgebaut / gekauft:** Häkchen
  - **neu:** kleines Druck-Siegel
- Raritätsrahmen für Items (Weiß, Blau, Gelb) als Innenkante, nicht als Leuchten.
- Auf der Karte steht kein Fließtext. Die Beschreibung lebt nur in der Detailspalte, das behebt das Zwei-Seiten-Problem.

## Daten und Skalierung
- Kategorien und Unterkategorien kommen datengetrieben aus `src/config/dawn/merchant.json`: ID, Name-Key, Icon-Key, Reihenfolge, Eltern-ID.
- Angebote verweisen auf ihre (Unter-)Kategorie.
- Neue Kategorien und Angebote brauchen keine UI-Änderung.
- Angebotstypen haben einheitliche Felder: Stufe/Max, Kosten je Stufe, Effekte, Voraussetzungen, Zustand.
- Spezialaktionen wie Rekalibrieren sind ein Aktionstyp der Detailspalte.
- **Startgliederung**, Platzhalter für künftigen Ausbau:
  - **Expansion:** Basisausbau
  - **Infrastruktur:** Drohnen, Sensorik, Versorgung
  - **Forschung & Upgrades:** Zweige, Boss-Punkte
  - **Ausrüstung:** Angebot der Runde, Handwerk/Rekalibrierung
  - leere Unterkategorien werden ausgeblendet

## Interaktion
- Maus und Tastatur:
  - Kategorien mit Pfeiltasten oder Klick wechseln
  - Karten per Klick auswählen
  - Doppelklick oder Enter kauft
  - ESC schließt
- **Kauf:**
  - kurze Bestätigungsanimation: Stempel „GEKAUFT“ auf der Karte, Kontostand zählt herunter
  - teure Käufe (≥ 50 % des Kontostands oder Expansion) brauchen eine Bestätigung
- **Fehlgeschlagener Kauf:** etwa bei Speicherfehler eine deutliche Meldung, nichts gilt als gekauft.
- Barrierearm: Texte ≥ 15 px im Designraum, Kontrast Knochenweiß auf Holzkohle.

## Benötigte UI-Assets (Druck-/Holz-Register, kommen über `dawn-assets`)
- Fensterrahmen (9-Slice: dunkles Holz, Messingecken, sparsam Efeu), Kopfzeilen-Panorama-Band (kachelbar).
- Panel-Innenflächen (Holzkohle mit Papierkorn).
- Kategoriezeile normal/aktiv (rotes Druckband)/Hover, Unterkategorie-Einrückung.
- Kartenrahmen in den Zuständen normal, Hover, gewählt, gesperrt, gekauft; Raritäts-Innenkanten; „Neu“-Siegel.
- Kaufen-Knopf normal/Hover/deaktiviert, Stempel „GEKAUFT“, Schloss- und Häkchen-Icon, Stufen-Pips.
- Scrollbalken (Schiene + Griff), Such- und Filterfeld.
- Kategorie-Icons: vorhandene Händler-Icons plus Platzhalter für weitere (Sensorik, Versorgung, Handwerk).
