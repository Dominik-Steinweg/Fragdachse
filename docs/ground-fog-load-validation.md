# Bodennebel – Dauerfeuer, Strömungswaffen und Zug

22. September 2026, Ausgangsstand `f16aa9ed` (Fog 0.2).
Bedienung: [Bodennebel-Lab](ground-fog-lab.md).

## Änderungen und Ursache

Die P90-Spuren erreichten im Mehrspieler-Fall die bisherige lokale Grenze von 64
Abschnitten pro Tile. Obwohl global noch Platz war, wurden ältere Abschnitte bei der
Darstellung abgeschnitten. Vier Schützen mit jeweils drei Projektilen pro Schuss
reproduzierten über 3.200 lokale Überläufe. Das bisherige Lab mit einem Schützen
bildete diese Last nicht ab.

Der neue GPU-Pass zeichnet richtungsorientierte Kapseln in einem einzigen Draw-Call.
Es gibt keine lokale Tile-Grenze und keine Suchschleife über alle Spuren pro Pixel.
MAX-Blending vereinigt überlappende Spuren, ohne Kreuzungen stärker abzudunkeln.
Zusammenfassung gerader Flugabschnitte, echte Abpraller, Unterbrechungen und das
Alter entlang des Weges bleiben erhalten. Die globale Kapazität beträgt 8.192
Abschnitte; abgelaufene Plätze werden vor noch sichtbaren Spuren wiederverwendet.
Geometrie und Kommandotextur werden nur bei Änderungen hochgeladen. Geburtszeiten
werden beim Packen abgerundet, damit die Modulo-Altersberechnung sie niemals durch
Rundung als zukünftig und damit scheinbar abgelaufen behandelt. Zusammengefasste
Spurenden werden außerdem an die lokale Nebelzeit gebunden: Läuft die
Projektil-Präsentationszeit nach einem langen Frame der begrenzten Nebelfortschreibung
voraus, entstehen keine scheinbar zukünftigen und dadurch verschwindenden Spurenden.

Flammenwerfer und Laubbläser verwenden die laufende Projektilgröße für die Breite
der Spur. Der Laubbläser teilt seine Größenfunktion mit seinem Produktionsrenderer;
die Kapseln erweitern sich entlang des Weges. Das Lab verwendet für beide Waffen
die echten Projektilrenderer und die authored Geschwindigkeits-/Wachstumswerte.

Der Zug liefert seine tatsächlich dargestellte, interpolierte Position an den
Nebel. Front und Heck erzeugen eine Spur von etwa 1,7 Zugbreiten mit zehn Sekunden
Nachwirkung. Pause, Respawn, Teleport und World-Wechsel unterbrechen den Verlauf.
Niedrige Qualität behält den breiten Feldimpuls, Hoch/Mittel ergänzen die langlebige
GPU-Spur. Es entstehen keine neuen Netzwerkdaten oder Gameplay-Effekte.

## Prüfungen

- Alle 27 GPU-Verträge bestanden. Für die dicht belegte Fixture blieb die ältere
  Spur vor/nach 768 neuen Spuren exakt bei 0,5804; eine neue Spur lag bei 0,8824.
  Der Zugnachlauf lag nach Ablauf der kleinen Spuren noch bei 0,4314 und nach
  seiner eigenen Lebensdauer bei null. Der Spurkopf nach einem langen Frame
  blieb mit 0,8824 sichtbar.
- Sichtbares Lab: vier dreifache P90-Ströme, wachsende Flammen- und Laubströme sowie
  ein vollständiger Zugdurchlauf mit anschließendem breitem Nachlauf.
  Mittel behält die vollständigen Spuren; Niedrig deaktiviert den Projektilpass
  wie vorgesehen. Die Rückkehr zu Hoch stellt die Reaktionen wieder her.
- GPU-Verträge prüfen unter anderem unveränderte Deckkraft bei Überlagerung,
  Erhalt einer älteren Spur nach 768 zusätzlichen Spuren im gleichen Bereich,
  zunehmende Breite sowie einen Zugnachlauf, der kleine Spuren überdauert und
  anschließend vollständig ausläuft. Kontrollierte Auslesungen erfolgen außerhalb
  der Leistungsmessung.
- Der neue Stressfall führt zwölf Sekunden lang vier dreifache P90-Ströme mit
  wiederholten Richtungswechseln aus: über 1.000 gleichzeitige Abschnitte, keine
  verworfene Spur, jeder sichtbare Abschnitt wird eingereicht, vollständiges Auslaufen.
