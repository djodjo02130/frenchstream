# FrenchStream - Addon Stremio / Home Assistant

Addon Stremio qui agrège les liens de streaming depuis FrenchStream (films et séries).

## Fonctionnalités

- **Catalogue** : parcours paginé des films et séries disponibles sur FrenchStream
- **Recherche** : recherche par titre directement depuis Stremio
- **Streams** : extraction automatique des liens de lecture (Vidzy, Uqload, Voe, Dood, Filmoon, Netu, FSvid)
- **Langues** : VF, VOSTFR, VFF, VFQ
- **IMDB** : résolution des IDs IMDB via Cinemeta pour matcher les fiches Stremio
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

### Fichiers HA

| Fichier | Rôle |
|---|---|
| `config.yaml` | Métadonnées de l'addon (nom, ports, architectures) |
| `repository.yaml` | Déclaration du dépôt pour la découverte HA |
| `Dockerfile` | Image dual-purpose (standalone + HA via `BUILD_FROM`) |

## Structure du projet

```
frenchstream/
├── index.js            # Point d'entrée, handlers catalog + stream
├── lib/
│   ├── scraper.js      # Scraping des pages FS (catalogue, films, séries, recherche)
│   ├── utils.js        # Résolution URL dynamique, helpers
│   └── cache.js        # Cache TTL en mémoire
├── Dockerfile
├── .dockerignore
├── config.yaml         # Addon Home Assistant
├── repository.yaml     # Dépôt Home Assistant
├── package.json
└── package-lock.json
```

## Architecture

```
Stremio  →  Addon (port 7000)  →  fstream.info (résolution URL)
                                →  FrenchStream (scraping HTML)
                                →  Cinemeta (IMDB → titre)
```

- **Pas d'exécution JS côté client** : toutes les données (players, épisodes) sont extraites du HTML statique via Cheerio
- **Cache mémoire** avec TTL par namespace (recherche 15min, catalogue 30min, streams 2h, cinemeta 24h)
- **URL dynamique** : le domaine FrenchStream change régulièrement, l'addon le résout automatiquement depuis fstream.info (cache 1h)

## Licence

MIT
