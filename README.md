# Neon Snake Arena

Eine responsive Snake-Web-App für Cloudflare Workers mit:

- Solo-Modus mit Highscore, Tempo- und Wandoptionen
- Online-Duell für zwei Geräte über WebSockets
- autoritativem Cloudflare-Durable-Object-Spielserver
- größerer Multiplayer-Arena mit 48 × 28 Feldern
- optimiertem Hoch- und Querformat, inklusive iPhone-Safe-Areas
- Swipe-, Tastatur- und optionaler Bildschirmsteuerung
- sechs prozedural gezeichneten Kreaturen-Skins
- vier Themes und frei wählbarer Akzentfarbe
- prozeduralen Web-Audio-Sounds ohne externe Audiodateien
- Partikeln, Glow, Bildschirmimpulsen und reduzierter Bewegung
- PWA-Manifest und Offline-App-Shell

## Projekt starten

Voraussetzungen: Node.js und ein Cloudflare-Konto.

```bash
npm run dev
```

Wrangler öffnet eine lokale Entwicklungsadresse. Für einen echten Test auf zwei Geräten muss die Entwicklungsadresse für beide Geräte erreichbar sein oder die App vorübergehend deployed werden.

## Auf Cloudflare deployen

```bash
npx wrangler@latest login
npm run deploy
```

Die Datei `wrangler.jsonc` enthält bereits:

- das Static-Assets-Binding für den Ordner `public`
- das Durable-Object-Binding `SNAKE_ROOMS`
- den SQLite-basierten Export `SnakeRoom`

Nach dem Deploy zeigt Wrangler die öffentliche `workers.dev`-Adresse an. Beide Spieler öffnen dieselbe Adresse, einer erstellt einen Raum und teilt den sechsstelligen Code.

## Tests

```bash
npm run check
```

Damit werden JavaScript-Syntax und die wichtigsten Regeln der serverseitigen Spiellogik geprüft.

## iPhone 12 Pro Max

Die Oberfläche berücksichtigt `env(safe-area-inset-*)`, nutzt `100dvh`, deaktiviert Browser-Gesten nur direkt auf dem Spielfeld und hält die gesamte Karte sichtbar. Im Querformat wird die Arena neben dem HUD maximal groß dargestellt. Im Hochformat bleibt sie vollständig sichtbar und der Online-Modus zeigt einen optionalen Drehhinweis.

## Wichtiger Architekturhinweis

Der Zwei-Spieler-Modus ist nicht Peer-to-Peer. Beide Geräte senden nur ihre Richtungswünsche. Das Durable Object verwaltet den gemeinsamen Zustand, bewegt beide Schlangen, verteilt Futter und berechnet Wand-, Körper- und Kopf-an-Kopf-Kollisionen. Dadurch sehen beide Spieler denselben verbindlichen Spielstand.