- World-Presentation-Integration prüft die tatsächlich angezeigte Zugpose,
  unsichtbare Worlds und Cleanup. Die vorhandenen Projektiltests schützen
  Abschlusssegmente, Unterbrechungen und Host-/Client-Präsentation.

Die Mehrspielerlast ist im Lab reproduziert und mit dem Produktions-Nebelpfad
geprüft. Ein zusätzlicher Live-Test mit vier vernetzten Browser-Clients wurde nicht
durchgeführt.

Automatisiert bestanden die gezielten 24 Nebel-/Projektiltests, 51 passende
Integrationstests, der neue Stressfall, 54 Architekturtests sowie Produktions-
und Lab-Build. `npm run check` meldete 4.040 bestandene Tests und drei bereits
bekannte Fehler in `CoopDefenseMaps` / `CoopDefenseRockFieldMap`; die nachfolgenden
Architektur- und Produktionsbuild-Prüfungen wurden deshalb separat ausgeführt.

## Korrektur: Laubbläser ohne Flugbahnhistorie

Die anschließende Spielprüfung deckte eine Lücke im Eingang auf: Laubbläser haben
keine aufgezeichnete Flugbahn, während das Lab zuvor für jedes Projektil eine
solche Historie erzeugte. `ProjectilePresentationRuntime` erzeugt die lokalen
Nebelabschnitte des Laubbläsers jetzt aus der dargestellten Host-Pose beziehungsweise
der extrapolierten Client-Pose. Die wachsende Größe wird mitgereicht; Entfernen,
Positionssprünge, längere Unterbrechungen und World-Wechsel trennen die Verläufe.
Bestehende bestätigte Flugbahnen bleiben vorrangig. Es gibt keine neuen Wire-Felder.

Das Lab reproduziert jetzt diesen Eingang ohne synthetische Flugbahnhistorie.
Die breite Spur wurde dort sichtbar geprüft. Beide neuen Host-/Client-Regressionstests
schlugen vor der Korrektur fehl und bestehen danach. Insgesamt: 26 gezielte Tests,
51 Integrationstests, 54 Architekturtests und Produktions-/Lab-Build bestanden.
Der erneute Gesamtcheck meldet 4.043 bestandene Tests und dieselben drei bekannten
Map-Testfehler. Die folgenden P90-Messwerte werden von dieser Korrektur nicht verändert.

## Verallgemeinerung und Waffenfaktoren

Der Ersatzpfad für Projektile ohne Historie gilt nun für alle 16 Projektiltypen,
einschließlich BFG. Host und Client verwenden ihre dargestellten Positionen;
bestätigte Historien bleiben vorrangig. Zwei optionale Authoring-Felder
`fogTrailWidthFactor` und `fogTrailDurationFactor` skalieren die Waffenspur.
Die exakte Waffen-ID erreicht Clients über die vorhandenen Statik-/VFX-Pakete
(Peer-Protokoll 20); Faktoren und Nebelzustand werden nicht repliziert.

Große Geschosse, Hitscan und Nahkampf nutzen ebenfalls analytisch alternde
GPU-Spuren, damit der Dauerfaktor die ganze Reaktion bestimmt. Nahkampf bleibt
ein gerichteter Sektor und funktioniert auch auf Niedrig. BFG, Faktoren und
ein erzwingbarer Pose-Eingang sind im Lab verfügbar.

Prüfung: 110 gezielte Tests, 31 GPU-Verträge, 54 Architekturtests, der
P90-Nebel-Stressfall und die 51 Tests aus HeldWeaponFire/WorldPresentationFrameLifetime
bestanden. Produktions-, Editor- und Lab-Build bestanden. Sichtprüfung im vorhandenen
Browser-Pane: BFG mit Faktoren 1/1 und 2/2, vollständig ausgelaufene Spuren bei
Dauerfaktor 0, der wachsende Laubbläser sowie vier P90-Schützen mit je drei
Projektilen ohne Historie. Die P90-Ansicht blieb durchgehend, mit null verworfenen
Eingaben und einem Spur-Draw-Call.

