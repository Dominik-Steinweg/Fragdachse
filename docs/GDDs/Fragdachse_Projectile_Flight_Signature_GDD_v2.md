# Fragdachse – Projectile Flight Signature GDD

**Status:** Konzept / Implementierungsgrundlage  
**Geltungsbereich:** Visuelle Darstellung fliegender Projektile, Tracer, projektilgebundene Nachläufe, Ricochets/Bounces und deren visuelle Verbindung zu Mündungsfeuer und Impact  
**Architekturrahmen:** Gemeinsamer technischer Unterbau für pfadgebundene Projectile-Trails bei klar getrennter visueller Semantik  
**Nicht Bestandteil:** Gameplay-, Physics-, Collision-, Damage-, Netzwerk- oder Waffenbalance-Änderungen

---

## 1. Ziel

Die Projektil-Darstellung soll deutlich stärker zum **Feeling, Juice und zur Waffenidentität** von Fragdachse beitragen.

Ein Projektil soll nicht mehr primär als kleiner bewegter Körper mit einer unauffälligen geraden Linie wahrgenommen werden. Stattdessen soll jeder Schuss eine klar erkennbare **Flight Signature** besitzen:

> **Mündungsimpuls → scharfer Projektilkopf → heißer gerader Kern → farbiger, alternder Nachlauf → Impact oder Bounce**

Die Darstellung soll gleichzeitig:

- deutlich sichtbarer und eindrucksvoller werden,
- hohe Geschwindigkeit und Energie vermitteln,
- die tatsächliche Flugbahn jederzeit klar lesbar halten,
- verschiedene Waffentypen visuell unterscheidbar machen,
- bei sehr vielen gleichzeitigen Projektilen sauber und übersichtlich bleiben,
- bei hoher Effektdichte nicht zu einem homogenen Licht- oder Partikelteppich werden,
- bei reduzierter Grafikqualität zunächst dekorative Details verlieren, nicht die Combat-Lesbarkeit.

Die Überarbeitung verändert ausschließlich die **Presentation**. Flugbahn, Trefferlogik und Gameplay-Wirkung bleiben unverändert.

---

## 2. Visuelle Leitidee

Die neue Flight Signature besteht aus mehreren aufeinander abgestimmten visuellen Phasen.

### 2.1 Projektilkopf

Der tatsächliche Projektilkopf bleibt der präziseste und schärfste Teil der Darstellung.

Er vermittelt:

- aktuelle Position,
- Bewegungsrichtung,
- unmittelbare Geschwindigkeit,
- Waffen- bzw. Projektilidentität.

Direkt am Projektil darf ein sehr kurzer, scharfer Speed-Streak sichtbar sein.

Der Projektilkopf darf niemals durch den länger lebenden Nachlauf optisch verdrängt werden.

---

### 2.2 Heißer Core-Trail

Direkt hinter dem Projektil liegt ein klar lesbarer, nahezu gerader Core.

Eigenschaften:

- hohe lokale Helligkeit,
- geringe Breite,
- klare Ausrichtung entlang der echten Flugbahn,
- zunächst deutlich aufgehellte bzw. fast weiß-heiße Farbe,
- Übergang in die eigentliche Waffen-/Projektilfarbe mit zunehmendem Alter.

Der Core vermittelt primär **Geschwindigkeit und Energie**.

Die tatsächliche Projektilbahn muss aus ihm sofort erkennbar bleiben.

---

### 2.3 Alternder Wake

Hinter dem Core geht die Spur in einen weicheren Nachlauf über.

Mit zunehmendem Alter darf der Wake:

- breiter werden,
- transparenter werden,
- farbiger und weniger weiß wirken,
- langsam seitlich aus der ursprünglichen Achse driften,
- leicht wellig bzw. instabil werden,
- sich zunehmend auflösen.

Die ursprünglich gewünschte Wellenwirkung entsteht damit **erst im hinteren Teil der Spur**.

Der Bereich direkt hinter dem Projektil bleibt präzise und folgt der realen lokalen Bewegungsrichtung.

### Zentrale Regel

> **Der präzise Core bildet immer den tatsächlich zurückgelegten Projektilpfad ab. Nur der alternde Nachhall darf zusätzlich organisch von diesem Pfad abweichen.**

