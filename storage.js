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
 * - GITHUB_REPO  : "utilisateur/nom-du-repo" (ex: "Nero974dz/house-bot")
 * - GITHUB_DATA_BRANCH (optionnel, défaut "bot-data")
 *
 * Les données sont stockées sur une branche SÉPARÉE ("bot-data") de la branche
 * de code, pour que les sauvegardes du bot ne déclenchent pas de redéploiement
 * Railway en boucle. Cette branche est créée automatiquement au démarrage.
 *
 * Si GITHUB_TOKEN/GITHUB_REPO ne sont pas définis, le bot fonctionne en local
 * uniquement (données perdues au redémarrage).
 */

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_STATE_DIR = "bot-state";

// Branche de code (celle que Railway déploie) : détectée automatiquement au démarrage.
let GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// Branche DÉDIÉE aux données. IMPORTANT : elle est différente de la branche de
// code pour que les sauvegardes du bot ne déclenchent PAS de redéploiement Railway
// (Railway surveille la branche de code, pas celle-ci).
const DATA_BRANCH = process.env.GITHUB_DATA_BRANCH || "bot-data";

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
    const res = await fetch(`${githubUrl(filename)}?ref=${DATA_BRANCH}`, {
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

async function pushStateFile(filename, attempt = 0) {
  if (!GITHUB_ENABLED) return;
  const filePath = getStatePath(filename);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const contentB64 = Buffer.from(content, "utf8").toString("base64");

  let sha;
  const existing = await fetch(`${githubUrl(filename)}?ref=${DATA_BRANCH}`, {
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
      branch: DATA_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  // 409 = SHA périmé (deux écritures concurrentes du même fichier) : on refait avec un SHA frais
  if (res.status === 409 && attempt < 5) {
    return pushStateFile(filename, attempt + 1);
  }

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
    if (repoInfo.default_branch) {
      GITHUB_BRANCH = repoInfo.default_branch;
    }
    console.log(`ℹ️ Lecture du dépôt OK (${GITHUB_REPO}, branche de code : ${GITHUB_BRANCH}).`);
  } catch (err) {
    console.error("❌ GitHub : erreur réseau lecture dépôt :", err.message);
    return;
  }

  // Étape 2 : s'assurer que la branche de données existe (créée depuis la branche de code)
  try {
    const dataRef = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/git/ref/heads/${DATA_BRANCH}`,
      { headers: githubHeaders() }
    );
    if (dataRef.status === 404) {
      // créer bot-data à partir du dernier commit de la branche de code
      const codeRef = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`,
        { headers: githubHeaders() }
      );
      if (!codeRef.ok) {
        console.error(`❌ GitHub : impossible de lire la branche de code pour créer "${DATA_BRANCH}".`);
        return;
      }
      const codeSha = (await codeRef.json()).object.sha;
      const create = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs`, {
        method: "POST",
        headers: githubHeaders(),
        body: JSON.stringify({ ref: `refs/heads/${DATA_BRANCH}`, sha: codeSha }),
      });
      if (create.ok) {
        console.log(`✅ Branche de données "${DATA_BRANCH}" créée.`);
      } else {
        const body = await create.text().catch(() => "");
        console.error(`❌ GitHub : création branche "${DATA_BRANCH}" échouée HTTP ${create.status} : ${body.slice(0, 200)}`);
        return;
      }
    }
  } catch (err) {
    console.error("❌ GitHub : erreur préparation branche de données :", err.message);
    return;
  }

  // Étape 3 : test d'écriture sur la branche de données
  try {
    const url = githubUrl(".sync-check");
    let sha;
    const existing = await fetch(`${url}?ref=${DATA_BRANCH}`, { headers: githubHeaders() });
    if (existing.ok) sha = (await existing.json()).sha;

    const res = await fetch(url, {
      method: "PUT",
      headers: githubHeaders(),
      body: JSON.stringify({
        message: "sync: test écriture",
        content: Buffer.from(`ok ${new Date().toISOString()}`).toString("base64"),
        branch: DATA_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (res.ok) {
      console.log(
        `✅ Sauvegarde GitHub opérationnelle (données sur la branche "${DATA_BRANCH}", séparée du code → pas de redéploiement en boucle).`
      );
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
// Chaîne de promesses par fichier : les sauvegardes d'un même fichier sont
// sérialisées (jamais deux GET/PUT en parallèle sur le même) → évite les 409.
const pushLocks = new Map();

/**
 * À appeler juste après fs.writeFileSync dans chaque saveState(). Fire-and-forget,
 * mais l'envoi est suivi dans `pendingWrites` pour pouvoir être attendu avant
 * l'arrêt du processus (voir flushPendingWrites) — sinon un redémarrage juste
 * après une écriture peut perdre le changement si l'envoi GitHub n'est pas terminé.
 */
function persistState(filename) {
  const prev = pushLocks.get(filename) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => pushStateFile(filename))
    .catch((err) => console.warn(`Sync GitHub (push ${filename}):`, err.message));
  pushLocks.set(filename, next);
  pendingWrites.add(next);
  next.finally(() => {
    pendingWrites.delete(next);
    if (pushLocks.get(filename) === next) pushLocks.delete(filename);
  });
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
