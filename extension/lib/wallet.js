// Solde affiché par la page WAX (Mélodies et gemmes), lu à l'écran par content.js :
// aucune requête vers le site, le panneau suit simplement ce que la page affiche.

/** « 1 234 », « 12,5 k », « 1,2 M » → nombre ; texte illisible → null. */
export function parseAmount(text) {
  const s = String(text ?? '')
    .replace(/[\s  ]/g, '')
    .replace(',', '.')
    .toLowerCase();
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return Math.round(m[2] === 'k' ? n * 1e3 : m[2] === 'm' ? n * 1e6 : n);
  }
  const digits = s.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/** {notes, gems} en texte (tel qu'à l'écran) → {notes, gems, at} en nombres, ou null. */
export function parseWallet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const notes = parseAmount(raw.notes);
  const gems = parseAmount(raw.gems);
  if (notes == null && gems == null) return null;
  return { notes, gems, at: Number.isFinite(raw.at) ? raw.at : Date.now() };
}
