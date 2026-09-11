# Hindernisklassen und Schusslinien – Umsetzung

Die Umsetzung folgt dem freigegebenen Implementierungsplan zum
[GDD](FRAGDACHSE_GDD_Hindernisklassen_und_Schusslinien.md). Die Regeln liegen in den
gemeinsamen World-Systemen und gelten dadurch auch im Lobby-Testgelände.

## Ergebnis

- `ground`, `low`, `high` und `veryHigh` trennen fachliche Hindernisse von ihrer Darstellung.
  Der bestehende `ArenaObstacleIndex` liefert weiterhin die Geometrie; Basiszellen lassen
  reale Nischen und Zwischenräume frei. Bewegung, Nahkampf, Würfe, Landung und
  bodengebundene Ausbreitung behalten ihre physischen Hindernisse.
- Offensive Direktgeschosse und Hitscans passieren niedrige Mauern und Turmsockel ohne
  Kontakt oder Trefferverbrauch. Hohe Deckung bleibt wirksam. Schussfreigabe, Mündung,
  Homing und Kontakte verwenden denselben Hindernisvertrag.
- Authored Basistürme und persistente Dachgeschütze erhalten eine konkrete Träger-ID.
  Jeder reguläre Schuss besitzt seine eigene Freigabe bis zum ersten vollständigen
  Körperaustritt. Nischen, Wiedereintritt, Portaltransport und Umlenkung sind berücksichtigt;
  Folgegeschosse erben diese Freigabe nicht. Schüsse starten an ihrer vorgesehenen Mündung.
- Support erreicht berechtigte niedrige Ziele. Ein Plasmabrenner-Strahl endet am ersten
  Treffer, auch wenn das Ziel bereits vollständig repariert ist. Vorherliegende hohe
  Deckung bleibt maßgeblich.
- Eine zentrale Regel vor dem HP-Abzug schützt eigene und verbündete Bauwerke.
  Projektilherkunft und gespeicherte Zugehörigkeit bleiben bei Explosionen, Wolken,
  Bodenfeuer und verzögert landenden Feuerfragmenten erhalten. Teamschaden an Figuren
  bleibt separat konfiguriert. Rückbau funktioniert weiterhin.
- Der neue Maueratlas wird reproduzierbar durch
  [`generate-wall-atlas.mjs`](../../scripts/generate-wall-atlas.mjs) aus dem Naturfelsatlas
  erzeugt: `node scripts/generate-wall-atlas.mjs`. Größe, 32×32-Raster, Frame-Reihenfolge
  und Alpha bleiben identisch. Klassische Darstellung, GPU-Darstellung, Zerstörungsquads
  und Platzierungsvorschau verwenden das passende Material. Gebaute Felsen heißen in
  der Oberfläche „Mauer“ beziehungsweise „Wall“; interne IDs bleiben erhalten.
- Blueprints enthalten keine redundanten Höhenfelder. Die veränderliche Trägerfreigabe
  bleibt Host-Zustand; Clients visualisieren bestätigte Flugpfade und Kontakte.

## Bewusste Abweichungen und Grenzen

Die Gegner-KI wurde nicht überarbeitet. Zielprioritäten, Umwege und bestehender
Blockadeabbau nach Stillstand bleiben erhalten. **Das GDD-Abnahmekriterium eines
zuverlässigen, wegrelevanten Blockadeabbaus gehört nicht zur Abnahme dieses Teilprojekts.**

Der Bauschutz gilt auch für eigene Angriffe, beschworene Verbündete, Explosionen und
Folgewirkungen. Freundliche hohe Gebäude bleiben dabei Schusshindernisse. Naturfelsen,
Zug, feindliche Bauwerke und neutrale Umweltgefahren erhalten keinen zusätzlichen Schutz.

Gauss, BFG und Felsdurchdringungs-Upgrades behalten ihre vorhandenen Ausnahmen gegenüber
hohen Hindernissen. Tesla- und BFG-Verbindungen dürfen niedrige Konstrukte überqueren;
Reichweiten, Zielzahlen und besondere Zielarten bleiben erhalten. Die Trägerfreigabe
endet bereits beim vollständigen Austritt in eine freie Gebäudenische.

Die Grafikänderung ist ausschließlich eine hellere, neutralgraue Farbvariante von
`rocks47blob.png`. Basisgebäude und Turmgrafiken wurden nicht neu gestaltet. Ein
allgemeiner Gebäude-, Renderer- oder KI-Umbau gehört nicht zu dieser Umsetzung.

## Verifikation

Die bestehenden Tests wurden um Durchflug und Trefferverbrauch, genaue Basisgeometrie,
Trägeraustritt, Portaltransport und Umlenkung, Support, Missionssperren, gespeicherte
Zugehörigkeit, Bauschutz und Atlas-/Materialparität erweitert.

Erfolgreich ausgeführt:

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | 3.378 Core-Tests, 33 Architekturtests und Produktionsbuild erfolgreich |
| `npm run test:integration` | 411 Tests erfolgreich |
| `npm run test:assets` | 73 Tests erfolgreich |
| `npm run test:balance-lab` | 105 Tests erfolgreich |
| Markdown | Lokale Links und `git diff --check` erfolgreich |

Die vorhandenen Tests für Gegnerverhalten, Granaten, Nahkampf und Landung bleiben
Bestandteil der Prüfungen.

Eine Browserprüfung war nicht beauftragt. Die Darstellung im laufenden Spiel ist deshalb
nicht als visuell verifiziert ausgewiesen.

Die langlebigen Verträge stehen in [Gameplay-Wissen](../ai/gameplay.md).