`npm run check`: 4.079 Tests bestanden, dieselben drei Map-Fehler wie zuvor.
Die zusätzlich gestartete vollständige Integrationssuite meldet 547 bestandene
und zehn fehlgeschlagene Tests in ArenaExitLifecycle/LobbyWorldInteractive
(unvollständige Runtime-Mocks beziehungsweise fehlende Netzwerkverbindung).
Die vollständige Stresssuite meldet 80 bestandene, fünf übersprungene und einen
fehlgeschlagenen NavigationSpawns-Test (Map 7: 15 statt 29 Gegner).
Diese außerhalb der Nebelpfade liegenden Fehler bleiben offen. `git diff --check`
ist für die geänderten Nebel-, Lab-, Test- und Dokumentationsdateien sauber.

Die folgenden Zeitmessungen stammen vom früheren P90-Lastvergleich. Sie sind
keine erneute Performance-Abnahme der verallgemeinerten Waffenfaktoren und des
zusätzlichen analytischen Nahkampfzweigs.

## Messverfahren

Gleicher sichtbarer Browser, 1.920 × 1.080, Seed 183, Hoch, 08:00 Uhr, Nebelstärke 1,
Deckkraft 0,5, Detail 0,65, Wind (12, 4), vier Schützen, drei P90-Projektile pro
Schuss, schwenkender Fächer und zyklische Figurenbewegung. Die P90 verwendet die
authored Feuerrate, Geschwindigkeit und Reichweite. Je Variante drei Durchläufe
mit jeweils zehn Sekunden Aufwärmen und 30 Sekunden Messung. Dev-Build und
60-Hz-Taktung bleiben für Vorher/Nachher gleich; währenddessen laufen keine Builds
oder Tests.

[Ausgangsmessung](ground-fog-load-baseline.json) vor dem neuen Kapsel-Pass.
Der Ausgangsstand zeichnete wegen der lokalen Grenze weniger Spuren vollständig;
die neue Darstellung leistet somit zusätzlich die zuvor verworfene Arbeit.
CPU Submission und asynchrone GPU-Zeit umfassen das Nebelsystem. Die Framezeiten
sind bei 60 Hz begrenzt und erlauben hier keine Aussage über die maximale Bildrate.

## Messergebnis

[Alle neun finalen Messläufe](ground-fog-load-benchmark.json). Nach der letzten
Zeitkorrektur wurden die drei Reaktionsläufe wiederholt; Aus und Grundnebel sind
von dieser Korrektur unberührt. Alle Läufe haben eine gültige Taktung.

Die Tabelle zeigt jeweils den Median der drei **Lauf-Kennzahlen**, keine aus
zusammengelegten Einzelwerten berechneten Percentile. Alle Zeitwerte in Millisekunden.

| Variante | CPU Median / p95 / p99 | GPU Median / p95 / p99 | Frame Median / p95 / p99 |
| --- | --- | --- | --- |
| Aus | 0,0 / 0,0 / 0,1 | nicht gemessen, keine Nebelpässe | 16,5 / 17,2 / 17,6 |
| Grundnebel | 0,3 / 0,4 / 0,5 | 0,389 / 2,872 / 3,664 | 16,5 / 17,2 / 17,6 |
| Alle Reaktionen, vorher | 0,4 / 0,8 / 0,9 | 0,896 / 2,939 / 3,949 | 16,5 / 17,5 / 18,0 |
| Alle Reaktionen, jetzt | 0,4 / 0,6 / 0,7 | 0,584 / 3,079 / 4,609 | 16,5 / 17,3 / 17,7 |

Der GPU-Median sinkt um etwa 35 %, CPU-p95 um 25 %. Die hohen GPU-Percentile
verbessern sich nicht: p95 steigt hier um rund 5 %, p99 um rund 17 %. Der neue
Pass zeichnet dafür sämtliche 540 gespeicherten Spuren; vorher fehlten Teile
aufgrund der lokalen Überläufe. Die GPU-Zeit enthält auch die Simulation mit
30 Hz und schwankt zwischen Frames mit und ohne Simulationsschritt. Aus diesen
Messungen folgt keine allgemeine Beschleunigung jeder Lastspitze oder Hardware.

Aktiv sind 20 Chunks, ohne Cache-Chunks in dieser festen Ansicht. Der erfasste
GPU-Speicher steigt von 22,5 auf 23,0 MiB, einschließlich des neuen Vertexpuffers.
Alle Reaktionsläufe enden mit 540 gespeicherten und 540 eingereichten Spuren,
einem Spur-Draw-Call und null verworfenen Eingaben. Im Modus Aus bleiben
Ressourcen und Renderpässe bei null.