Bei geradliniger Bewegung ist der Core entsprechend gerade. Bei Homing, Kurven oder anderen kontinuierlichen Richtungsänderungen folgt er dem gekrümmten realen Flugweg. Bei Bounces bildet er den Richtungswechsel als klaren Knick ab.

Dadurch entsteht Juice, ohne die Combat-Lesbarkeit zu verschlechtern.

---

### 2.4 Sparse Motes

Zusätzlich dürfen sehr wenige kleine Licht-, Glut- oder Energiefragmente aus dem alternden Wake herausbrechen.

Sie dienen ausschließlich als Detail.

Sie sollen:

- klein bleiben,
- deutlich schwächer als Core und Wake sein,
- nur vereinzelt vorkommen,
- kurz leben,
- etwas seitlich aus der Flugbahn driften.

Sie dürfen niemals zur dominierenden Form eines normalen Tracers werden.

Hohe Feuerrate erzeugt ihre Dichte bereits automatisch durch die Menge der realen Projektile.

---

## 3. Visuelle Hierarchie

Für jeden normalen Tracer gilt folgende Priorität:

1. **Projektilkopf**
2. **Core-Trail**
3. **Wake**
4. **Motes**

Die untergeordnete Ebene darf die übergeordnete Ebene nicht überstrahlen.

Insbesondere:

- Wake niemals heller als Core,
- Motes niemals auffälliger als Wake,
- der Projektilkopf muss auch innerhalb einer dichten Schusssalve identifizierbar bleiben,
- die Wirkung einer Waffe darf nicht davon abhängen, dass einzelne zufällige Projektile visuell hervorgehoben werden.

---

## 4. Zeitliche Entwicklung

Die Flight Signature soll nicht nur aus unterschiedlich geformten Elementen bestehen, sondern sich sichtbar **über die Zeit entwickeln**.

Ein Trail-Element durchläuft grundsätzlich:

### Phase A – Hot

Unmittelbar nach dem Entstehen:

- scharf,
- eng,
- sehr hell,
- stark aufgehellte Farbe,
- exakt auf der Flugbahn.

### Phase B – Colored

Nach kurzer Zeit:

- Waffen-/Projektilfarbe wird deutlicher,
- Helligkeit nimmt ab,
- Form wird etwas weicher,
- weiterhin weitgehend geradlinig.

### Phase C – Wake

Im hinteren Bereich:

- stärker transparent,
- breiter,
- seitliche Instabilität nimmt zu,
- klarer Übergang von technischer Präzision zu organischem Nachhall.

### Phase D – Dissolve

Am Ende:

- nur noch schwache Fragmente oder Glow,
- keine harte Abbruchkante,
- vollständiges weiches Verschwinden.

---

## 5. Geschwindigkeit als visuelle Information

Die tatsächliche Projektilgeschwindigkeit soll sichtbar werden.

Schnellere Projektile dürfen innerhalb ihres Profils:

- längere Streaks erzeugen,
- einen etwas schärferen Core besitzen,
- etwas stärker aufleuchten,
- relativ schlanker wirken.

Langsamere Projektile dürfen:

- kompakter,
- etwas körperlicher,
- weniger langgezogen wirken.

Die Geschwindigkeit beeinflusst die Flight Signature nur visuell.

### Ziel

Eine extrem schnelle AWP soll bereits anhand ihrer Flugspur schneller wirken als eine Glock, auch wenn beide Einzelbilder nebeneinander betrachtet werden.

---

## 6. Homing und gekrümmte Flugbahnen

Lenkende Projektile sind ein expliziter Pflichtfall der Flight Signature.

### Anforderungen

Bei Homing:

- folgt der präzise Core dem tatsächlich zurückgelegten gekrümmten Flugweg,
- bleibt die aktuelle Bewegungsrichtung direkt am Projektil jederzeit eindeutig,
- darf der sichtbare Trail keine Gerade zwischen früherem Ursprung und aktueller Position bilden, wenn das Projektil tatsächlich eine Kurve geflogen ist,
- bleibt die lokale Krümmung auch kurz nach dem Durchflug nachvollziehbar,
- darf der alternde Wake zusätzlich leicht seitlich von der realen Kurve wegdriften,
- dürfen Wake Spread und Turbulence die reale Kurve nicht so stark überlagern, dass eine falsche Flugbahn suggeriert wird.

