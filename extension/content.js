// WAX Inspector : pont en lecture seule entre le panneau latéral et l'API de waxtcg.com.
//
// Seules des requêtes GET vers une liste fermée de routes de consultation passent.
// L'extension ne peut donc ni acheter, ni vendre, ni enchérir, ni ouvrir de booster.
(() => {
  const ALLOWED = [
    /^\/api\/game$/,
    /^\/api\/stats$/,
    /^\/api\/auctions$/,
    /^\/api\/faceoff$/,
    /^\/api\/market\?[A-Za-z0-9=&%._-]*$/,
    /^\/api\/market\/\d+$/,
    /^\/api\/cards\/\d+$/,
  ];

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;

    if (msg.type === 'wax-inspector:get') {
      const path = String(msg.path ?? '');
      if (!ALLOWED.some((re) => re.test(path))) {
        sendResponse({ ok: false, status: 0, error: `Route non autorisée : ${path}` });
        return false;
      }
      fetch(path, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(async (res) => {
          let data = null;
          try {
            data = await res.json();
          } catch {
            // réponse vide ou non JSON
          }
          sendResponse({
            ok: res.ok,
            status: res.status,
            data,
            error: res.ok ? null : (data && data.error) || `HTTP ${res.status}`,
          });
        })
        .catch((err) => sendResponse({ ok: false, status: 0, error: String(err) }));
      return true; // réponse asynchrone
    }

    if (msg.type === 'wax-inspector:open-card') {
      const id = String(msg.id ?? '');
      if (/^\d+$/.test(id)) location.hash = `#carte/${id}`;
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
