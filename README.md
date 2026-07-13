# Bot House v2

Bot Discord pour la Maison (tickets, boutique, crédits, missions, niveaux, budget, etc.).

## Prérequis

- Node.js 18+
- Token bot Discord ([Portail développeur](https://discord.com/developers/applications))

## Test en local

```bash
npm install
cp .env.example .env
# Éditez .env et mettez DISCORD_TOKEN=...
npm start
```

## Déploiement Railway + GitHub

Repo : [intelx60-max/bot-house-v2](https://github.com/intelx60-max/bot-house-v2)

### 1. Publier le code sur GitHub

```bash
cd "Bot House v2"
git init
git add .
git commit -m "Initial commit — Bot House v2"
git branch -M main
git remote add origin https://github.com/intelx60-max/bot-house-v2.git
git push -u origin main
```

### 2. Créer le projet Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Autorisez GitHub et choisissez **bot-house-v2**
3. Onglet **Variables** → ajoutez :
   - `DISCORD_TOKEN` = token du bot (copier depuis le portail Discord)
4. **Deploy** : Railway exécute `npm install` puis `npm start`

Le bot reste en ligne tant que le service Railway tourne.

### 3. Données persistantes (recommandé)

Les fichiers `*-state.json` (boutique, crédits, niveaux…) sont sur le disque du conteneur. Sans volume, un **redéploiement** peut les réinitialiser.

Sur Railway : **Service** → **Volumes** → monter un volume sur `/app` (ou le répertoire racine du projet) pour conserver les états.

### 4. Sécurité du token

- Ne commitez **jamais** le token dans GitHub
- Si un ancien token a été exposé, **régénérez-le** sur le portail Discord (Bot → Reset Token) puis mettez à jour `DISCORD_TOKEN` sur Railway

## Variables d'environnement

| Variable         | Obligatoire | Description      |
|------------------|-------------|------------------|
| `DISCORD_TOKEN`  | Oui         | Token du bot     |