### Visuelles Ziel

Ein Homing-Projektil soll durch seine reale Bewegung automatisch eine geschwungene Flight Signature erzeugen. Dafür ist kein künstlicher Homing-Spezialeffekt notwendig.

Beispiel:

```text
                 ●
              ──╯
           ──╯
        ──╯
──────╯
```

Die besondere Optik entsteht aus dem Gameplay selbst: Eine P90 mit aktiviertem Homing darf dadurch sichtbar andere Flugströme erzeugen als dieselbe Waffe mit geradlinigen Projektilen, ohne dass einzelne Schüsse künstlich hervorgehoben werden.

### Abgrenzung

Nicht zulässig sind:

- optische Kurven, die stärker oder anders verlaufen als die reale Projektilbewegung,
- ein Trail, der die Kurve abkürzt,
- ein künstliches „Ziel-Lock“-Band als Ersatz für den realen Flugpfad,
- stärkere Wake-Unruhe nur deshalb, weil Homing aktiv ist, sofern dies nicht zur allgemeinen visuellen Identität des Projektilprofils gehört.

---

## 8. Bounce / Ricochet

Bounces sind ein wichtiger Juice-Moment und sollen durch die neue Flight Signature deutlich besser lesbar werden.

### Anforderungen

Beim Bounce:

- endet die alte Flugbahn nicht abrupt,
- vorhandener Wake der alten Flugrichtung darf natürlich ausklingen,
- die neue Flugrichtung beginnt sofort mit einer neuen klaren Flight Signature,
- der tatsächliche Bounce-Punkt erhält ein kurzes, prägnantes Impact-Feedback,
- alter und neuer Trail ergeben kurzfristig einen sichtbaren Knick.

Das gewünschte Bild ist:

```text
            /
           /
──────────X
```

Der Spieler soll den Abpraller für einen kurzen Moment aus der zurückbleibenden Flugspur ablesen können.

### Vermeiden

- sofortiges Löschen der alten Spur,
- lange leuchtende Zickzacklinien,
- ein Bounce-Effekt, der heller und größer als starke Explosionen wirkt.

---

## 8. Muzzle → Flight → Impact

Mündungsfeuer, Flight Signature und Impact sollen nicht wie drei unabhängige Effekte wirken.

Sie bilden eine gemeinsame visuelle Sprache.

### 7.1 Gemeinsame Farbtemperatur

Beispiel für eine warme ballistische Waffe:

**Muzzle:** weiß / gelb-orange  
**Core:** weiß-heiß → gelb  
**Wake:** orange → dunkleres Orange  
**Impact:** kurzer heller Kern + passende warme Funken

Für Energieprojektile entsprechend eine kalte bzw. projektiltypische Palette.

### 7.2 Gemeinsame Intensitätshierarchie

Grundsätzlich:

- Muzzle = sehr kurzer Ausgangsimpuls,
- Flight Core = kontinuierlich klar lesbar,
- Wake = schwächerer Nachhall,
- Impact = kurzer lokaler Höhepunkt.

Die Flight Signature darf nicht dauerhaft heller wirken als das Mündungsfeuer oder ein relevanter Impact.

---

## 9. Waffenidentität

Nicht jede Waffe soll dieselbe Flight Signature mit nur anderer Farbe verwenden.

Stattdessen werden wenige klar verständliche **Flight-Signature-Profile** verwendet.

Ein Profil beschreibt den visuellen Charakter einer ganzen Waffenfamilie.

---

### 8.1 Light Ballistic

Typischer Einsatz:

- Glock
- leichte präzise Projektile

Charakter:

- kompakt,
- sauber,
- relativ kurzer Core,
- kurzer Wake,
- geringe seitliche Instabilität,
- sehr wenige Motes.

Zielgefühl:

> schnell, knackig, kontrolliert

---

### 8.2 Automatic Ballistic

Typischer Einsatz:

- P90
- schnelle automatische Waffen

Charakter:

- dünner Core,
- kurze Einzelspuren,
- relativ kurze Lebensdauer,
- geringer Wake,
- sehr wenig dekoratives Material.

Die optische Wirkung entsteht primär durch die reale Feuerrate.

Zielgefühl:

> schneller Strom aus Geschossen statt spektakulärer Einzelschüsse

---

### 8.3 Heavy Ballistic

Typischer Einsatz:

