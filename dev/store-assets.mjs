// Images de la fiche Chrome Web Store : npm run store-assets
//
// - extension/icons/icon-{16,32,48,128}.png, dessinées à partir de store/icon.svg ;
// - store/screenshots/*.png (1280 × 800), prises sur l'aperçu du panneau (données de démonstration) ;
// - store/promo-440x280.png, la petite vignette promotionnelle.
//
// Il faut Playwright et Chromium : npm i --no-save playwright && npx playwright install chromium
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startServer } from './serve.mjs';

const root = resolve(import.meta.dirname, '..');
const out = (...p) => resolve(root, ...p);

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    console.error('Playwright est introuvable. Installe-le : npm i --no-save playwright && npx playwright install chromium');
    process.exit(1);
  }
}

// Marge transparente autour du dessin : le Store veut un dessin de 96 px dans l'icône de 128 px.
const ICONS = [
  { size: 16, pad: 0, detail: false },
  { size: 32, pad: 1, detail: false },
  { size: 48, pad: 2, detail: true },
  { size: 128, pad: 16, detail: true },
];

const SHOTS = [
  {
    file: '1-vendre.png',
    tab: 'Vendre',
    title: 'Vends d’abord ce qui rapporte le plus',
    text: 'Doublons, cartes en pleine hype, cartes que d’autres joueurs cherchent : classés selon ce qu’ils rapportent et leurs chances de partir sous 3 jours. Tes coups de cœur, seulement si tu le veux.',
  },
  {
    file: '2-acheter.png',
    tab: 'Acheter',
    budget: 5000,
    title: 'Les bonnes affaires du Marché',
    text: 'Les titres en vente sous leur prix de revente réaliste, vérifiés sur les ventes récentes : prix d’achat maximum, revente, gain net après la taxe de 5 %.',
  },
  {
    file: '3-deck.png',
    tab: 'Deck',
    title: 'Ton meilleur deck Face to Face',
    text: 'Les 5 cartes de ta collection qui couvrent le mieux les 9 critères, comparées à ton deck actuel, et la carte à poser pour chaque question.',
  },
  {
    file: '4-snep.png',
    tab: 'SNEP',
    title: 'Avant les montées SNEP',
    text: 'Les singles certifiés Or, Platine ou Diamant dont la carte n’est pas encore montée dans WAX, avec le gain estimé après la montée.',
  },
  {
    file: '5-encheres.png',
    tab: 'Enchères',
    budget: 20000,
    title: 'Les enchères à saisir',
    text: 'Les enchères Or et plus qui se terminent bientôt sous leur valeur de revente, avec la mise à ne pas dépasser.',
  },
];

const FONT = `system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

function iconSvg(svg, { size, pad, detail }) {
  const extent = (128 * size) / (size - 2 * pad);
  const offset = -(extent - 128) / 2;
  return svg
    .replace('viewBox="0 0 128 128"', `viewBox="${offset} ${offset} ${extent} ${extent}" width="${size}" height="${size}"`)
    .replace(/class="detail"/g, detail ? 'class="detail"' : 'class="detail" display="none"');
}

const page = (body, { width, height }) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  body { font-family: ${FONT}; color: #fff; background: #121212; }
  .glow { position: absolute; inset: 0; background: linear-gradient(180deg, #1d4a2e 0%, #121212 62%); }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 700; letter-spacing: -.01em; }
  .tag { display: inline-block; padding: 7px 16px; border-radius: 999px; background: #242424; color: #b3b3b3; font-weight: 600; }
</style></head><body><div class="glow"></div>${body}</body></html>`;

function shotHtml(shot, { icon, panelUrl }) {
  return page(
    `<div style="position:absolute;left:96px;top:0;bottom:0;width:600px;display:flex;flex-direction:column;justify-content:center;gap:28px">
      <div class="brand">${icon}<span>WAX Inspector</span></div>
      <h1 style="margin:0;font-size:54px;line-height:1.08;letter-spacing:-.02em;font-weight:800">${shot.title}</h1>
      <p style="margin:0;font-size:23px;line-height:1.45;color:#b3b3b3">${shot.text}</p>
      <div><span class="tag" style="font-size:17px">Extension non officielle · elle n’achète et ne vend jamais à ta place</span></div>
    </div>
    <iframe src="${panelUrl}" style="position:absolute;right:96px;top:40px;width:402px;height:720px;border:0;border-radius:12px;background:#121212;box-shadow:0 24px 64px rgba(0,0,0,.6)"></iframe>`,
    { width: 1280, height: 800 },
  );
}

function promoHtml({ icon }) {
  return page(
    `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:0 36px">
      <div class="brand" style="font-size:30px">${icon}<span>WAX Inspector</span></div>
      <div style="font-size:22px;font-weight:800;line-height:1.25;letter-spacing:-.01em">Quoi acheter, quoi vendre,<br>et à quel prix.</div>
      <div><span class="tag" style="font-size:13px">Pour le jeu WAX · extension non officielle</span></div>
    </div>`,
    { width: 440, height: 280 },
  );
}

const { chromium } = loadPlaywright();
const svg = await readFile(out('store/icon.svg'), 'utf8');
const { server, url } = await startServer(0);
const browser = await chromium.launch();
try {
  // Icônes
  await mkdir(out('extension/icons'), { recursive: true });
  for (const spec of ICONS) {
    const p = await browser.newPage({ viewport: { width: spec.size, height: spec.size }, deviceScaleFactor: 1 });
    await p.setContent(`<html><body style="margin:0;background:transparent">${iconSvg(svg, spec)}</body></html>`);
    await p.screenshot({ path: out(`extension/icons/icon-${spec.size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: spec.size, height: spec.size } });
    await p.close();
    console.log(`extension/icons/icon-${spec.size}.png`);
  }

  // Captures d'écran
  await mkdir(out('store/screenshots'), { recursive: true });
  const brandIcon = iconSvg(svg, { size: 44, pad: 0, detail: true });
  for (const shot of SHOTS) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await p.setContent(shotHtml(shot, { icon: brandIcon, panelUrl: `${url}/dev/preview.html` }));
    const panel = p.frameLocator('iframe');
    if (shot.budget) {
      // Budget de démonstration plus large que le solde fictif, pour montrer plusieurs résultats.
      await panel.getByRole('tab', { name: 'Réglages' }).click();
      await panel.getByLabel('Budget max (♫)').fill(String(shot.budget));
      await panel.getByRole('button', { name: 'Enregistrer' }).first().click();
    }
    await panel.getByRole('tab', { name: shot.tab, exact: true }).click();
    await panel.getByRole('button', { name: 'Analyser' }).click();
    await panel.locator('.summary').first().waitFor({ timeout: 60_000 });
    await panel.getByRole('button', { name: 'Analyser' }).waitFor({ timeout: 60_000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: out('store/screenshots', shot.file) });
    await p.close();
    console.log(`store/screenshots/${shot.file}`);
  }

  // Petite vignette promotionnelle
  const p = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await p.setContent(promoHtml({ icon: iconSvg(svg, { size: 64, pad: 0, detail: true }) }));
  await p.screenshot({ path: out('store/promo-440x280.png') });
  console.log('store/promo-440x280.png');
} finally {
  await browser.close();
  server.close();
}
