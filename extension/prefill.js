// WAX Inspector : préremplit la vente groupée du Marché à la demande du panneau.
//
// Ouvre « Vendre / Enchères », coche les cartes choisies, passe à « Fixer les prix » et remplit chaque prix.
// Ne clique jamais sur « Tout mettre en vente » : c'est le joueur qui vérifie et confirme.
(() => {
  const PICK_TITLES = ['Vendre une carte', 'Vendre plusieurs cartes'];
  const PRICE_TITLE = 'Fixer les prix';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let busy = false;

  const norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  function findModal(titles) {
    for (const m of document.querySelectorAll('.modal[role="dialog"]')) {
      if (titles.includes(m.getAttribute('aria-label'))) return m;
    }
    return null;
  }
  const pickModal = () => findModal(PICK_TITLES);
  const priceModal = () => findModal([PRICE_TITLE]);

  async function waitFor(fn, timeout = 5000, step = 100) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  }

  // Change la valeur d'un champ géré par React et le prévient, comme une saisie au clavier.
  function setValue(el, value) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }

  async function openSellWindow() {
    if (priceModal()) throw new Error('Ferme d’abord la fenêtre « Fixer les prix » ouverte sur WAX, puis relance.');
    if (pickModal()) return;
    if (location.hash !== '#marche') location.hash = '#marche';
    const btn = await waitFor(() => document.querySelector('button.mk-sell'), 8000);
    if (!btn) throw new Error('Bouton « Vendre / Enchères » introuvable sur la page du Marché.');
    btn.click();
    if (!(await waitFor(pickModal, 5000))) throw new Error('La fenêtre « Vendre une carte » ne s’est pas ouverte.');
  }

  async function ensureMulti() {
    const chip = pickModal()?.querySelector('button.sell-multi');
    if (!chip) throw new Error('Bouton « Vendre plusieurs à la fois » introuvable.');
    if (chip.getAttribute('aria-pressed') === 'true') return;
    chip.click();
    const ok = await waitFor(() => pickModal()?.querySelector('button.sell-multi[aria-pressed="true"]'), 3000);
    if (!ok) throw new Error('Impossible de passer en « Vendre plusieurs à la fois ».');
  }

  // Cases de la grille qui correspondent au titre, la meilleure d'abord (même artiste, même rareté).
  function cellsMatching(item) {
    const title = norm(item.title);
    const artist = norm(item.artist);
    const out = [];
    for (const cell of pickModal()?.querySelectorAll('.fusion-grid button.grid-cell') ?? []) {
      if (norm(cell.querySelector('.card-title')?.textContent) !== title) continue;
      const a = norm(cell.querySelector('.card-artist')?.textContent);
      const r = norm(cell.querySelector('.card-rarity')?.textContent);
      let score = 0;
      if (artist && a && (a.includes(artist) || artist.includes(a))) score += 2;
      if (item.rarityLabel && r.startsWith(norm(item.rarityLabel))) score += 1;
      out.push({ cell, score });
    }
    return out.sort((x, y) => y.score - x.score).map((x) => x.cell);
  }

  async function selectCard(item) {
    const search = pickModal()?.querySelector('input[type="search"]');
    if (!search) throw new Error('La fenêtre « Vendre une carte » a été fermée.');
    setValue(search, item.title);
    const cell = await waitFor(() => cellsMatching(item)[0], 3000);
    if (!cell) return false;
    if (cell.getAttribute('aria-pressed') !== 'true') cell.click();
    return !!(await waitFor(() => cellsMatching(item)[0]?.getAttribute('aria-pressed') === 'true', 1500));
  }

  function rowTitle(li) {
    return li.querySelector('.bulk-sell-name strong')?.firstChild?.textContent ?? '';
  }

  function annotate(li, text) {
    const name = li.querySelector('.bulk-sell-name');
    if (!name || !text) return;
    name.querySelector('.wxi-note')?.remove();
    const note = document.createElement('span');
    note.className = 'wxi-note';
    note.textContent = text;
    note.style.cssText = 'display:block;margin-top:3px;font-size:11px;line-height:1.35;color:#8ee6b0';
    name.appendChild(note);
  }

  async function prefill(items, hours) {
    await openSellWindow();
    await ensureMulti();
    // « Choisis les cartes à mettre en vente (3 places libres) » : le site refuse d'en cocher plus.
    const intro = pickModal()?.querySelector('.fusion-intro')?.textContent ?? '';
    const freeMatch = intro.match(/\((\d+) places? libres?\)/);
    const free = freeMatch ? Number(freeMatch[1]) : items.length;
    if (free === 0) throw new Error('Tu n’as plus de place d’annonce libre sur WAX.');
    const noRoom = items.slice(free).map((m) => m.id);
    const selected = [];
    const missing = [];
    for (const item of items.slice(0, free)) ((await selectCard(item)) ? selected : missing).push(item);
    const search = pickModal()?.querySelector('input[type="search"]');
    if (search) setValue(search, '');
    if (!selected.length) throw new Error('Aucune des cartes n’a été trouvée dans la fenêtre de vente du site.');

    const next = pickModal()?.querySelector('.sell-multi-bar button.btn-primary');
    if (!next || next.disabled) throw new Error('Bouton « Fixer les prix » introuvable.');
    next.click();
    const list = await waitFor(() => {
      const ul = priceModal()?.querySelector('ul.bulk-sell');
      return ul && ul.querySelectorAll(':scope > li').length >= selected.length ? ul : null;
    }, 30000, 200);
    if (!list) throw new Error('Le site n’a pas chargé les cotes à temps.');

    const sel = priceModal()?.querySelector('select[aria-label="Durée de la vente"]');
    if (sel && [...sel.options].some((o) => o.value === String(hours))) setValue(sel, hours);
    await sleep(100);

    // Les lignes sont dans l'ordre de sélection ; le titre sert de vérification.
    const rows = [...list.querySelectorAll(':scope > li')];
    const used = new Set();
    let filled = 0;
    selected.forEach((item, i) => {
      let li = rows[i];
      if (!li || used.has(li) || norm(rowTitle(li)) !== norm(item.title)) {
        li = rows.find((r) => !used.has(r) && norm(rowTitle(r)) === norm(item.title));
      }
      const input = li?.querySelector('.bulk-sell-price input');
      if (!input) return missing.push(item);
      used.add(li);
      setValue(input, item.price);
      annotate(li, item.note);
      filled += 1;
    });
    return { filled, missing: missing.map((m) => m.id), noRoom };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'wax-inspector:prefill-sell') return false;
    const items = (Array.isArray(msg.items) ? msg.items : [])
      .filter((it) => it && /^\d+$/.test(String(it.id)) && Number.isInteger(it.price) && it.price > 0)
      .slice(0, 20);
    if (!items.length) {
      sendResponse({ ok: false, error: 'Aucune carte à préremplir.' });
      return false;
    }
    if (busy) {
      sendResponse({ ok: false, error: 'Préremplissage déjà en cours.' });
      return false;
    }
    busy = true;
    prefill(items, Number(msg.hours) || 48)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }))
      .finally(() => (busy = false));
    return true; // réponse asynchrone
  });
})();
