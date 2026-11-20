import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseWallet } from '../extension/lib/wallet.js';

test('montants affichés par la page WAX', () => {
  assert.equal(parseAmount('395'), 395);
  assert.equal(parseAmount(' 138 '), 138);
  assert.equal(parseAmount('1 234'), 1234); // espace fine insécable (format fr-FR)
  assert.equal(parseAmount('1 234'), 1234); // espace insécable
  assert.equal(parseAmount('12,5 k'), 12500);
  assert.equal(parseAmount('1,2M'), 1200000);
  assert.equal(parseAmount('♫ 430'), 430);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount('—'), null);
});

test('solde lu à l’écran → nombres', () => {
  assert.deepEqual(parseWallet({ notes: '395', gems: '138', at: 42 }), { notes: 395, gems: 138, at: 42 });
  assert.deepEqual(parseWallet({ notes: '1 250', gems: null, at: 7 }), { notes: 1250, gems: null, at: 7 });
  assert.equal(parseWallet({ notes: null, gems: null }), null);
  assert.equal(parseWallet(null), null);
  assert.ok(Number.isFinite(parseWallet({ notes: '1', gems: '2' }).at));
});
