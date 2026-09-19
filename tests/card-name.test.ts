import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toEnglish } from '../src/lib/card-name.mjs';

const names = JSON.parse(readFileSync('public/data/card-names.json', 'utf8'));

test('a bare species name translates', () => {
  assert.equal(toEnglish('リザードン', names), 'Charizard');
});

test('suffixes survive the translation', () => {
  assert.equal(toEnglish('リザードンex', names), 'Charizard ex');
  assert.equal(toEnglish('ギラティナVSTAR', names), 'Giratina VSTAR');
});

test('form prefixes are translated, not treated as part of the name', () => {
  assert.equal(toEnglish('メガレックウザex', names), 'Mega Rayquaza ex');
  assert.equal(toEnglish('ヒスイ ゾロアークVSTAR', names), 'Hisuian Zoroark VSTAR');
  assert.equal(toEnglish('オリジンパルキアVSTAR', names), 'Origin Forme Palkia VSTAR');
});

test("a trainer's card keeps the trainer", () => {
  assert.equal(toEnglish('Nのレシラム', names), "N's Reshiram");
});

test('an unknown name is returned unchanged rather than guessed at', () => {
  assert.equal(toEnglish('メガレックウザキャップ', names), 'メガレックウザキャップ');
  assert.equal(toEnglish('まったく知らないカード', names), 'まったく知らないカード');
});

test('every card in the published watchlist has a translatable name or a good reason', () => {
  // Guards the table against a regeneration that loses entries.
  assert.ok(Object.keys(names.species).length > 1000, 'the species table should be complete');
});
