import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { EXTENSION_DIR, checkExtension, crc32, pngSize, zip } from '../dev/package.mjs';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('Chrome Web Store : l’extension passe les contrôles avant publication', async () => {
  const { manifest, files, problems } = await checkExtension(EXTENSION_DIR, { packageVersion: pkg.version });
  assert.deepEqual(problems, []);
  assert.ok(files.includes('manifest.json'));
  assert.ok(!files.some((f) => f.startsWith('.') || f.includes('/.')), 'aucun fichier caché dans le paquet');
  assert.ok(manifest.description.length <= 132);
});

test('Chrome Web Store : autorisations minimales et lecture seule', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://waxtcg.com/*', 'https://snepmusique.com/*']);
  assert.deepEqual(manifest.content_scripts.flatMap((c) => c.matches), ['https://waxtcg.com/*']);
  assert.equal(manifest.content_security_policy, undefined, 'politique de sécurité par défaut de Manifest V3');
});

test('taille d’un PNG lue dans son en-tête', async () => {
  assert.deepEqual(pngSize(await readFile(new URL('../extension/icons/icon-128.png', import.meta.url))), { width: 128, height: 128 });
  assert.equal(pngSize(Buffer.from('pas une image')), null);
});

test('.zip : CRC-32 et contenu relu à l’identique', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"name":"démo"}'.repeat(20)) },
    { name: 'lib/a.js', data: Buffer.from('x') },
  ];
  const buf = zip(entries);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.deepEqual(zip(entries), buf, 'même contenu → même archive');

  // Relecture par le répertoire central.
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  assert.equal(buf.readUInt16LE(end + 10), 2);
  let at = buf.readUInt32LE(end + 16);
  for (const expected of entries) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    assert.equal(buf.toString('utf8', at + 46, at + 46 + nameLen), expected.name);
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const body = buf.subarray(start, start + size);
    assert.deepEqual(method === 8 ? inflateRawSync(body) : body, expected.data);
    assert.equal(buf.readUInt32LE(at + 16), crc32(expected.data));
    at += 46 + nameLen;
  }
});
