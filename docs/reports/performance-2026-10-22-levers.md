# Performance: freigegebene Hebel nach dem Nachtlauf (22.10.2026)

Umsetzung der Hebel, die nach dem [Nachtlauf](performance-2026-10-22-overnight.md) freigegeben wurden:
Vegetationslicht, Bodenfeuer-Netz, Gegner-KI nach Entfernung, Wildtiere nur im Bild und Lebensbalken per
Shader. Ausgangsstand ist `c2adcc67`, also main `797179cf` plus Vogel-Vorab-Culling, ergänzt um die beiden
Messfälle unten. Der Endstand ist die Integration auf `perf-night-1022`.

## Messung

Performance-Lab-Suite, hohe Qualität, 1920 × 1080, je 3 Läufe pro Seite im Wechsel. Angegeben ist die
CPU-Zeit pro Frame (Median der Lauf-Mediane). Auf dem Rechner lief die ganze Zeit ein fremder Vite-Dev-Server
mit mehr als einem Kern Dauerlast. Absolutwerte schwanken deshalb zwischen Messreihen; belastbar sind nur
die Paare innerhalb einer Reihe.

| Fall | CPU p50 | CPU p95 | Frame p95 |
|---|---|---|---|
| `campaign.map16-endgame` | 10,3 → 9,0 ms (−12,6 %) | 14,6 → 14,2 ms (−2,7 %) | 18,2 → 13,0 ms |
| `review.enemies-100` | 10,4 → 10,2 ms (−1,9 %) | 14,3 → 13,5 ms (−5,6 %) | 18,1 → 12,2 ms |
| `review.enemies-300` | 21,3 → 20,7 ms (−2,8 %) | 26,2 → 25,5 ms (−2,7 %) | 30,2 → 24,4 ms |
| `review.enemies-500` | 34,7 → 34,4 ms (−0,9 %) | 42,7 → 42,9 ms | 42,5 → 42,5 ms |
| `review.enemies-300-far` | 11,2 → 11,2 ms (±0 %) | 14,0 → 14,1 ms | 18,1 → 18,1 ms |
| `review.player` | 3,9 → 3,8 ms (−2,6 %) | 4,6 → 4,5 ms | unverändert |
| `combat.day` | 11,9 → 11,7 ms (−1,7 %) | 15,5 → 15,2 ms | unverändert |
| übrige Review-Fälle | ±0 bis −2,5 % | bis −4 % | unverändert |

Das Vegetationslicht allein gegen den Ausgangsstand, in einer stärker belasteten Reihe gemessen: Map 16
CPU p50 −15,6 %, p95 −9,8 %. Es trägt damit den größten Teil des Map-16-Gewinns.

## Hebel

| Hebel | Umsetzung | Ergebnis |
|---|---|---|
| Vegetationslicht | Nicht vorgebacken. Im Profil von Map 20 kostete das Material 4,3 % CPU, fast alles davon Uniform-Arbeit je Chunk-Draw. Sonne, Wolken und Tuning werden jetzt einmal pro Frame gesetzt. Ein Dirty-Apply (`src/graphics/DirtyUniformApply.ts`) reicht nur geänderte eigene Uniforms an das Programm weiter. Gilt für Bodenbewuchs und Fels-Bewuchs. | Bitgleiche Optik, keine Sprünge im Tagesverlauf. Größter Anteil am Map-16-Gewinn. |
| Bodenfeuer-Netz | Binärer Lauflängen-Codec statt JSON-Tupel (`burningGroundSnapshotCodec.ts`). Zellen werden über Stil und Rasterposition identifiziert statt über Host-IDs. Warnungen gehen nur noch als Änderungen raus, jede Änderung wird 3 Takte wiederholt, das volle Band einmal pro Sekunde. Protokoll 46. | Map-16-Vollstand 193 KB → 0,45 KB. Feuerwand-Phase 489 → 3,2 KB/s. Client 0,23 → 0,10 ms pro Takt, Host 0,21 → 0,17 ms. Im Lab nicht sichtbar, weil es nur den Host misst. |
| Gegner-KI nach Entfernung | `EnemyAiDetailTiers`: Gegner weiter als 760 px außerhalb jeder Spieleransicht steuern ohne Sichtlinien und Gedränge-Bewertung. Eine Gedränge-Dosierung (Kegel nach vorn, Folgeabstand) hält die Ankunftszeiten im Testaufbau innerhalb von ±8 % der vollen KI. Vergleiche mit allen Kandidaten nur alle 400–600 ms. | Navigations-CPU bei dichten fernen Massen −16 bis −35 %. Im neuen Fall `review.enemies-300-far` ±0 %: Lockere Gegner kosten auch mit voller KI kaum etwas. Rest: An einer dauerhaft gestauten Engstelle außerhalb des Bildes kommen etwa 30 % mehr Gegner pro Minute durch. |
| Wildtiere nur im Bild | War bereits umgesetzt (Simulationsrand 192 px, Render-Culling vor dem Sampling). Ergänzt um ein Vorab-Culling der Vögel vor Schattenprojektion und Wolkenabfrage. | Klein, im Rauschen. |
| Lebensbalken per Shader | Eine gebündelte SDF-Ebene je Familie für die Weltbalken; vorher 3 Rechtecke pro Balken. Lebendige Balken mit SDF-Maske statt 51 bzw. 129 Streifenbildern. HUD-Balken mit abgerundetem Trog, Verlauf, Glanz, hellerer Vorderkante und Nachlauf. | Bei 90 Gegnern: 270 Rechtecke → 1 Bild, Anzeigeliste 2266 → 1997 Objekte, Draw-Calls gleich. Optik: Weltbalken mit runden Enden, 1-px-Rand und warmem Hintergrund, besser lesbar. Vergleichsbilder in `build/perf-bars-2026-10-22/compare-*.png`. |

## Neue Messfälle

- `campaign.map16-endgame` (Version `map16-endgame-2`): Die Messung beginnt erst, wenn Feuer sichtbar ist.
  Rückstoß über 64 px setzt den Spieler auf den cp8-Marker zurück.
- `review.enemies-300-far`: 300 Gegner starten 1800–3500 px entfernt. Gegner, die näher als 450 px kommen,
  werden wieder hinausgesetzt. Die Zähler `navFarSolves`, `navFarSteeringReuses` und `navFarNarrowScans`
  belegen, dass die ferne Stufe aktiv war (Probelauf: 93.260 ferne Lösungen).

## Offen

- Weltbalken liegen weiterhin unter der Lightmap und werden nachts mit abgedunkelt. Sie darüber zu legen,
  wäre eine Designentscheidung, weil Gegner dann im Dunkeln sichtbar würden.
- Lobby-Knöpfe und die Glows im TAB-Panel wurden nicht per Screenshot geprüft. Sie laufen über denselben
  Code wie die geprüften Upgrade-Knoten.
- Volles Vorbacken des Vegetationslichts nur, falls ein Profil nach diesem Stand noch nennenswerte
  Vegetationskosten zeigt.

## Prüfung

`npm run check:release` grün auf dem Endstand (Protokoll 46, Core, Architektur, Builds, Integration, Assets,
Stress, Dawn-Stress). Die Agenten-Zweige liefen jeweils einzeln durch `npm run check` bzw.
`npm run check:release`, dazu `test:integration` und die `NAVIGATION_STRESS`-Tests.