- AK47
- kräftige normale Gewehrprojektile

Charakter:

- klarer heißer Core,
- deutlich sichtbarer farbiger Wake,
- mittlere Wake-Instabilität,
- vereinzelte Motes.

Dieses Profil soll als visuelle Referenz für die neue normale ballistische Flight Signature dienen.

Zielgefühl:

> kraftvoll, heiß, physisch und dennoch präzise

---

### 8.4 Sustained Ballistic

Typischer Einsatz:

- Negev
- extrem hohe Feuerraten

Charakter:

- geringere visuelle Masse pro Projektil,
- kompakte Flight Signature,
- kurzer Nachlauf,
- etwas rauere bzw. aggressivere Auflösung,
- dekorative Elemente besonders sparsam.

Die hohe Projektilzahl erzeugt von selbst einen intensiven Geschossstrom.

Zielgefühl:

> chaotische Feuerkraft ohne visuelles Zuschmieren

---

### 8.5 Scatter

Typischer Einsatz:

- Shotgun
- Pellet-Projektile

Charakter:

- kurze, breitere Streaks,
- sehr kurzer Wake,
- kaum seitliche Wellenbewegung,
- kaum Motes.

Die einzelnen Pellets müssen als Streuung lesbar bleiben.

Zielgefühl:

> kurzer explosiver Projektilfächer

---

### 8.6 Sniper

Typischer Einsatz:

- AWP
- extrem schnelle, seltene Geschosse

Charakter:

- sehr langer, scharfer Core,
- hohe Core-Helligkeit,
- relativ schlanke Form,
- langer, aber schwacher Wake,
- langsameres visuelles Ausklingen,
- keine übermäßige Partikeldichte.

Zielgefühl:

> ein harter Schnitt durch die Szene

---

### 8.7 High Energy

Typischer Einsatz:

- Gauss
- vergleichbare Hochenergieprojektile

Charakter:

- stark aufgehellter Core,
- kräftiger farbiger Glow,
- etwas weichere und energetischere Auflösung,
- deutlicherer Wake als bei klassischer Ballistik.

Optional darf dieses Profil zusätzliche Pressure-/Energy-Wakes verwenden.

Zielgefühl:

> übernatürliche bzw. technisch extreme Energie

---

## 10. Pressure-/Mach-Wake für besondere Projektile

Sehr starke oder extrem schnelle Spezialprojektile dürfen einen zusätzlichen seitlichen Nachhall erzeugen.

Dieser Effekt ist **nicht Bestandteil normaler Ballistik**.

Geeignet sind beispielsweise:

- sehr starke Sniper-Schüsse,
- Gauss-artige Hochenergiegeschosse,
- explizit aufgeladene Spezialschüsse.

Der Effekt soll:

- direkt an die hohe Energie bzw. Geschwindigkeit gekoppelt wirken,
- seitlich aus der Flugbahn herauslaufen,
- sehr kurz leben,
- schwächer als der eigentliche Core bleiben,
- nicht bei normalen Gewehr- oder Maschinenwaffen auftreten.

---

## 11. Beleuchtung

Normale ballistische Projektile benötigen kein vollwertiges dynamisches Umgebungslicht.

Ihr Leuchteindruck entsteht primär aus:

- Projektilkopf,
- Core,
- Glow,
- Wake.

Echtes Umgebungslicht bleibt besonderen Projektiltypen vorbehalten, bei denen Eigenleuchten ein wesentlicher Teil ihrer Identität ist.

Geeignete Beispiele:

- Energieprojektile,
- Gauss/Hochenergie,
- BFG-artige Projektile,
- Raketenantrieb,
- andere eindeutig selbstleuchtende Spezialgeschosse.

### Ziel

Licht soll Besonderheit und Energie unterstützen, nicht jede normale Kugel zu einer mobilen Lichtquelle machen.

---

## 12. Gemeinsamer technischer Unterbau für Projectile-Trails

Die Flight-Signature-Überarbeitung soll nicht als isolierte Sonderlösung für ballistische Tracer entstehen.

Fragdachse besitzt mehrere fachlich unterschiedliche, aber strukturell verwandte projektilgebundene Nachläufe, beispielsweise:

- ballistische Licht-/Tracer-Spuren,
- Raketenrauch,
- Raketenabgas,
- brennende Projectile-Trails,
- zukünftige Energie-, Plasma- oder ähnliche Wakes.

