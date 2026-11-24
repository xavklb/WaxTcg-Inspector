// Paquet à envoyer au Chrome Web Store : npm run package → dist/wax-inspector-<version>.zip
//
// Vérifie d'abord ce que le Store refuse ou signale le plus souvent : description trop longue,
// icônes absentes ou à la mauvaise taille, fichier introuvable, code chargé à distance, version
// différente de package.json. Le .zip contient le dossier extension/ (manifest.json à la racine).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
export const EXTENSION_DIR = resolve(root, 'extension');

// Limites du Chrome Web Store.
const MAX_NAME = 75;
const MAX_DESCRIPTION = 132;
const ICON_SIZES = [16, 32, 48, 128];

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(relative(base, full).split('\\').join('/'));
  }
  return out.sort();
}

/** Largeur et hauteur d'un PNG (en-tête IHDR), ou null si ce n'est pas un PNG. */
export function pngSize(buf) {
  const signature = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const REMOTE_CODE = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bfrom\s+['"]https?:/, 'import depuis une adresse web'],
  [/\bimport\s*\(\s*['"`]https?:/, 'import() depuis une adresse web'],
  [/<script[^>]*\bsrc=["']https?:/i, 'script chargé depuis une adresse web'],
  [/<link[^>]*\bhref=["']https?:/i, 'feuille de style chargée depuis une adresse web'],
];

/** Fichiers locaux cités par un fichier : imports JS, script et feuilles de style HTML. */
function localRefs(name, text) {
  const refs = [];
  const patterns = name.endsWith('.html')
    ? [/<script[^>]*\bsrc=["']([^"':]+)["']/gi, /<link[^>]*\bhref=["']([^"':]+)["']/gi]
    : [/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g];
  for (const re of patterns) for (const m of text.matchAll(re)) refs.push(posix.normalize(posix.join(posix.dirname(name), m[1])));
  return refs;
}

/**
 * Contrôle le dossier de l'extension avant publication.
 * Renvoie le manifest, les fichiers à empaqueter (fichiers cachés exclus) et la liste des problèmes.
 */
export async function checkExtension(dir = EXTENSION_DIR, { packageVersion } = {}) {
  const problems = [];
  const all = await listFiles(dir);
  const files = all.filter((f) => !f.split('/').some((part) => part.startsWith('.')));
  const has = new Set(files);

  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (e) {
    return { manifest: null, files, problems: [`manifest.json illisible : ${e.message}`] };
  }

  if (manifest.manifest_version !== 3) problems.push('manifest_version doit valoir 3.');
  if (!manifest.name || manifest.name.length > MAX_NAME) problems.push(`Nom absent ou de plus de ${MAX_NAME} caractères.`);
  const desc = manifest.description ?? '';
  if (!desc || desc.length > MAX_DESCRIPTION) {
    problems.push(`Description absente ou trop longue (${desc.length} caractères, ${MAX_DESCRIPTION} au plus).`);
  }
  const version = String(manifest.version ?? '');
  const parts = version.split('.');
  if (!/^\d+(\.\d+){0,3}$/.test(version) || parts.some((p) => Number(p) > 65535 || (p.length > 1 && p.startsWith('0')))) {
    problems.push(`Version invalide : « ${version} » (1 à 4 nombres séparés par des points).`);
  }
  if (packageVersion && version !== packageVersion) {
    problems.push(`La version du manifest (${version}) diffère de celle de package.json (${packageVersion}).`);
  }

  const icons = manifest.icons ?? {};
  for (const size of ICON_SIZES) {
    const file = icons[size];
    if (!file) {
      problems.push(`Icône ${size}×${size} non déclarée dans manifest.icons.`);
      continue;
    }
    if (!has.has(file)) {
      problems.push(`Icône introuvable : ${file}.`);
      continue;
    }
    const dim = pngSize(await readFile(join(dir, file)));
    if (!dim) problems.push(`${file} n'est pas un PNG.`);
    else if (dim.width !== size || dim.height !== size) problems.push(`${file} mesure ${dim.width}×${dim.height} au lieu de ${size}×${size}.`);
  }

  const referenced = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
  ].filter(Boolean);

  for (const name of files.filter((f) => /\.(js|mjs|html)$/.test(f))) {
    const text = await readFile(join(dir, name), 'utf8');
    for (const [re, label] of REMOTE_CODE) if (re.test(text)) problems.push(`${name} : ${label} (code à distance interdit).`);
    referenced.push(...localRefs(name, text));
  }
  for (const ref of new Set(referenced)) if (!has.has(ref)) problems.push(`Fichier cité mais absent : ${ref}.`);

  return { manifest, files, problems };
}

// ---------------------------------------------------------------- .zip (sans dépendance)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Archive .zip de `entries` ([{name, data}]), compressée, avec une date fixe : même contenu → même fichier. */
export function zip(entries) {
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 1er janvier 2026, 00:00
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(stored ? 0 : 8, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);

    chunks.push(local, nameBuf, body);
    central.push(head, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const { manifest, files, problems } = await checkExtension(EXTENSION_DIR, { packageVersion: pkg.version });
  if (problems.length) {
    console.error(`L'extension n'est pas prête pour le Chrome Web Store :\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const entries = await Promise.all(files.map(async (name) => ({ name, data: await readFile(join(EXTENSION_DIR, name)) })));
  const out = resolve(root, 'dist', `wax-inspector-${manifest.version}.zip`);
  await mkdir(dirname(out), { recursive: true });
  const archive = zip(entries);
  await writeFile(out, archive);
  console.log(`${relative(root, out)} : ${files.length} fichiers, ${(archive.length / 1024).toFixed(0)} Ko.`);
  console.log('À envoyer dans le tableau de bord du Chrome Web Store (Paquet → Importer un nouveau paquet).');
}
