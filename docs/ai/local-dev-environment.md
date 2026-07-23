# Lokale Entwicklungsumgebung und Browserprüfungen

Diese Seite beschreibt einen nicht offensichtlichen Vertrag: Ein Agent (Claude Code, Codex) und ein Mensch arbeiten regelmäßig **gleichzeitig** an diesem Repository, jeder mit einem eigenen Vite-Dev-Server und einem eigenen Browser. Ohne saubere Trennung scheitern Agenten-Browserprüfungen reproduzierbar.

## Portvertrag

| Port | Besitzer | Start | Bindung |
|---|---|---|---|
| 8080 | Mensch (VS Code, manuelles Testen in Chrome) | `npm run dev` | Vite-Default-Host `localhost` |
| 8090 | Agent (automatisierte Browserprüfung) | `npm run dev:browser` | explizit `127.0.0.1`, `--strictPort` |

`vite.config.ts` setzt `server.port: 8080` für den Menschen. `dev:browser` überschreibt Host und Port bewusst per CLI und behält `--strictPort`, damit ein Portkonflikt laut scheitert statt still auf einen fremden Server auszuweichen. `.claude/launch.json` muss denselben Port wie `dev:browser` führen; laufen die beiden auseinander, startet die Preview-Integration einen Server und öffnet eine andere Adresse.

Regeln für Agenten:

- Immer `http://127.0.0.1:8090/` verwenden, niemals `localhost`.
- Einen fremden Prozess auf 8080 **nicht** beenden. Ein belegter Port 8080 ist der Normalfall, kein Fehler.
- Keinen Port aus der Vite-Fallback-Kette 8080–8082 als Ausweichport wählen; 8090 liegt bewusst außerhalb.

## Warum getrennte Ports nötig sind

Drei Effekte greifen ineinander und sind einzeln jeweils unauffällig.

**Vite bindet `localhost` nur an eine Adressfamilie.** `npm run dev` nutzt den Vite-Default-Host `localhost`. Unter Windows löst das zu `::1` und `127.0.0.1` auf, Vite bindet aber nur die erste Adresse. Praktisch lauscht der Server dann ausschließlich auf `[::1]:8080`, während `127.0.0.1:8080` frei und nicht erreichbar bleibt. Ein Agent, der vertragsgemäß `127.0.0.1` anspricht, bekommt „connection refused“ und deutet das fälschlich als kaputte Anwendung.

**Werkzeuge prüfen Portbelegung adressfamilien-unabhängig.** Die Preview-Integration von Claude Code sieht einen fremden Prozess auf Port 8080 und bricht mit einem harten Fehler ab („Port 8080 is in use … not a preview server“), obwohl `127.0.0.1:8080` tatsächlich frei wäre. Andere Werkzeuge nehmen umgekehrt an, der Server laufe bereits, und öffnen die tote `127.0.0.1`-Adresse. Beide Ausgänge sehen für den Agenten wie ein Fehlschlag der Prüfung aus, nicht wie ein Umgebungsproblem — deshalb wiederholt sich das Muster.

**Zwei Server auf demselben Projektverzeichnis stören sich gegenseitig.** Beide beobachten dieselben Dateien: Eine Agenten-Änderung löst ein HMR-Update im Chrome-Tab des Menschen aus und umgekehrt, mitten in einer manuellen Prüfung. Zusätzlich teilen sich beide Server den Dependency-Optimizer-Cache `node_modules/.vite/deps`. Solange Lockfile, Vite-Config und Hashes identisch sind, ist das unkritisch; ändert sich eines davon, schreibt der zweite Server den Cache neu und der bereits geladene Tab des anderen läuft in „Outdated Optimize Dep“-Fehler (HTTP 504) oder fehlschlagende dynamische Importe. Getrennte Ports beheben das nicht, machen aber eindeutig, welcher Server welche Seite ausliefert.

Getrennte Ports lösen zugleich das Adressfamilienproblem: Weil sich Mensch und Agent keinen Port mehr teilen, ist es unerheblich, ob `localhost` auf einem Rechner zuerst zu `::1` oder zu `127.0.0.1` auflöst.

## Symptome und Zuordnung

