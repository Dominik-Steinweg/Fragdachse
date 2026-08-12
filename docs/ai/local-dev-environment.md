# Lokale Entwicklungsumgebung

## Standard

Browser- und Sichtprüfung ist opt-in. Ohne ausdrückliche Aufforderung keinen Dev-Server starten, keinen Browser öffnen und keinen Screenshot versuchen. Für Dokumentations-/Codeprüfung reichen die proportionalen Repository-Checks.

## Ports

| Port | Verwendung | Start |
|---|---|---|
| 8080 | Mensch/normaler Vite-Server | npm run dev |
| 8090 | Agenten-Browserprüfung | npm run dev:browser |

Für eine verlangte Agentenprüfung immer http://127.0.0.1:8090/ verwenden. dev:browser setzt Host, Port und --strictPort; bei belegtem 8090 nicht auf einen anderen Server ausweichen. Einen fremden Prozess auf Port 8080 niemals beenden.

Mehrere Prüf-Tabs müssen vom selben 8090-Server stammen; den zweiten Tab über den #r=-Raumlink des ersten öffnen. So testen beide dieselbe Build- und HMR-Version.

## Sichtprüfung

Nur nach ausdrücklicher Aufforderung npm run dev:browser starten und erst nach HTTP 200 laden. Wenn der In-App-Browser-Pane verborgen ist und keine Frames/Screenshot entstehen, ist das ein Umgebungszustand: nicht als bestandene Sichtprüfung melden, nicht wiederholt neu starten, sondern Konsole/Netzwerk/Codeargumentation prüfen und die visuelle Prüfung offen als nicht verifiziert ausweisen.
