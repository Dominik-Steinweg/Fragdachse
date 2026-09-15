# Projektil-Replikation: Größen- und CPU-Vergleich

Gemessen am 15.09.2026 unter Windows mit Node v24.14.0 und Vitest 3.2.7.
[Rohwerte](projectile-replication-benchmark.json), [Lastszenario](../tests/stress/ProjectileReplicationLoad.test.ts),
[CPU-Vergleich](../tests/stress/ProjectileReplicationCpu.test.ts).

## Befund und Entscheidung

Die Reproduktion bestätigt den großen Anteil der Flugbahnhistorien: Bei vier P90-Schützen
und TimeBubble entfallen im alten Format etwa **94,5–94,8 % auf aktive Pfade** und weitere
**4,7–4,9 % auf abgeschlossene Pfade**. Ohne Bubble sind abgeschlossene Pfade relativ
bedeutender (rund 41–43 %), weil Geschosse schneller verschwinden.

Aktive Historien werden mit jedem Snapshot erneut übertragen. Endpfade werden vier Ticks
nachgeliefert. Diese Redundanz repariert Paketverlust und bleibt erhalten. Acht JSON-Zahlen
pro Pfadpunkt wiederholen unter anderem Epochenzeit, Geschwindigkeit und Null-Flags.

Die Kompaktierungshypothese trifft teilweise zu: Der Recorder verlangt nahezu gleiche
räumliche Änderungsraten pro Zeitintervall. Die untersuchten Host-Zeitstempel stammen
jedoch beide aus `Date.now()`; eine unterschiedliche absolute Zeitbasis wurde nicht gefunden.
Physik integriert mit ihrem eigenen Delta, während Beobachtungen ganzzahlige Wandzeit
erhalten; mehrere nachgeholte Schritte können denselben Zeitstempel haben. Daher bleiben
auch bei gerader Bewegung viele Punkte erhalten. Eine rein geometrische Vereinfachung
würde die bestehende zeitliche Interpolation verändern.

Die Lösung erhält deshalb **alle Punkte, Zeitstempel und IEEE-754-Koordinaten exakt**:
ein binärer Prädiktor mit verlustfreien XOR-Korrekturen und optionaler nativer Deflate-Kompression.
Prädiktoren starten pro Pfad neu und brauchen keinen älteren Snapshot. Auch bei variablen
Physikintervallen ist ein räumlicher Prädiktor nur eine Speicherhilfe; exakte Korrekturen
erhalten die ursprüngliche Geometrie. Gameplay, Physik, TimeBubble, GPU-Tracer und Recorder
wurden nicht geändert. Der Adapter liest die Projektion außerdem nur noch einmal pro Snapshot.

## Übertragungsmenge

Dezimale kB = 1.000 Byte; **pro Empfänger**. Peak bezeichnet die Summe aller Fragmente einer
logischen Nachricht, nicht einen einzelnen `send()`-Aufruf. Nachher enthält die Messung
UTF-8, Kompression und 24 Byte Header je Fragment. SCTP-, DTLS- und IP-Overhead ist nicht
enthalten. Vorher ist das alte JSON-Format derselben Datensätze. Die Ersparnis bezieht sich
auf das gesamte Datenvolumen. Andere Game-State-Slices als Projektile sind hier nicht enthalten.

