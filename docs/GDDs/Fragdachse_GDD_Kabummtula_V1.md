# Fragdachse – GDD Kabummtula V1

- Version: 1.0
- Datum: 2026-10-17
- Status: umgesetzt (Produktion `kt-v1-r1`, Schattenmesh `enemy-mesh-kt-v1-r1`); Optimierungsphase mit Testfeedback offen
- Spielmodus: Coop Defense (Kampagne, From Dachs Till Dawn)
- Arbeitstitel: Kabummtula (Wortspiel aus „Kabumm“ und „Tarantula“), EN „Kaboomtula“
- Gegner-ID: `kaboomtula` (ersetzt `timebomb-badger` an derselben Registry-Position, Wire-Kind-Index 12)

## 1. Ziel und Spielerlebnis

Eine leicht gruselige, schwarz-violette Vogelspinne mit prall leuchtendem „Bomben-Abdomen“. Sie jagt
Spieler, kündigt sich kurz drohend an, rast dann schneller als ein Spieler im Zickzack heran und springt
mit gut lesbarem Telegraph. Wer im richtigen Moment ausweicht, überlebt; wer berührt wird, fliegt in die
Luft. Nebenbei spuckt sie Netze auf Türme und schaltet sie kurz ab. Spannung entsteht aus Reflexen und
Positionierung, nicht aus einer langen Zündschnur.

## 2. Kern

- **Kontakt = Explosion.** Jeder Körperkontakt mit einem Spieler (auch beim Anlaufen oder Drohen),
  einem Köder oder einer besetzten Struktur löst sofort die große Explosion aus. Keine Verzögerung.
- **Abschuss = kleine Verpuffung.** Getötet stirbt die Spinne nur in einer kleinen GPU-Verpuffung
  (Mini-Schaden für Spieler und Köder), nie in der großen Explosion. Sie kann nicht wiederbelebt werden.
- **Turm-Netz.** Aus der Distanz spuckt sie ein klebriges Netz auf einen Turm; er feuert ca. 4 s nicht.

## 3. Rolle und Zielwahl

- Hauptziel sind Spieler (`movementTarget: players`). Köder lenken sie wie andere Gegner ab.
- **Basis-Kamikaze:** Ist die Basis sehr viel leichter erreichbar als jeder Spieler (Wegkosten
  aller Spieler > 3 × Basis, oder kein Spieler erreichbar), greift sie die Basis an. Hysterese:
  Freigabe erst unter 2 × und nach 3 s. Ein sichtbarer Spieler in 450 px gewinnt immer.
- Türme sind nie Ziel der Explosion, nur des Netzes (opportunistisch, ohne Umweg).

## 4. Verhaltensablauf

| Phase | Verhalten |
|---|---|
| Annäherung | normale Wegfindung zum Ziel; Felsbiss nur zum Durchbrechen |
| Drohen (~0,4 s) | sieht sie das Ziel in ~450 px: stehen, Vorderbeine heben, Glühen schwillt an |
| Sturmlauf | ~370 px/s im Zickzack (Darts, Haken 18–46°, kurze Stopps), Blick zur Beute |
| Telegraph (~0,42 s) | ab ~120 px: läuft weiter und pirscht seitlich im Abstand 85–135 px; verdeckt Deckung die Beute, kehrt sie auf eine freie Linie zurück. Rote Bahn mit Zielring folgt dem Spieler und füllt sich. Ist die Bahn beim Absprung blockiert, hält sie die Ankündigung bis zu ~0,36 s länger und versucht es erneut |
| Sprung (~0,21 s) | Bahn rastet beim Blitz ein (Vorhalt 0,7 × Geschwindigkeit × Flugzeit, plus Überschuss); immun gegen Rückstoß |
| Erholung (~0,65 s) | nach einem Fehlsprung; danach beginnt alles von vorn (erneutes Drohen) |
| Spucken (~0,36 s) | ohne Spieler in Sicht: Turm in 380 px, der sie sehen könnte; unbesponnene zuerst |

Ausweichen: Wer genau beim Lock-Blitz die Richtung wechselt oder dasht, verlässt die fixierte Bahn.
Bloßes Weiterlaufen in eine Richtung reicht wegen des Vorhalts nicht.

## 5. Sonderfälle

- Stun bricht Drohen, Sturmlauf, Telegraph und Spucken ab; ein Sprung endet an der aktuellen Position
  in der Erholung. Treffer-Stagger stoppt keinen Sprung.
- Eine blockierte Sprungbahn ist kein Sprung: die Spinne jagt weiter und versucht es nach kurzer Sperre.
- Verlorene Sicht im Sturmlauf: nach ~0,7 s Erholung, dann neue Annäherung.
- Ein Netz frischt ein bestehendes Netz auf (keine Stapelung). Verschwindet der Turm im Flug, verpufft es.

## 6. Darstellung, Audio, Lesbarkeit

- Farbregel: Rot nur für den Telegraph; Leerenviolett für Gefahr (Laufglühen, Netz, Explosion); kein Gelb.
- Glühen phasengetrieben: gedimmt → anschwellend → stark pulsierend im Sturm → abklingend.
- Netz: klebriger Klumpen im Bogen mit Seidenfaden, dann ein Netz über dem Turm (heller Fliederfaden
  über dunklem Unterstrich für Tageslicht), verblasst in den letzten 0,4 s. Als GPU-Radnetz gezeichnet:
  Rahmenfaden, Speichen, Fangspirale, Klebetropfen, Seidenglanz; Fadenbreite in Bildschirmpixeln.
- Kein Gefahrenmarker (Entscheidung des Users): Die Gefahr trägt das violette Silhouetten-Leuchten der
  Spinne samt Halo, leise im Anmarsch, anschwellend beim Drohen, am stärksten im Sturm und Sprung.
- Explosion: bestehender Leerenstil `timebomb`, Verpuffung `timebomb_pop`. Eigene Spinnen-Sounds folgen.

## 7. Tuning (Startwerte, `coopDefenseEnemies.json`)

Größe 26, HP 60, Annäherung 140 px/s. Explosion 70 Schaden voll für das berührte
Ziel, sonst Abfall bis 20 % am Rand von 130 px, Basisschaden 120, Rückstoß 420, Leerenfeuer.
Netz: Reichweite 380, Dauer 4000 ms, Abklingzeit 7000 ms.

## 8. Begegnungen

Karte 16 (Spinnensteig) als Einführung in fast allen Überfällen, Dawn-Block `timebomb-rush`, Blutmond-Gewichtung.
Testkarte 0: Encounter `kaboomtula-gate-1`.

## 9. Technische Leitplanken

- Host-Owner `CoopDefenseKaboomtulaSystem` (Activity) entscheidet alles; Clients zeichnen nur den
  replizierten `KaboomtulaState` (eigenes Snapshot-Feld) und den `tw`-Slice der Netze.
- Turm-Netze gehören dem Activity-Owner `CoopDefenseTurretWebSystem`; das World-Turmfeuer liest nur
  `isWebbed` und setzt betroffene Feuerquellen (inkl. Feuerleit-Kopien) auf `disabled`.
- Protokoll 39.

## 10. Abnahme (Gates)

GC1 Feel (Tempo, Telegraph, Ausweichfenster, Netz, Schaden) → GA1 Form → GA2 Draft-Clips im Spiel →
GC2 Visuals → GA3 Produktion → C5 Cutover.
