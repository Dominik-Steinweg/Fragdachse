# Lobby-Basisgebäude V1

Status: umgesetzt auf Branch `base-buildings` (2026-10-22), Endabnahme offen.

## Ziel

Die vier Menü-Gebäude der LobbyWorld (Werkstatt → Upgrades, Bauhof → Basis-Editor, Ausrüstung → Items,
Schrotthändler → Händler) sollen deutlich hochwertiger aussehen, sich in Licht, Schatten, Nebel und Boden der
Spielwelt einfügen, eine Hitbox haben, die der gezeichneten Form folgt, und von allen Seiten per Shift betreten
werden können. Jedes Gebäude hat einen Mitarbeiter.

## Entscheidungen (Konzept-Gate, fünf Runden)

| Gebäude | Bauweise | Mitarbeiter | Effekte |
|---|---|---|---|
| Werkstatt | Schmiedehalle mit Wellblech-Satteldach, Steinschornstein und Oberlicht; offene gepflasterte Veranda mit Esse, Amboss, Löschtrog und Schleifstein | Schmied, Hammerschlag mit Funken | Glut, Schornsteinrauch, flackerndes Essenlicht |
| Bauhof | Holzrahmen mit Sparren, Gerüst und erstem Wellblech; er fertigt die Basis-Bodenplatten (verlegt, gestapelt, am Dreibein-Hebezug) | Vorarbeiter am Plantisch | Cyan nur als Leuchtkante der Basisplatten |
| Ausrüstung | Firstzelt aus ochsenblutrotem Stoff, davor eine Theke mit den vier Shop-Slots (Stulpen, Harnisch, Helm, Stiefel) flach in Anzeigegröße | Quartiermeister, stempelt | Laternenlicht, Glanz beim Stempeln |
| Schrotthändler | Planwagen mit gewölbter Plane, außen liegenden Eisenreifen und Gabeldeichsel; Kistentheke mit Messingwaage, Schrotthaufen, Generator, Laternenkette | Händler, Schraubenschlüssel-Tippen | Funken, Auspuffrauch |

Verworfen: geschlossene Walmdach-Zeughäuser und Bunker, Tarnnetz (wirkte von oben wie Bewuchs), olivgrüne
Zeltplane (zu nah am Wagen), voller Basis-Stil im Bauhof (Bruch zu den anderen Gebäuden), schwebende Cyan-Ringe
(unlogisch), flach liegendes Ersatzrad.

Leitregel: Lesbarkeit in der strengen Draufsicht. Senkrechte Teile (Räder, Wände) verschwinden von oben; die
Identität tragen große Flächenformen.

## Umsetzung

- **Assets:** Blender-Rezept `recipes_v2/lobby-structure.py` (1 BU = 1 m = 32 px, 5 × 4 m, Front nach Süden,
  `turn` dreht für die Südreihe), Dawn-Texturbibliothek; Export `export-lobby-structures.mjs` mit Beauty, Albedo,
  Elevation, Emissionsschichten, Solid-Maske und Sockets.
- **Hitbox und Nebel:** Kontur aus der Solid-Maske (8-px-Gitter, Nischen bis zwei Spielerbreiten gefüllt), eine
  Quelle für Kollision, Bewegungszellen, feine Nebelbarriere, Figurenschatten-Ausschluss und Shift-Annäherung.
- **Licht und Schatten:** Relief wie bei den Felsen mit Höhen-Eigenschatten, Höhenfeld-Bodenschatten mit der
  gemeinsamen Sonnenpeilung, Emission über der Lightmap, Socket-Lichter; der Nebel wird auf den Dächern gestempelt.
- **Mitarbeiter:** Spielerfigur mit Rollenkleidung, Clips Idle, Arbeit (mit Marker) und Gruß; dreht sich zum nahen
  Spieler, grüßt beim Shift-Fokus, rein lokal.
- **Layout:** alle vier östlich des Spawns um den See, je mindestens zwei Zellen begehbarer Ring, Trampelpfade.

Technische Verträge: [rendering.md](../ai/rendering.md) (Lobby-Bauwerke) und [gameplay.md](../ai/gameplay.md)
(Shift-Annäherung).