| Symptom im Agentenlauf | Ursache |
|---|---|
| `Port 8090 is in use … not a preview server` | Verwaister `dev:browser` aus einem früheren Lauf; Prozess beenden, nicht ausweichen |
| Verbindung auf `127.0.0.1` abgelehnt, obwohl ein Server läuft | Fremder Server auf demselben Port, nur an `::1` gebunden |
| Seite lädt, zeigt aber fremden Zustand oder fremde HMR-Reloads | Über `localhost` statt `127.0.0.1` verbunden, dadurch auf dem Server des Menschen gelandet |
| HTTP 504 „Outdated Optimize Dep“ nach dem Start des zweiten Servers | Geteilter `node_modules/.vite/deps`-Cache neu geschrieben; betroffenen Tab neu laden |

## Mehrspielerprüfungen

Beide Tabs einer Agenten-Mehrspielerprüfung müssen vom **selben** Server stammen, also beide von `127.0.0.1:8090`, der zweite über die `#r=`-URL des ersten. Ein Tab vom Menschen-Server und einer vom Agenten-Server ergeben zwar eine funktionierende WebRTC-Verbindung über den PeerJS-Broker, testen aber zwei verschieden gebaute Anwendungsstände, sobald einer der beiden Server neuere Quellen ausliefert.

## Verborgener Browser-Pane: keine Frames, kein Screenshot, keine Sichtprüfung

Ein zweites, davon unabhängiges Fehlerbild betrifft die visuelle Prüfung selbst. Der In-App-Browser-Pane von Claude Code **rendert nur, solange er tatsächlich angezeigt wird**. Ist der Pane verborgen — der Mensch schaut auf den Chat, auf VS Code oder eine andere App —, dann ist die Seite aus Chromium-Sicht `hidden`, und drei Dinge treten gemeinsam auf. Verifiziert am laufenden Spiel:

- `document.visibilityState === 'hidden'`, `document.hidden === true`.
- **`requestAnimationFrame` feuert nicht mehr.** Damit steht die komplette Phaser-Game-Loop still; es wird kein einziger Frame weitergerechnet oder gerendert. Ein sichtbares Ergebnis kann also gar nicht erst entstehen.
- Der Pane kompositiert keine Frames, deshalb läuft `computer{action:"screenshot"}` nach 5 s in den Timeout: „the Browser pane is not displayed, so the page is not compositing frames".

Es gibt **keinen** Pixel-Umweg. `canvas.toDataURL()` liefert zwar Daten, aber bei Phasers WebGL-Kontext ohne `preserveDrawingBuffer` und bei eingefrorener Loop ist der Puffer eine einfarbige Fläche (gemessen: eine einzige Farbe über den ganzen Canvas). Ein Auslesen der Canvas-Pixel beweist also nichts über das gerenderte Bild.

Was **weiterhin** funktioniert, weil es DOM-/JS-Zustand statt Frames liest: `javascript_tool`, `read_page`, `get_page_text`, `read_console_messages`, `read_network_requests`. Für Fragdachse ist das aber nur begrenzt hilfreich, denn das gesamte Spiel lebt in **einem** `<canvas>`; der Accessibility-Baum enthält keine Gegner, keinen Boden, keine Effekte. Konsolen- und Netzwerkfehler lassen sich damit prüfen, das gerenderte Bild nicht.

Konsequenzen für Agenten:

- Jede **Sichtprüfung** (Boden, Sprites, Effekte, Kamera-Feedback) setzt einen **angezeigten und fokussierten** Browser-Pane voraus. Fehlt der Screenshot mit obiger Meldung, ist der Pane verborgen — das ist ein Umgebungszustand, kein Anwendungsfehler.
- In diesem Fall die Sichtprüfung **nicht als bestanden melden** und kein Ergebnis erfinden. Stattdessen knapp berichten, dass visuell nicht verifiziert werden konnte, und auf das ausweichen, was ohne Frames belegbar ist: Konsolenfehler, Netzwerk, `read_page`, sowie Code-Argumentation.
- Wenn der Screenshot der einzige verbleibende Schritt ist, kann der Mensch gebeten werden, den Browser-Pane sichtbar zu lassen; der Pane-Sichtbarkeit ist über die App-Oberfläche gesteuert, nicht aus dem Repo oder per Skript schaltbar.
