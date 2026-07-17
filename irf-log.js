const fs = require("fs");
const { getStatePath, persistState } = require("./storage");

const IRF_STATE_FILE = getStatePath("irf-state.json");

/**
 * Ajoute une entrée dans l'historique IRF (irf-state.json).
 * @param {Object} entry - { userId, type, amount, byId, at }
 *   userId  : membre concerné (celui qui gagne/perd/paye)
 *   type    : label affiché dans le panel
 *   amount  : positif = gain, négatif = perte
 *   byId    : auteur de l'action (peut être "casino" ou un userId)
 *   at      : timestamp ms (défaut = Date.now())
 */
function logIrfEvent(entry) {
  try {
    let state = { messageId: null, transactions: [] };
    try { state = JSON.parse(fs.readFileSync(IRF_STATE_FILE, "utf8")); } catch {}
    const full = { byId: "casino", at: Date.now(), ...entry };
    state.transactions = [full, ...(state.transactions || [])].slice(0, 500);
    fs.writeFileSync(IRF_STATE_FILE, JSON.stringify(state, null, 2));
    persistState("irf-state.json");
  } catch {}
}

module.exports = { logIrfEvent };
