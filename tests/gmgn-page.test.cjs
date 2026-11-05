const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../extension/gmgn-page.js');
test('chain follows GMGN URL, including chains beyond BSC/Solana; conflicting routes fail closed', () => {
  assert.equal(P.context('https://gmgn.ai/?chain=bsc').symbol, 'BNB');
  assert.equal(P.context('https://gmgn.ai/sol/token/abc').symbol, 'SOL');
  assert.equal(P.context('https://gmgn.ai/?chain=base').symbol, 'ETH');
  assert.equal(P.context('https://gmgn.ai/?chain=hyperevm').symbol, 'HYPE');
  assert.equal(P.context('https://gmgn.ai/?chain=newchain').chain, 'newchain');
  assert.equal(P.context('https://gmgn.ai/sol/token/abc?chain=bsc').chain, '');
  assert.equal(P.context('https://gmgn.ai/').chain, '');
  assert.equal(P.context('https://evilgmgn.ai/?chain=bsc'), null);
  assert.equal(P.context('http://gmgn.ai/?chain=bsc'), null);
});
test('native quantity stays native; USD, masked, multiple and malformed numbers are never a balance', () => {
  assert.equal(P.parse('BNB余额：3.5', 'balance', 'BNB').text, '3.5');
  assert.equal(P.parse('52.4 SOL', 'balance', 'SOL').text, '52.4');
  assert.equal(P.parse('BNB 1,234.50', 'balance', 'BNB').text, '1,234.50');
  for (const text of ['BNB $500', 'BNB 0.0₅123', 'BNB 1,23', 'BNB ****', 'BNB 3.5 2.8', 'SOL 52.4']) {
    assert.equal(P.parse(text, 'balance', 'BNB'), null, text);
  }
  assert.equal(P.parse('0', 'balance', 'BNB', true).text, '0');
  assert.equal(P.parse('0.2', 'balance', 'BNB'), null);
});
test('PnL honors page period and units; signs and percentages do not change money', () => {
  assert.deepEqual(P.parse('今日盈亏：+$562 (+12%)', 'pnl', 'BNB'), { label: '今日盈亏', text: '+$562', sign: 1 });
  assert.deepEqual(P.parse('今日收益：−$12.5', 'pnl', 'SOL'), { label: '今日盈亏', text: '-$12.5', sign: -1 });
  assert.equal(P.parse('24h PnL: +$1.2K', 'pnl', 'ETH').label, '24h盈亏');
  assert.equal(P.parse('Today PnL: +0.2 SOL', 'pnl', 'SOL').text, '+0.2 SOL');
  assert.equal(P.parse('总盈亏：+$1000', 'pnl', 'SOL'), null);
  assert.equal(P.parse('+12%', 'pnl', 'BNB', true), null);
  assert.equal(P.parse('$0', 'pnl', 'BNB', true).sign, 0);
  assert.equal(P.parse('$562', 'pnl', 'BNB', true).label, '页面盈亏');
  assert.equal(P.amount('$-42', 'ETH', true).text, '-$42');
});