Für diese Effekte gilt folgende Architekturanforderung:

> **Gemeinsame Pfad- und Lifetime-Mechanik soll technisch wiederverwendbar sein; visuelle Semantik und Art Direction bleiben getrennt.**

### 12.1 Was gemeinsam behandelt werden soll

Ein gemeinsamer Unterbau soll dort bevorzugt werden, wo mehrere Trail-Arten dieselbe fachlich neutrale Information benötigen:

- vorherige und aktuelle Projektilposition,
- tatsächlich zurückgelegtes Bewegungssegment,
- lokale Bewegungsrichtung entlang dieses Segments,
- zeit- und/oder streckenbasierte Trail-Abtastung,
- gleichmäßige Verteilung von Trail-Material entlang größerer Bewegungsschritte,
- Begrenzung der Trail-Dichte bei Frame-Hitches oder sehr hoher Projektilzahl,
- sauberes Ausklingen bereits erzeugter Trail-Anteile nach Despawn, Bounce oder Richtungsänderung,
- Qualitätsreduktion ohne Verlust der eigentlichen Flugbahnlesbarkeit.

### 12.2 Was ausdrücklich getrennt bleiben soll

Der gemeinsame Unterbau darf nicht dazu führen, fachlich unterschiedliche Trail-Arten in ein universelles Erscheinungsbild zu pressen.

Getrennt bleiben insbesondere:

- Form und Textur,
- Farbe und Farbtemperatur,
- Helligkeitscharakter,
- Rauch-, Feuer-, Licht- oder Energieverhalten,
- Lebensdauercharakter,
- Drift- und Auflösungsverhalten,
- visuelle Hierarchie,
- Waffen- und Projektilidentität.

Raketenrauch soll weiterhin wie Rauch wirken, ein ballistischer Tracer wie Licht/Energie und ein brennender Trail wie Feuer.

### 12.3 Zwei unterschiedliche Trail-Grundarten

Fachlich sind mindestens zwei unterschiedliche technische Trail-Bedarfe zu berücksichtigen:

**Pfadgebundener Trail**

Material bildet den tatsächlich zurückgelegten Weg ab.

Geeignet für:

- ballistische Tracer,
- Raketenrauch,
- brennende Projectile-Trails,
- Energie-/Plasma-Wakes.

**Kontinuierliche Quellenemission**

Eine aktive Quelle produziert fortlaufend Material an ihrer aktuellen Position.

Geeignet für:

- Triebwerksabgas,
- vergleichbare dauerhaft aktive Emissionsquellen.

Beide können denselben GPU-/Effekt-Unterbau nutzen, sollen aber nicht zwangsläufig dieselbe Sampling-Logik besitzen.

### 12.4 Keine Mega-Abstraktion

Nicht Ziel des GDD ist ein universeller „Projectile Trail“, der Rauch, Feuer, Tracer, Abgas und Energie über eine große Anzahl optionaler Sonderparameter zusammenfasst.

Der gemeinsame Unterbau soll klein und neutral bleiben.

> **Gemeinsame Mathematik und Lifecycle-Mechanik, getrennte Art Direction.**

---

## 14. Skalierbarkeit und Qualitätsstufen

Die Flight Signature muss auch bei sehr vielen gleichzeitig sichtbaren Projektilen funktionieren.

Dafür gilt eine feste visuelle Priorität.

### Essential

Bleibt immer erhalten:

- Projektilkopf,
- klar lesbarer Core,
- grundlegender Farb- und Fade-Verlauf.

### Standard

Darf bei reduzierter Qualität vereinfacht werden:

- Länge und Dichte des Wake,
- Stärke der seitlichen Instabilität,
- Detailgrad der Auflösung.

### Decorative

Darf zuerst reduziert oder vollständig entfernt werden:

- Motes,
- kleine Fragmente,
- zusätzliche Pressure-/Energy-Details.

### Grundregel

> Grafikqualität reduziert zuerst Detail, nicht Combat-Lesbarkeit.

---

## 14. Tuning-Modell

Das System soll bewusst nur wenige zentrale, leicht verständliche Tuning-Punkte besitzen.

Die wichtigsten Parameter müssen ohne Wissen über die technische Umsetzung verständlich sein.

