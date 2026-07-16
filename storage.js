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
const GITHUB_STATE_DIR = "bot-state";

// Branche effective : détectée automatiquement au démarrage (defaut du repo),
// sinon celle forcée par GITHUB_BRANCH, sinon "main".
let GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

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
    if (res.status === 404) return; // pas encore de sauvegarde, on garde le défaut local
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `⚠️ Sync GitHub (pull ${filename}) a échoué — HTTP ${res.status} : ${body.slice(0, 200)}`
      );
      return;
    }
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

  const res = await fetch(githubUrl(filename), {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify({
      message: `sync: ${filename}`,
      content: contentB64,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} : ${body.slice(0, 300)}`);
  }
}

/**
 * Diagnostic au démarrage :
 * 1. Vérifie que le token peut LIRE le dépôt (GET /repos/OWNER/REPO).
 * 2. Détecte automatiquement la branche par défaut du dépôt.
 * 3. Teste l'ÉCRITURE d'un fichier témoin.
 * Logge clairement quel maillon échoue.
 */
async function testGithubWrite() {
  if (!GITHUB_ENABLED) {
    console.warn(
      "⚠️ GITHUB_TOKEN / GITHUB_REPO non définis : AUCUNE sauvegarde en ligne. Les données seront perdues à chaque redémarrage."
    );
    return;
  }

  // Étape 1 : lecture du dépôt + détection de la branche par défaut
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: githubHeaders(),
    });
    if (repoRes.status === 401) {
      console.error(
        "❌ GitHub : token INVALIDE (HTTP 401). Régénérez GITHUB_TOKEN et remettez-le dans Railway."
      );
      return;
    }
    if (repoRes.status === 404) {
      console.error(
        `❌ GitHub : le token ne peut pas accéder au dépôt "${GITHUB_REPO}" (HTTP 404).\n` +
          `➡️ Causes possibles : le token n'appartient pas au propriétaire du dépôt, ou n'est pas autorisé sur CE dépôt.\n` +
          `➡️ Régénérez un Fine-grained token sur le compte propriétaire, "Only select repositories" → house-bot-main, "Contents: Read and write".`
      );
      return;
    }
    if (!repoRes.ok) {
      const body = await repoRes.text().catch(() => "");
      console.error(`❌ GitHub : accès dépôt échoué HTTP ${repoRes.status} : ${body.slice(0, 200)}`);
      return;
    }

    const repoInfo = await repoRes.json();
    if (repoInfo.default_branch && repoInfo.default_branch !== GITHUB_BRANCH) {
      console.log(
        `ℹ️ Branche par défaut détectée : "${repoInfo.default_branch}" (au lieu de "${GITHUB_BRANCH}"). Utilisation de "${repoInfo.default_branch}".`
      );
      GITHUB_BRANCH = repoInfo.default_branch;
    }
    console.log(`ℹ️ Lecture du dépôt OK (${GITHUB_REPO}, branche ${GITHUB_BRANCH}).`);
  } catch (err) {
    console.error("❌ GitHub : erreur réseau lecture dépôt :", err.message);
    return;
  }

  // Étape 2 : test d'écriture
  try {
    const url = githubUrl(".sync-check");
    let sha;
    const existing = await fetch(`${url}?ref=${GITHUB_BRANCH}`, { headers: githubHeaders() });
    if (existing.ok) sha = (await existing.json()).sha;

    const res = await fetch(url, {
      method: "PUT",
      headers: githubHeaders(),
      body: JSON.stringify({
        message: "sync: test écriture",
        content: Buffer.from(`ok ${new Date().toISOString()}`).toString("base64"),
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (res.ok) {
      console.log(`✅ Sauvegarde GitHub opérationnelle (repo ${GITHUB_REPO}, branche ${GITHUB_BRANCH}).`);
    } else {
      const body = await res.text().catch(() => "");
      console.error(
        `❌ GitHub : LECTURE OK mais ÉCRITURE refusée — HTTP ${res.status} : ${body.slice(0, 200)}\n` +
          `➡️ Le token peut lire mais pas écrire : mettez la permission "Contents" sur "Read and write" (pas "Read-only").`
      );
    }
  } catch (err) {
    console.error("❌ GitHub : erreur test écriture :", err.message);
  }
}

const pendingWrites = new Set();

/**
 * À appeler juste après fs.writeFileSync dans chaque saveState(). Fire-and-forget,
 * mais l'envoi est suivi dans `pendingWrites` pour pouvoir être attendu avant
 * l'arrêt du processus (voir flushPendingWrites) — sinon un redémarrage juste
 * après une écriture peut perdre le changement si l'envoi GitHub n'est pas terminé.
 */
function persistState(filename) {
  const promise = pushStateFile(filename)
    .catch((err) => console.warn(`Sync GitHub (push ${filename}):`, err.message))
    .finally(() => pendingWrites.delete(promise));
  pendingWrites.add(promise);
}

/** Attend que tous les envois GitHub en cours se terminent (avec un délai maximum). */
async function flushPendingWrites(timeoutMs = 8000) {
  if (pendingWrites.size === 0) return;
  const all = Promise.allSettled([...pendingWrites]);
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([all, timeout]);
}

module.exports = {
  getStatePath,
  persistState,
  pullAllStateFiles,
  flushPendingWrites,
  testGithubWrite,
  GITHUB_ENABLED,
};
