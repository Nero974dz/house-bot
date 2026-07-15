const fs = require("fs");
const path = require("path");

/**
 * Persistance sans volume Railway : les fichiers d'état sont sauvegardés
 * dans un dépôt GitHub via son API Contents. Le disque du conteneur est
 * éphémère (perdu à chaque redémarrage/redéploiement), donc on retélécharge
 * les fichiers depuis GitHub au démarrage, et on les repousse après chaque
 * écriture locale.
 *
 * Variables d'environnement nécessaires (à définir sur Railway) :
 * - GITHUB_TOKEN : token d'accès personnel avec permission "Contents: Read & Write"
 * - GITHUB_REPO  : "utilisateur/nom-du-repo" (ex: "Azk/house-bot-main")
 * - GITHUB_BRANCH (optionnel, défaut "main")
 *
 * Si ces variables ne sont pas définies, le bot fonctionne comme avant
 * (fichiers locaux uniquement, perdus au redémarrage).
 */

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_STATE_DIR = "bot-state";

const GITHUB_ENABLED = Boolean(GITHUB_TOKEN && GITHUB_REPO);

function getStatePath(filename) {
  return path.join(DATA_DIR, filename);
}

function githubUrl(filename) {
  return `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_STATE_DIR}/${filename}`;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "house-bot",
  };
}

async function pullStateFile(filename) {
  if (!GITHUB_ENABLED) return;
  try {
    const res = await fetch(`${githubUrl(filename)}?ref=${GITHUB_BRANCH}`, {
      headers: githubHeaders(),
    });
    if (!res.ok) return; // 404 = pas encore de sauvegarde sur GitHub, on garde le défaut local
    const json = await res.json();
    const content = Buffer.from(json.content, "base64").toString("utf8");
    fs.writeFileSync(getStatePath(filename), content);
  } catch (err) {
    console.warn(`Sync GitHub (pull ${filename}):`, err.message);
  }
}

async function pullAllStateFiles(filenames) {
  for (const filename of filenames) {
    await pullStateFile(filename);
  }
}

async function pushStateFile(filename) {
  if (!GITHUB_ENABLED) return;
  try {
    const filePath = getStatePath(filename);
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf8");
    const contentB64 = Buffer.from(content, "utf8").toString("base64");

    let sha;
    const existing = await fetch(`${githubUrl(filename)}?ref=${GITHUB_BRANCH}`, {
      headers: githubHeaders(),
    });
    if (existing.ok) {
      sha = (await existing.json()).sha;
    }

    await fetch(githubUrl(filename), {
      method: "PUT",
      headers: githubHeaders(),
      body: JSON.stringify({
        message: `sync: ${filename}`,
        content: contentB64,
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
  } catch (err) {
    console.warn(`Sync GitHub (push ${filename}):`, err.message);
  }
}

/** À appeler juste après fs.writeFileSync dans chaque saveState(). Fire-and-forget. */
function persistState(filename) {
  pushStateFile(filename).catch(() => {});
}

module.exports = {
  getStatePath,
  persistState,
  pullAllStateFiles,
  GITHUB_ENABLED,
};
