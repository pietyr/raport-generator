# Generator raportów partnerskich z konferencji

Lokalna aplikacja do tagowania zdjęć konferencyjnych i generowania raportów PPTX + PDF dla każdego partnera.
Stack:  Vue 3 + Node + SQLite

Wymagania **Node.js 22+**, **Docker**.

## Uruchomienie

```bash
./start.sh
```

- **Z Dockerem**: buduje obraz z LibreOffice i serwuje aplikację na **http://localhost:3000**.

## Flow

1. Nowy projekt → szablon PPTX, URL wydarzenia, statystyki uczestników  
2. Definicje stopni partnerstwa i dodanie im firm  
3. Upload zdjęć
4. Tagowanie - kategoria, firmy/stopnie, pomninięcie  
5. Generowanie ZIP z raportami (`{firma}.pptx` + `{firma}.pdf`)
