# Dawn-Uhr V1 – Gestaltungsvorgabe

Stand: 2026-10-14, Leit-Session. Anlass ist Playtest-Feedback F: Zu viele Timer und Uhrzeiten verwirren, es soll EINE
analoge Uhr geben. Gewählt hat der User Konzept **C „Sonnenuhr-Kompass“** aus `art/poc/dawn/ui/clock/` (lokal).
Gründe: Die halbrunde Form nimmt wenig Platz weg, lässt sich gut weiterentwickeln und zeigt den Rundenablauf auf einen Blick.
Bildsprache: `Fragdachse_From_Dachs_Till_Dawn_Art_Direction_V1.md`, Druck-Register, Holz und Messing.

## Prinzip
- **Halbrunde Skala, 180°, oben am Bildschirm angedockt.** Die flache Seite liegt unten, der Drehpunkt sitzt unten in der Mitte.
- **Die Skala bildet eine ganze Runde ab:** links Rundenstart (Morgen), rechts Sonnenaufgang (Sieg). Es gibt keine
  Uhrzeit-Ziffern.
- **Zeiger:** schwenkt von links nach rechts.
- **Phasensegmente** entstehen prozedural aus dem Phasenplan (`src/config/dawn/schedules.json`). Ändert sich das Timing,
  passt sich die Uhr automatisch an. Farben:
  - Tag: Knochen/Papier `#d9cfb6` mit Druckkorn
  - Dämmerung: Bernstein `#d9822b`, gedeckt
  - Nacht: Schiefer-Holzkohle `#2f343a`
  - Morgengrauen: blasses Kaltgrau
- **Symbole an den Enden:** Sonne links (Tag), Sonnenaufgang rechts (Ziel), Mond am Nachtbeginn auf der Skala.
- **Kerben:**
  - Jede Nachtwelle bekommt eine kleine dunkelrote Kerbe am Skalenrand, das Finale eine größere.
  - Vergangene Abschnitte werden leicht abgedunkelt, damit „wie viel noch übrig ist“ sofort lesbar ist.
  - 5 s vor einer Welle pulsiert die nächste Kerbe dezent rot.
- **Zeigerspitze:** trägt am Tag eine kleine Sonne, in der Nacht einen Mond.
- **Medaillon am Drehpunkt:** zeigt nachts das Icon des Nacht-Modifikators, falls einer aktiv ist, sonst die Messingnabe.
- **Phasenwechsel:** kurzer Messing-Glanz über die Skala, keine Bildschirmeffekte.

## Platzierung und Größe
- Oben mittig, ersetzt den bisherigen Rundentimer. Etwa 150×80 px im Designraum, Untergrenze 120×64.
- Unter der Grundleiste steht optional eine kurze Zeile in HUD-Schrift, z. B. „NACHT · WELLE 2/3“ oder „FINALE“.
  Das ist die einzige Textergänzung.
- **Entfällt in Dawn:**
  - Uhrzeit und „noch x“ in der Phasenkarte
  - Rundentimer oben
  - „bis 06:15“ im Hauptziel
- **Phasenkarte:** wird auf Tag N, Threat und Schrott reduziert oder in vorhandene HUD-Zeilen überführt.
  Das Phasen-Banner beim Wechsel bleibt.
- **Kampagne:** bleibt unverändert, die Uhr gilt nur für Dawn.

## Assets (über `dawn-assets`, Druck-Register)
- Halbrunder Rahmen mit Grundleiste (Holz, Messingbeschläge, innen transparent)
- Skalen-Grund (dunkel, Papierkorn)
- Korn-Overlay nur für den Skalenbogen, damit die prozeduralen Segmente gedruckt wirken
- Zeiger (Holz/Knochen, Drehpunkt dokumentiert) mit Spitzensymbolen Sonne und Mond
- Symbole Sonne, Mond, Sonnenaufgang
- Kerben für Welle und Finale
- Messing-Medaillon am Drehpunkt
- Alle Teile in 1× und 2×, dazu ein Manifest mit Drehpunkt, Bogenradien (innen/außen) und Winkelbereich (180°, links → rechts)
