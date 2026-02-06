# FrenchStream - Addon Stremio / Home Assistant

Addon Stremio qui agrège les liens de streaming depuis FrenchStream (films et séries).

## Fonctionnalités

- **Catalogue** : parcours paginé des films et séries disponibles sur FrenchStream
- **Recherche** : recherche par titre directement depuis Stremio
- **Streams** : extraction automatique des liens de lecture (FSvid, Vidzy, Uqload, Voe, Dood, Filmoon)
- **Langues** : VF, VOSTFR, VFF, VFQ, VO
- **Métadonnées TMDB** : titre, synopsis, affiche, casting dans la langue de votre choix (14 langues)
- **Résolution IMDB** : via TMDB API avec fallback Cinemeta
- **URL dynamique** : résolution automatique du domaine courant de FrenchStream via fstream.info

## Prérequis

- Node.js >= 18 (testé avec v22)
- npm

## Installation

```bash
git clone https://github.com/djodjo02130/frenchstream.git
cd frenchstream
npm install
```

## Utilisation

```bash
npm start
```

L'addon démarre sur le port **7000** par défaut (configurable via `PORT`).

```bash
PORT=8080 npm start
```

Ajouter l'addon dans Stremio :

```
http://<IP>:7000/manifest.json
```

## Docker

### Build et lancement

```bash
docker build -t frenchstream .
docker run -d -p 7000:7000 --name frenchstream frenchstream
```

### Docker Compose

```yaml
services:
  frenchstream:
    build: .
    container_name: frenchstream
    ports:
      - "7000:7000"
    restart: unless-stopped
```

## Home Assistant

Ce projet est compatible comme addon Home Assistant.

### Installation

[![Ajouter le dépôt à Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fdjodjo02130%2Ffrenchstream)

Ou manuellement :

1. Dans Home Assistant, aller dans **Paramètres > Modules complémentaires > Boutique des modules complémentaires**
2. Menu **⋮** > **Dépôts** > ajouter `https://github.com/djodjo02130/frenchstream`
3. Rafraîchir, puis installer **FrenchStream**

L'addon expose le port 7000. Ajouter dans Stremio :

```
http://<IP_HOME_ASSISTANT>:7000/manifest.json
```

### Configuration

| Option | Description |
|---|---|
| `tmdb_api_key` | Clé API TMDB (optionnelle) — métadonnées en français |

## Structure du projet

```
frenchstream/
├── index.js                # Point d'entrée, handlers catalog + meta + stream
├── lib/
│   ├── scraper.js          # APIs JSON FS (films, séries, catalogue, recherche)
│   ├── resolvers.js        # Résolution embed → URL directe (6 players)
│   ├── utils.js            # Résolution URL dynamique, helpers
│   └── cache.js            # Cache TTL en mémoire
├── test/
│   └── smoke.js            # Smoke test (scraper + resolvers + video loading)
├── rootfs/                 # Scripts s6-overlay (Home Assistant)
│   └── etc/services.d/frenchstream/
├── translations/           # Traductions options HA (en, fr)
├── .github/workflows/      # CI/CD (build GHCR, smoke test, CodeQL)
├── Dockerfile
├── build.yaml              # Images de base HA par architecture
├── config.yaml             # Addon Home Assistant
├── repository.yaml         # Dépôt Home Assistant
├── DOCS.md                 # Documentation HA
├── CHANGELOG.md
└── package.json
```

## Architecture

```
Stremio  →  Addon (port 7000)  →  fstream.info (résolution URL)
                                →  FrenchStream APIs JSON (streams)
                                →  TMDB API (métadonnées, résolution IMDB)
                                →  Cinemeta (fallback IMDB → titre)
```

- **APIs JSON** : les streams sont récupérés via `film_api.php` et `episodes_nop_api.php` (plus de scraping HTML pour les players)
- **6 resolvers** : FSvid, Vidzy, Uqload, Voe, Dood, Filmoon — résolution embed → URL directe (HLS/MP4)
- **Cache mémoire** avec TTL par namespace (recherche 15min, catalogue 30min, streams 2h, TMDB 24h)
- **URL dynamique** : le domaine FrenchStream change régulièrement, résolu automatiquement depuis fstream.info (cache 1h)
- **CI/CD** : build multi-arch (amd64, aarch64, armv7) + push GHCR + smoke test quotidien + CodeQL

## Licence

MIT