### Nicht tweakbare Invarianten

Folgende Punkte sind keine Artist-Regler und dürfen durch Tuning nicht aufgeweicht werden:

- **Path Fidelity:** Der Core folgt dem tatsächlich zurückgelegten Projektilpfad.
- **Local Direction Fidelity:** Trail-Segmente orientieren sich an ihrer damaligen lokalen Bewegungsrichtung.
- **Homing Fidelity:** Gekrümmte Flugbahnen werden nicht durch gerade Verbindungen abgekürzt.
- **Bounce Fidelity:** Richtungswechsel bleiben als tatsächliche Wegänderung erkennbar.
- **Hierarchy:** Core bleibt informationsstärker als Wake; Wake bleibt informationsstärker als Motes.

Diese Invarianten sichern Combat-Lesbarkeit. Die Tuning-Parameter verändern Stil und Intensität, nicht die dargestellte Gameplay-Wahrheit.

---

### 12.1 Primäre Tuning-Parameter

| Parameter | Bedeutung | Mehr davon bewirkt | Risiko bei zu hohem Wert |
|---|---|---|---|
| **Core Intensity** | Helligkeit des klaren Flugbahnkerns | stärkere Sichtbarkeit und mehr Energie | Überstrahlung, Verlust von Farbinformation |
| **Core Width** | visuelle Breite des scharfen Kerns | mehr Gewicht und Durchsetzung | Laser-/Beam-Eindruck, verdeckte Ziele |
| **Core Length** | Länge des präzisen heißen Bereichs | stärkere Geschwindigkeitswirkung | zu dominante Linien, visuelle Unruhe |
| **Wake Persistence** | wie lange der Nachhall sichtbar bleibt | stärkerer Bewegungseindruck und schönere Flugspur | Bild bleibt zu lange voll |
| **Wake Spread** | maximale seitliche Ausdehnung des alten Nachlaufs | organischere, lebendigere Spur | tatsächliche Flugbahn wirkt unklar |
| **Heat Contrast** | Unterschied zwischen weiß-heißem jungen Core und farbigem alten Wake | stärkere Energie- und Temperaturwirkung | Core wird weiß ausgewaschen oder Tail wirkt farblos |

Diese sechs Parameter bilden die wichtigsten Artist-/Designer-Regler.

---

### 12.2 Sekundäre Tuning-Parameter

| Parameter | Bedeutung | Mehr davon bewirkt | Risiko bei zu hohem Wert |
|---|---|---|---|
| **Wake Turbulence** | Stärke der Unruhe/Wellenbewegung innerhalb des erlaubten Wake Spread | lebendigere Auflösung | nervöses, spaghettiartiges Bild |
| **Mote Amount** | Menge kleiner Fragmente im Nachlauf | mehr Detail und Juice | Partikelrauschen und schlechtere Lesbarkeit |
| **Speed Response** | wie stark sich sichtbare Länge/Schärfe mit Projektilgeschwindigkeit verändert | deutlichere Speed-Unterschiede | Profile verlieren ihren eigenen Charakter |

Sekundäre Parameter sollen deutlich seltener angepasst werden als die primären.

---

## 15. Empfohlene Tuning-Reihenfolge

Um schnell zu einem sauberen Ergebnis zu gelangen, sollen Änderungen in folgender Reihenfolge vorgenommen werden.

### Schritt 1 – Lesbarkeit

Zuerst einstellen:

1. Core Intensity
2. Core Width
3. Core Length

Ziel:

> Der Schuss muss auf hellem und dunklem Boden klar sichtbar sein, ohne wie ein Laserstrahl zu wirken.

---

### Schritt 2 – Bewegung und Juice

Danach:

4. Wake Persistence
5. Wake Spread
6. Wake Turbulence

Ziel:

> Die Spur soll sichtbar leben und altern, ohne die reale Flugbahn zu verschleiern.

---

### Schritt 3 – Farbwirkung

Danach:

7. Heat Contrast

Ziel:

> Junger Trail liest sich heiß und energetisch, alter Trail trägt klar die Waffenidentität.

---

### Schritt 4 – Dekoration

Zuletzt:

8. Mote Amount
9. Speed Response

Ziel:

> Zusätzlicher Juice, ohne die bereits saubere Grundform wieder zu überladen.

---