| Schützen | Bubble | Intervalle | Peak kB vorher → nachher | kB/s vorher → nachher | Ersparnis |
|---:|:---:|---|---:|---:|---:|
| 1 | nein | 60 Hz | 15,0 → 2,1 | 246,3 → 18,4 | 92,5 % |
| 1 | nein | Frame variabel | 21,6 → 2,1 | 343,6 → 19,6 | 94,3 % |
| 1 | nein | Frame + Physik variabel | 24,6 → 2,0 | 390,2 → 29,8 | 92,4 % |
| 1 | ja | 60 Hz | 188,1 → 5,7 | 2997,8 → 87,8 | 97,1 % |
| 1 | ja | Frame variabel | 295,6 → 6,3 | 4356,8 → 91,5 | 97,9 % |
| 1 | ja | Frame + Physik variabel | 324,9 → 16,3 | 4831,7 → 245,2 | 94,9 % |
| 4 | nein | 60 Hz | 57,1 → 2,5 | 976,6 → 43,3 | 95,6 % |
| 4 | nein | Frame variabel | 80,9 → 2,9 | 1369,6 → 48,7 | 96,4 % |
| 4 | nein | Frame + Physik variabel | 92,9 → 5,2 | 1553,6 → 86,7 | 94,4 % |
| 4 | ja | 60 Hz | 743,4 → 19,6 | 11900,9 → 308,5 | 97,4 % |
| 4 | ja | Frame variabel | 1141,4 → 20,6 | 17283,4 → 304,0 | 98,2 % |
| 4 | ja | Frame + Physik variabel | 1255,4 → 56,4 | 19153,2 → 865,5 | 95,5 % |

Der gemeldete Ein-Spieler-Fehler ist reproduzierbar: **295.625 Byte** mit Frame-Jitter.
Vier Schützen erreichen **1.141.351 Byte**, bei zusätzlichem Physik-Jitter **1.255.449 Byte**.
Die neuen logischen Nachrichten können weiterhin größer als das SCTP-Limit sein; deshalb
ist Kompression allein keine ausreichende Absicherung.

Ohne native Kompression bleibt das neue Format korrekt und wird ebenfalls fragmentiert.
Bei vier Schützen mit Bubble und Frame-Jitter sinkt bereits das unkomprimierte JSON von
1.141.351 auf 138.130 Byte Peak; bei zusätzlichem Physik-Jitter von 1.255.449 auf 251.677 Byte.
Mehrere entfernte Empfänger vervielfachen die Host-Sendebandbreite entsprechend.

## Pfadpunkte und Redundanz

Mittelwert über übertragene aktive und abgeschlossene Pfade; der Codec verändert keinen Punkt.
Die folgenden Anteile beziehen sich auf das **alte** gesamte JSON-Nachrichtenvolumen.
Endpfadanteil enthält den vollständigen abgeschlossenen Dynamikdatensatz.

| Bubble | Intervalle | Max. aktive Projektile (4 Schützen) | Punkte/Pfad vorher → nachher | Aktive Pfadhistorien | Endpfade |
|:---:|---|---:|---:|---:|---:|
| nein | 60 Hz | 28 | 14,53 → 14,53 | 55,9 % | 40,9 % |
| nein | Frame variabel | 29 | 20,25 → 20,25 | 55,3 % | 42,4 % |
| nein | Frame + Physik variabel | 29 | 23,04 → 23,04 | 55,5 % | 42,5 % |
| ja | 60 Hz | 196 | 36,44 → 36,44 | 94,5 % | 4,8 % |
| ja | Frame variabel | 206 | 52,45 → 52,45 | 94,8 % | 4,7 % |
| ja | Frame + Physik variabel | 200 | 59,65 → 59,65 | 94,7 % | 4,9 % |

Abpraller, Geschwindigkeitswechsel, Unterbrechungen und Einschlagsendpunkte bleiben in
denselben sequenzierten Punkten erhalten. Unabhängige Snapshots sowie bestehende
Despawn-, Static-Refresh- und Full-Baseline-Verträge bleiben erhalten.

## CPU-Kosten

Der gepaarte Vergleich führt den unveränderten alten Codec aus Commit
`468d177b913a049f7dcf0667388c00b76f0d5a70` und den neuen Codec im selben Prozess auf
identischen Recorder-Pfaden aus. Pro Fall: 30 Aufwärm- und 100 Messdurchläufe,
abwechselnde Reihenfolge, exakter Roundtrip-Vergleich. Acht bzw. 200 vollständige Pfade
mit unterschiedlichen Richtungen; dieser isolierte Fall ist keine P90-Framezeit.

Alle Werte sind p95 in Millisekunden pro vollständigem Satz:

