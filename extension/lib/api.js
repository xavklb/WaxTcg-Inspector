// Lecture de l'API WAX via l'onglet waxtcg.com ouvert (voir content.js).
// Une requête à la fois, avec une pause minimum entre deux requêtes, et un cache court.
import { DEFAULT_SETTINGS, MIN_DELAY_MS } from './constants.js';

const WAX_TABS = 'https://waxtcg.com/*';

export class WaxError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class WaxApi {
  constructor({ delayMs = DEFAULT_SETTINGS.delayMs, cacheTtlMs = 120_000 } = {}) {
    this.delayMs = Math.max(MIN_DELAY_MS, delayMs);
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
    this.queue = Promise.resolve();
    this.lastAt = 0;
    this.count = 0;
    this.aborted = false;
    this.onRequest = null;
  }

  /** Annule les requêtes en attente (la requête en cours se termine). */
  abort() {
    this.aborted = true;
  }

  reset() {
    this.aborted = false;
  }

  async findTab() {
    const tabs = await chrome.tabs.query({ url: WAX_TABS });
    if (!tabs.length) {
      throw new WaxError('NO_TAB', 'Ouvre waxtcg.com dans un onglet, connecté à ton compte.');
    }
    return tabs.find((t) => t.active) ?? tabs[0];
  }

  get(path, { ttlMs = this.cacheTtlMs } = {}) {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.data);

    const run = async () => {
      if (this.aborted) throw new WaxError('ABORTED', 'Analyse arrêtée.');
      const wait = this.lastAt + Math.max(MIN_DELAY_MS, this.delayMs) - Date.now();
      if (wait > 0) await sleep(wait);
      if (this.aborted) throw new WaxError('ABORTED', 'Analyse arrêtée.');

      const tab = await this.findTab();
      let res;
      try {
        res = await chrome.tabs.sendMessage(tab.id, { type: 'wax-inspector:get', path });
      } catch {
        res = null;
      } finally {
        this.lastAt = Date.now();
      }
      if (!res) {
        throw new WaxError('NO_BRIDGE', 'Recharge l’onglet WAX (F5) pour activer l’extension, puis relance.');
      }
      this.count += 1;
      this.onRequest?.(this.count, path);

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new WaxError('AUTH', 'Connecte-toi à WAX dans l’onglet ouvert, puis relance.');
        }
        if (res.status === 429) {
          throw new WaxError('RATE', 'Le site demande de ralentir : attends une minute et augmente le délai dans les réglages.');
        }
        throw new WaxError('HTTP', `Erreur ${res.status || 'réseau'} sur ${path} : ${res.error ?? 'inconnue'}`);
      }
      this.cache.set(path, { at: Date.now(), data: res.data });
      return res.data;
    };

    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Demande à l'onglet WAX de préremplir la vente groupée (voir prefill.js). Ne met rien en vente. */
  async prefillSell(items, hours) {
    const tab = await this.findTab();
    await chrome.tabs.update(tab.id, { active: true });
    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: 'wax-inspector:prefill-sell', items, hours });
    } catch {
      res = null;
    }
    if (!res) throw new WaxError('NO_BRIDGE', 'Recharge l’onglet WAX (F5) pour activer l’extension, puis relance.');
    if (!res.ok) throw new WaxError('PREFILL', res.error ?? 'Préremplissage impossible.');
    return res;
  }

  async openCard(trackId) {
    const tab = await this.findTab();
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'wax-inspector:open-card', id: String(trackId) });
  }
}
