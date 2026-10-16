# Map 14: großflächiges Feuer – zweite Runde

Fortsetzung von [Runde 1](performance-map14-fire-2026-10-07.md). Szenario wieder
`hazards.map14-fire`, High, 1920 × 1080, DPR 1, drei unprofilierte Läufe je Build in
abwechselnder Reihenfolge; Tabelle = Median der drei Laufstatistiken. Referenz ist der
Stand nach Runde 1 (`f4d744e5`).

## Befund vor dieser Runde

- **Hitch bei jeder Feuer-Änderung.** Schon vier neue oder erloschene Zellen eines kleinen
  orangen Feuers neben der 5.220-Zellen-VoidFire-Fläche lösten im Renderer einen vollständigen
  Neuaufbau aus: String-Signatur aller Zellen samt Sortierung, alle 140 Emissionsregionen,
  Randdistanz über String-Lookups. Gemessen 12–15 ms pro Änderung, im Szenario etwa zweimal
  pro Sekunde.
- **Clients bauten jeden Netztick neu.** `mergeBurningGroundDelta` lieferte bei unveränderter
  Fläche trotzdem ein neues Zellarray (20 Hz); damit lief auf Clients jeder Tick in die volle
  Renderer-Prüfung (Merge ≈ 0,3 ms + Signatur ≈ 1,8 ms).
- **Partikelbudget außerhalb des Bildes.** Die Bodenfeuer-Lane (6.144 Slots) war gesättigt und
  auf ≈ 30 % Dichte gedrosselt – verteilt über alle Zellen, von denen nur rund die Hälfte im Bild
  lag. Ebenso landeten die 12 Bodenfeuerlichter nach Kartenreihenfolge irgendwo auf der Karte.
- Host: Jede Änderung ließ `FireSystem` alle Zellobjekte neu anlegen und `NetworkBridge` alle
  Zellen neu kodieren; ein erneuertes, unverändertes Dauerfeuer markierte den Snapshot als geändert.

## Änderungen

- `GroundFireClusterRenderer.syncGround` vergleicht numerische Zellschlüssel mit dem vorherigen
  Stand und baut nur betroffene 8×8-Regionen neu; die Randdistanz der Nachbarregionen wird
  nachgezogen. Gemessene Kosten pro Änderung: ≈ 0,8 ms statt 12–15 ms.
- Emission nur für Regionen im gepolsterten Kamerabild (160 px). Das Dichtebudget folgt dem
  sichtbaren Bedarf; eine zurückkehrende Region füllt genau die während ihrer Abwesenheit
  ausgebliebene, jüngste Population mit gestaffelten Altern nach.
- Bodenfeuerlicht in weltfesten 512-px-Blöcken: Sichtbare Blöcke bekommen das Budget, große
  Blöcke strahlen breiter, durch Kamerafahrt neu gewählte Lichter blenden über 360 ms ein.
- `NetworkBridge`: Unveränderte Geometrie behält auf Clients ihr Array (auch beim periodischen
  Vollsnapshot); der Host verwendet die Kodierung unveränderter Zellobjekte wieder.
- `FireSystem`: Unveränderte Zellen behalten ihr Snapshot-Objekt; ein Refresh ohne Wertänderung
  erzeugt keinen neuen Snapshot.

## Ergebnis

| Kriterium | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| CPU pro Frame, Mittelwert | 6,33 ms | 6,26 ms | −1,1 % |
| CPU pro Frame, p95 | 8,20 ms | 8,00 ms | −2,4 % |
| CPU pro Frame, p99 | 9,90 ms | 9,20 ms | −7,1 % |
| CPU pro Frame, Maximum | 23,5 ms | 20,1 ms | −14,5 % |
| Visual Tail, Mittelwert | 1,21 ms | 1,12 ms | −6,7 % |
| Renderübergabe auf CPU | 3,31 ms | 3,36 ms | im Rauschen |
| GPU-Renderphase, Mittelwert | 1,82 ms | 1,83 ms | unverändert |
| Draw Calls pro Frame | 145,0 | 145,7 | unverändert |

Last in allen sechs Läufen identisch: 5.220 VoidFire-Zellen, mindestens 2.642 sichtbar,
Gegnermaximum 43–45. Die Referenz streut stärker (CPU-Mittel 6,17–7,50 ms) als der neue
Stand (6,24–6,33 ms). Frameabstände bleiben an die Bildwiederholrate gebunden (p95 12,1 ms).

Der Durchschnitt sinkt kaum, weil Phasers allgemeine Renderübergabe (≈ 3,3 ms) dominiert und
feuerspezifischer Dauercode nach Runde 1 bereits klein war (Renderer-Selbstzeit im Profil
110 → 61 µs pro Frame). Der Gewinn liegt in den Spitzen und auf Clients, die das Lab nicht
misst (Host-only): dort entfallen pro Netztick ≈ 2 ms.

## Optik

Bei gleicher Partikelzahl liegt die sichtbare Dichte jetzt bei ≈ 0,42 statt ≈ 0,30 des
Entwurfswerts; die Fläche wirkt geschlossener. Die Lichter liegen auf dem sichtbaren Feuer,
sodass die Fläche den Boden sichtbar aufhellt, statt nur als violetter Schleier zu lesen.

## Grenzen

- Ryzen 7 5800X, RTX 3080 (ANGLE/D3D11), Chrome 154; ein Rechner, keine Low-End-GPU.
- Mehr Partikel liegen nun im Bild: Auf füllratenschwachen GPUs kann die Bodenfeuer-Lane etwas
  mehr kosten, auf der RTX 3080 unverändert.
- Clientwerte stammen aus Mikromessungen der betroffenen Funktionen, nicht aus einem
  WebRTC-Zweirechnerlauf.

## Reproduktion

```powershell
npm run perf:chrome -- --suite --sites build/fire2/ab-sites.json --output-root D:/perf/fire2/ab --runs 3 --qualities high --case hazards.map14-fire --max-c-growth-mib 2048
```

Builds unter `build/fire2/{baseline,current}/site`, Zusammenfassung `build/fire2/summary.json`
(lokal, nicht versioniert).
