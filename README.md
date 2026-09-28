# Generator raportów partnerskich z konferencji

Lokalna aplikacja (Vue 3 + Node/Fastify + SQLite) do tagowania zdjęć konferencyjnych i generowania raportów PPTX + PDF dla każdego partnera.

Wymaga **Node.js 22+** (wbudowany `node:sqlite`).

## Uruchomienie

```bash
./start.sh
```

- **Z Dockerem** (zalecane): buduje obraz z LibreOffice i serwuje aplikację na **http://localhost:3000** (nie używaj `http://0.0.0.0:3000` w przeglądarce).
- Jeśli port 3000 jest zajęty (np. stary `npm run dev`), `./start.sh` odmówi startu — zwolnij port albo `docker compose down`.
- **Bez Dockera**: `npm install && npm run dev` — frontend :5173, API :3000. PDF wymaga `soffice` (LibreOffice) w PATH; bez tego ZIP zawiera PPTX + `PDF_ERRORS.txt`.

## Flow

1. Nowy projekt → szablon PPTX, URL, statystyki  
2. Stopnie partnerstwa + firmy  
3. Upload zdjęć  
4. Tagowanie (kategoria, firmy/stopnie, pomiń)  
5. Generuj ZIP z raportami (`{firma}.pptx` + `{firma}.pdf`)