| Pfade | Physikintervall | Punkte/Pfad | Kodieren + JSON vorher → nachher | JSON-Parsing + Dekodieren vorher → nachher |
|---:|---|---:|---:|---:|
| 8 | fest | 40 | 0,575 → 0,564 | 0,937 → 0,267 |
| 8 | variabel | 59 | 1,018 → 1,480 | 0,639 → 0,591 |
| 200 | fest | 40 | 24,585 → 22,026 | 15,904 → 9,936 |
| 200 | variabel | 59 | 31,693 → 35,321 | 22,280 → 18,456 |

Bei 200 Pfaden mit variabler Physik kostet Kodierung rund **11 % mehr**, während Parsing und
Dekodierung rund **17 % weniger** benötigen. Kleine Datensätze und Messrauschen können andere
Verhältnisse zeigen. Die Änderung ist primär eine Bandbreiten- und Stabilitätsoptimierung;
sie garantiert keine allgemeine CPU-Beschleunigung.

Zusätzliche Zeiten aus dem echten Runtime-/Adapter-Lastszenario, vier Schützen mit Bubble:

| Intervalle | Adapter + Kodieren + JSON | Pfaddekodieren ohne JSON-Parsing | Deflate-Latenz | Inflate-Latenz |
|---|---:|---:|---:|---:|
| 60 Hz | 5,409 | 2,237 | 2,757 | 0,605 |
| Frame variabel | 4,959 | 3,977 | 2,300 | 0,477 |
| Frame + Physik variabel | 8,863 | 4,143 | 5,039 | 0,913 |

Deflate/Inflate sind asynchrone gemessene Laufzeiten, keine reine Hauptthread-CPU-Zeit.
`scenarioCpuMs` in den Rohdaten umfasst die gesamte Testfixture einschließlich Simulation,
alter Vergleichskodierung, Prüfungen und Kompression. JIT, GC und Systemlast beeinflussen
die Messung; diese Werte sind kein Browser-FPS-Nachweis. Kompression findet pro Link statt.

## Transport und Fehlerfälle

- Native Nachrichten sind auf 16 KiB und zusätzlich das ausgehandelte SCTP-Limit begrenzt.
  Ein Größenfehler verkleinert das Fragment und wiederholt denselben noch ungesendeten
  Abschnitt. Bereits gesendete Offsets bleiben gültig.
- `OperationError` und Backpressure warten auf Pufferentleerung bzw. einen Retry.
  Lokale Größen-/Pufferfehler schließen die Verbindung nicht.
- Begonnene Nachrichten werden abgeschlossen. Wartende Fast-Batches werden pro Store-Key
  zusammengeführt, damit etwa ein Input-Update keinen wartenden Snapshot entfernt.
- Reliable bleibt einschließlich asynchroner Kompression/Dekompression geordnet.
  Fragmente werden erst als vollständige logische Nachricht veröffentlicht.
- Empfangsspeicher und Queues sind begrenzt; logisch maximal 16 MiB. Eine endgültig
  erschöpfte Reliable-Queue wird ausdrücklich als Transportüberlast gemeldet.
- Join und Reconnect übernehmen zuerst die Welcome-Baseline; überholender Fast-Zustand
  darf sie nicht vorwegnehmen. Irreführende pauschale Firewall-Diagnosen wurden entfernt.
- Protokollversion **16**: alle Teilnehmer müssen dieselbe neue Version laden.

