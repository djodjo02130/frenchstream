# Changelog

## 1.0.1

- Fix: ajout du support s6-overlay pour Home Assistant (service dans `/etc/services.d/`)
- Fix: installation automatique de Node.js si absent de l'image de base
- Fix: remplacement de `--only=production` par `--omit=dev` (npm moderne)
- Fix: correction de l'URL du dépôt GitHub dans le badge HA

## 1.0.0

- Version initiale
- Catalogue films et séries avec pagination
- Recherche par titre
- Extraction des streams multi-players (Vidzy, Uqload, Voe, Dood, Filmoon, Netu, FSvid)
- Support multi-langues (VF, VOSTFR, VFF, VFQ)
- Résolution IMDB via Cinemeta
- URL dynamique FrenchStream via fstream.info
- Support Docker standalone et Home Assistant addon
