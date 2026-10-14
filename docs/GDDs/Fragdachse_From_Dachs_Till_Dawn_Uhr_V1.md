# Dawn-Uhr V1 – Gestaltungsvorgabe

Stand 2026-10-14, Leit-Session. Anlass: Playtest-Feedback F. Zu viele Timer und Uhrzeiten verwirren, deshalb soll es EINE
analoge Uhr geben. Gewählt ist Konzept **A „Segment-Zifferblatt“** aus `art/poc/dawn/ui/clock/` (lokal): Es zeigt den gesamten
Rundenablauf auf einen Blick und ist auch bei 128 px gut lesbar. Bildsprache: `Fragdachse_From_Dachs_Till_Dawn_Art_Direction_V1.md`
(Druck-Register, Holz und Messing).

## Prinzip
- Das Zifferblatt bildet **eine ganze Runde** ab, vom Rundenstart bis zum Sonnenaufgang (Sieg). Es zeigt keine
  24-Stunden-Uhr und keine Uhrzeit-Ziffern.
- Ein Zeiger läuft im Uhrzeigersinn, Start ist oben (12 Uhr). Der Rundenstart liegt oben, der Sonnenaufgang
  vollendet den Kreis.
- **Phasensegmente** auf dem äußeren Ring werden prozedural aus dem Phasenplan erzeugt (`src/config/dawn/schedules.json`).
  Ändert sich das Timing, passt sich die Uhr automatisch an.
  - **Tag:** Knochen/Papier `#d9cfb6`, mit Druckkorn.
  - **Dämmerung:** Bernstein `#d9822b`, gedeckt.
  - **Nacht:** Schiefer-Holzkohle `#2f343a`.
  - **Morgengrauen:** blasses Kaltgrau, mit Sonnenaufgang-Symbol am Ende.
- **Markierungen** auf dem Ring:
  - kleine dunkelrote Kerben für jede Nachtwelle
  - größere Kerbe für das Finale
  - Sonnen-Symbol am Phasenübergang Tag→Dämmerung
  - Mond-Symbol am Nachtbeginn
  - Sonnenaufgang-Symbol am Ziel
- Der **Zeiger** trägt an der Spitze ein kleines Symbol: Sonne am Tag, Mond in der Nacht. Vergangene Segmente werden leicht
  abgedunkelt, damit „wie viel noch übrig ist“ sofort lesbar ist.
- **In der Mitte (Nabe):**
  - nachts das Icon des Nacht-Modifikators, falls einer aktiv ist
  - sonst leer bzw. Messingnabe
  - Kurz vor einer Welle (5 s) pulsiert die nächste Kerbe dezent rot. Beim Phasenwechsel gibt es einen kurzen
    Messing-Glanz über den Rand, ohne Bildschirmeffekte.

## Platzierung und Größe
- Oben mittig, ersetzt den bisherigen Rundentimer. 120 px im Designraum (Untergrenze 96 px), halbtransparenter Holzrand.
- Unter der Uhr steht optional eine kurze Zeile in HUD-Schrift, z. B. „NACHT · WELLE 2/3“ oder „FINALE“. Das ist die einzige
  Textergänzung, Uhrzeiten oder Restzeit-Ziffern gibt es nicht.
- **Entfallen in Dawn:**
  - Uhrzeit und „noch x“ in der Phasenkarte
  - Rundentimer oben
  - „bis 06:15“ im Hauptziel
- **Phasenkarte:** wird auf Tag N, Threat und Schrott reduziert oder in vorhandene HUD-Zeilen überführt. Das Phasen-Banner
  beim Wechsel bleibt.
- **Kampagne:** unverändert, die Uhr gilt nur für Dawn.

## Assets (über `dawn-assets`, Druck-Register)
- Uhrgehäuse/Lünette: Holz mit Messingbeschlägen, freigestellt.
- Zifferblatt-Grund: dunkle Scheibe mit Papierkorn.
- Ring-Korn-Overlay: Graustufen-Textur, die über die prozeduralen Segmente gelegt wird, damit sie gedruckt wirken.
- Zeiger: Holz/Knochen, Drehpunkt dokumentiert.
- Symbole: Sonne, Mond, Sonnenaufgang.
- Kerben: Welle und Finale.
- Messingnabe.
- Alle Teile 1× und 2×, Manifest mit Drehpunkten und Ringradien (innen/außen in Designpixeln).
