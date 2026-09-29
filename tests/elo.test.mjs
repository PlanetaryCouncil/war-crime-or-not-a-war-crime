import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EloPool, expected, replay, pairKey } from '../lib/elo.js';

test('expected is symmetric and 0.5 for equal ratings', () => {
  assert.equal(expected(1500, 1500), 0.5);
  assert.ok(Math.abs(expected(1600, 1400) + expected(1400, 1600) - 1) < 1e-12);
});

test('winner gains, loser drops, total conserved while K is equal', () => {
  const p = new EloPool(['a', 'b']);
  p.record('a', 'b', 1);
  assert.ok(p.get('a').rating > 1500);
  assert.ok(p.get('b').rating < 1500);
  assert.ok(Math.abs(p.get('a').rating + p.get('b').rating - 3000) < 1e-9);
});

test('tie between equals changes nothing', () => {
  const p = new EloPool(['a', 'b']);
  p.record('a', 'b', 0.5);
  assert.equal(p.get('a').rating, 1500);
});

test('consistent preferences produce the true order', () => {
  const truth = ['e', 'd', 'c', 'b', 'a']; // e is "worst"
  const votes = [];
  for (let r = 0; r < 20; r++)
    for (let i = 0; i < truth.length; i++)
      for (let j = i + 1; j < truth.length; j++) votes.push({ a: truth[i], b: truth[j], outcome: 1 });
  const pool = replay(truth, votes, { shuffles: 10 });
  assert.deepEqual(pool.ranking().map((x) => x.id), truth);
});

test('shuffled replay is reproducible with a seed', () => {
  const votes = [{ a: 'x', b: 'y', outcome: 1 }, { a: 'y', b: 'z', outcome: 1 }, { a: 'z', b: 'x', outcome: 0 }];
  const r1 = replay(['x', 'y', 'z'], votes, { shuffles: 5, seed: 7 }).ranking();
  const r2 = replay(['x', 'y', 'z'], votes, { shuffles: 5, seed: 7 }).ranking();
  assert.deepEqual(r1, r2);
});

test('nextPair returns two distinct known ids', () => {
  const p = new EloPool(['a', 'b', 'c', 'd']);
  for (let i = 0; i < 50; i++) {
    const [x, y] = p.nextPair();
    assert.notEqual(x, y);
    assert.ok(p.get(x) && p.get(y));
  }
});

test('pairKey is order-independent', () => {
  assert.equal(pairKey('a', 'b'), pairKey('b', 'a'));
});