## 16. Tuning-Leitplanken

### 14.1 Core

Ein guter Core:

- ist sofort sichtbar,
- wirkt heller als sein Wake,
- bleibt schmal,
- zeigt exakt die Flugrichtung,
- verdeckt Gegner und Hindernisse nur minimal.

Wenn der Spieler primär „Leuchtlinien“ statt Geschosse sieht, ist der Core zu dominant.

---

### 14.2 Wake

Ein guter Wake:

- ist klar schwächer als der Core,
- wird erst mit zunehmendem Alter unruhig,
- besitzt keine harte Endkante,
- löst sich sichtbar auf,
- bleibt nah genug an der realen Bahn, dass keine falsche Flugrichtung suggeriert wird.

Wenn alte Trails wie feste Laserlinien durch die Arena stehen, ist die Persistence zu hoch.

Wenn der Spieler die tatsächliche Bahn nicht mehr intuitiv erkennt, sind Spread oder Turbulence zu hoch.

---

### 14.3 Motes

Ein guter Mote-Anteil:

- fällt beim bewussten Hinsehen auf,
- wird während hektischer Kämpfe kaum als Einzelpartikel wahrgenommen,
- unterstützt den Eindruck eines zerfallenden Wake.

Wenn Motes bereits auf den ersten Blick dominieren, sind es zu viele.

---

### 14.4 Farbe

Ein gutes Temperaturverhalten:

- besitzt vorne einen sichtbar heißeren Anteil,
- erreicht schnell die charakteristische Waffenfarbe,
- endet nicht als weißer Nebel,
- bleibt auch auf hellem Untergrund farblich unterscheidbar.

---

## 17. Empfohlene Profilcharakteristik

Keine festen Zahlenwerte sind vorgeschrieben. Die Profile sollen relativ zueinander folgende Tendenzen besitzen.

| Profil | Core Intensity | Core Length | Wake Persistence | Wake Spread | Turbulence | Motes |
|---|---|---|---|---|---|---|
| Light Ballistic | mittel | kurz | kurz | sehr gering | gering | sehr gering |
| Automatic Ballistic | mittel | kurz–mittel | kurz | gering | gering | sehr gering |
| Heavy Ballistic | hoch | mittel | mittel | mittel | mittel | gering |
| Sustained Ballistic | mittel | kurz | kurz | gering | mittel | sehr gering |
| Scatter | mittel | sehr kurz | sehr kurz | sehr gering | sehr gering | sehr gering |
| Sniper | sehr hoch | sehr lang | lang | gering–mittel | gering | sehr gering |
| High Energy | sehr hoch | mittel–lang | mittel–lang | mittel | mittel | gering–mittel |

Diese Tabelle definiert den Charakter, nicht die konkrete technische Parametrisierung.

---

## 18. Tag-/Nacht-Lesbarkeit

Die Flight Signature muss sowohl in hellen als auch dunklen Szenen funktionieren.

### Tagsüber

- Core muss auf hellem Boden klar lesbar bleiben,
- Farbe darf nicht vollständig auswaschen,
- Wake muss sichtbar, aber deutlich schwächer bleiben.

### Nachts

- Core darf kräftig leuchten,
- Wake soll nicht zu einer großflächigen weißen Spur ausbrennen,
- Motes und Glow dürfen die Umgebung visuell unterstützen, aber nicht zum dominanten Bildelement werden.

### Grundregel

> Helligkeit wird für Lesbarkeit genutzt, nicht als Ersatz für Form und Farbe.

---

## 19. Multiplayer- und Bewegungslesbarkeit

Host und Clients sollen dieselbe fachliche Flight Signature wahrnehmen:

- gleiche Waffenidentität,
- gleiche Farbcharakteristik,
- gleiche ungefähre Trail-Länge und -Breite,
- gleiche Bounce-Lesbarkeit.

Kleine dekorative Unterschiede im Wake oder bei Motes sind unproblematisch, solange:

- Projektilposition,
- reale Flugrichtung,
- Bounce-Punkt,
- Impact-Punkt

nicht falsch suggeriert werden.

---

## 20. Expliziter Non-Scope

Nicht Bestandteil dieses GDD sind:

- Änderungen an Projectile Physics,
- Änderungen an Collision oder Hit Detection,
- Änderungen an Projectile Speed oder Range,
- Damage-/Balance-Anpassungen,
- neue Recoil-Mechaniken,
- neue Audio-Mechaniken,
- künstliche Änderung der tatsächlichen Flugbahn für visuelle Zwecke,
- Ghost-/Afterimage-Kopien des Projektilkopfs,
- periodisch oder zufällig hervorgehobene „Hero Bullets“,
- künstlich verstärkte „jeder n-te Schuss“-Tracer,
- vollwertiges dynamisches Licht für jede normale Kugel,
- eine komplett andere Flight Signature für jede einzelne Waffe,
- übermäßige Partikelmengen als primärer Juice-Hebel,
- ein universelles Mega-Trail-System, das Rauch, Feuer, Tracer und Abgas visuell oder fachlich vereinheitlicht.

---

## 21. Visuelle Abnahmekriterien

Die Überarbeitung gilt fachlich als erfolgreich, wenn folgende Punkte erfüllt sind.

### Einzelprojektil

- Flugrichtung ist sofort erkennbar.
- Projektil wirkt deutlich schneller und energiereicher als vorher.
- Core ist sichtbar heller und präziser als Wake.
- Wake entwickelt sich sichtbar von gerade/stabil zu weich/instabil.
- Trail endet ohne harte Kante.

### Automatisches Feuer

- P90/Negev erzeugen einen kraftvollen Geschossstrom.
- Einzeltracer verschmelzen nicht zu einer undurchsichtigen Lichtwand.
- Gegner und wichtige Spielobjekte bleiben gut lesbar.

### Shotgun

- Pellet-Fächer bleibt klar erkennbar.
- Kein Spaghetti-Effekt durch zu starken Wake.
- Der Schuss wirkt kurz und explosiv.

### Sniper / High Energy

- Projektil besitzt klar höhere visuelle Energie als normale Ballistik.
- AWP liest sich als harter schneller Schnitt.
- Hochenergieeffekte bleiben seltene visuelle Höhepunkte.

### Homing

- der Core folgt der tatsächlich geflogenen Kurve,
- die aktuelle lokale Bewegungsrichtung bleibt eindeutig,
- der Trail bildet keine direkte Abkürzung zwischen früherer und aktueller Position,
- der alternde Wake darf die reale Kurve leicht organisch verlassen, ohne eine falsche Flugbahn zu suggerieren,
- hohe Homing-Krümmung bleibt auch in schneller Bewegung sauber lesbar.

### Bounce

- alter Trail bleibt kurz sichtbar,
- neue Flugrichtung startet sauber,
- Bounce-Punkt ist eindeutig erkennbar,
- der sichtbare Knick erhöht die Befriedigung und Lesbarkeit.

### Tag

- normale Schüsse verschwinden nicht auf hellem Boden.
- keine großflächige Überstrahlung.

### Nacht

- Flight Signatures wirken leuchtend und hochwertig.
- hohe Feuerrate macht die Szene nicht zu einem weißen Effektteppich.

### Gemeinsamer Trail-Unterbau

- unterschiedliche Trail-Arten können dieselbe reale Flugbahn konsistent abbilden,
- Raketenrauch, Burn-Trails und Tracer behalten trotz gemeinsamem Unterbau klar getrennte visuelle Identitäten,
- Homing und Bounces benötigen keine projektiltypspezifische Sonderregel, um den realen Pfad korrekt darzustellen,
- Qualitätsreduktion reduziert zuerst dekorative Dichte und nicht Pfadtreue.

### Hohe Projektilzahl

- Core bleibt auch unter hoher Last die wichtigste Informationsschicht.
- reduzierte Detailstufen dürfen Motes/Wake vereinfachen, ohne die Bahnlesbarkeit zu verlieren.

---

## 22. Visuelle Referenzformel

Die gesamte Überarbeitung lässt sich auf folgende Designformel reduzieren:

> **Jung = heiß, scharf, gerade und schnell.**  
> **Alt = farbig, weich, instabil und verblassend.**

Für normale Ballistik gilt zusätzlich:

> **Präziser realer Pfad vorne, organischer Nachhall hinten.**

Und für die Gesamtwirkung eines Schusses:

> **Muzzle, Flight und Impact sind drei Phasen desselben visuellen Energieereignisses.**

Diese Regeln haben Vorrang vor zusätzlicher Effektmenge.