Die Behandlung nativer Fehler folgt den
[WebRTC-Send-Regeln](https://www.w3.org/TR/webrtc/#dom-rtcdatachannel-send);
Kompression verwendet die optionale
[Compression Streams API](https://compression.spec.whatwg.org/).

## Reproduzierbare Szenarien und Grenzen

Zwölf Fälle: 1/4 Schützen × mit/ohne Bubble × feste Intervalle/Frame-Jitter/Frame- und
Physik-Jitter. Je 12 Sekunden, davon elf Sekunden ununterbrochenes Feuer mit authored
P90-Tempo (80 ms), Geschwindigkeit, Reichweite und Projektilgröße. Ressourcen und Nachladen
begrenzen die Testlast absichtlich nicht; die Produktionsregeln bleiben unverändert.

Feste Physik: 60 Hz. Frame-Jitter: `[7, 11, 29, 5, 41, 13, 9, 19]` ms.
Variable Physik: `[1000/120, 1000/45, 1000/90, 1000/60]` ms. Feste Seed-Folge für Richtungen.
Die feste Physik verwendet für den Vorhervergleich einen erneuerten Slow-Korridor in Breite
des authored Bubble-Durchmessers. Die zusätzliche variable Physik verwendet den echten
`TimeBubbleSystem` mit kreisförmigen Feldern, authored Slow-Faktor und natürlichem Ablauf
sowie erneuter Erzeugung nach fünf Sekunden.

Die Fixture verwendet WorldProjectileRuntime, ReplicationAdapter und Codecs mit einer
simulierten Arcade-Grenze. Physikbeobachtungen gehen der Bestätigung über Sprite-PostUpdate
voraus. Netzwerk läuft mit 20 Hz. Drei von elf Updates verlieren ein Fragment bzw. die
ganze Nachricht; übrige Fragmente kommen vertauscht und doppelt an. Nur vollständige
Nachrichten dürfen replizierten Zustand verändern. Es gibt keinen neuen ACK-/Delta-Pfad,
der nach Paketverlust dauerhaft auf einen fehlenden Vorgänger warten könnte.

Weitere Tests prüfen verlorene Endsegmente, späte Pfadergänzung ohne Wiederbelebung,
Abpraller, Teleports, Tempowechsel, gleiche Zeitstempel, 128 unregelmäßige Punkte,
fehlerhafte/trunkierte Daten, Begrenzung der Dekompression und fehlende native Kompression.
PeerLink-/PeerRoom-Tests prüfen vollständige große Baselines bei Join und Resume mit
1.024-Byte-Kanälen, einen während des Sendens sinkenden Größen-Grenzwert, Pufferfehler,
Überlast-Coalescing und Reihenfolge über asynchrone Dekompression.

Die Prüfungen verwenden simulierte RTCDataChannels; es wurde kein Browser/Dev-Server
gestartet und keine echte Browser- oder Internetverbindung gemessen. Unbegrenzt lange
Paketverluste können die bestehende endliche Pfadhistorie überschreiten; dann gelten
weiter die vorhandenen Unterbrechungsregeln statt erfundener Verbindungen.

## Reproduktion

PowerShell im Projektverzeichnis:

```powershell
$env:PROJECTILE_REPLICATION_REPORT = '1'
npx vitest run --pool=threads tests/stress/ProjectileReplicationLoad.test.ts
Remove-Item Env:PROJECTILE_REPLICATION_REPORT
npm run check
npx vitest run --pool=threads tests/integration/TimeBubbleNetwork.test.ts tests/integration/TimeBubbleLifecycle.test.ts tests/integration/TimeBubbleReleasePresentation.test.ts tests/integration/TimeBubbleRegeneration.test.ts tests/integration/RocketLauncherNetwork.test.ts
```

Optionaler gepaarter CPU-Vergleich mit temporärer historischer Referenz:

```powershell
$legacyPath = Join-Path (Get-Location) 'tests/stress/ProjectileLegacyCpuReference.ts'
$legacySource = git show '468d177b913a049f7dcf0667388c00b76f0d5a70:src/network/projectileSnapshotCodec.ts'
$legacySource = $legacySource -replace "from '\.\./", "from '../../src/"
[System.IO.File]::WriteAllLines($legacyPath, $legacySource)
$env:PROJECTILE_LEGACY_CODEC = $legacyPath.Replace('\', '/')
try {
  npx vitest run --pool=threads tests/stress/ProjectileReplicationCpu.test.ts
} finally {
  Remove-Item -LiteralPath $legacyPath
  Remove-Item Env:PROJECTILE_LEGACY_CODEC
}
```

Ergebnis dieses Arbeitsstands: **3.717 Core-Tests, 33 Architekturtests und Build erfolgreich**;
zusätzlich 15 passende Integrationstests, die zwölfteilige Lastmatrix und der gepaarte CPU-Test.

