# FrenchStream Stremio Addon

Addon Stremio pour regarder des films et séries depuis FrenchStream.

## Installation dans Stremio

1. Démarrez l'addon depuis Home Assistant
2. Ouvrez Stremio et allez dans **Addons**
3. Ajoutez l'URL : `http://<IP_HOME_ASSISTANT>:7000/manifest.json`

## Configuration

### Clé API TMDB (optionnelle)

Permet d'afficher les métadonnées (titre, synopsis, affiche) dans la langue
de votre choix via l'API TMDB.

1. Créez un compte sur [themoviedb.org](https://www.themoviedb.org/)
2. Allez dans **Paramètres > API** et copiez votre clé
3. Collez-la dans la configuration de l'addon

Sans clé TMDB, l'addon utilise Cinemeta comme fallback.

## Fonctionnalités

- Catalogue films et séries avec pagination
- Recherche par titre
- Multi-players : FSvid, Vidzy, Uqload, Voe, Dood, Filmoon
- Multi-langues : VF, VOSTFR, VFQ, VFF, VO
- Résolution automatique des streams (liens directs HLS/MP4)
- URL dynamique FrenchStream (mise à jour automatique)
