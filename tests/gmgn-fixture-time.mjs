// Simulate elapsed time only inside an isolated browser fixture. Production
// services intentionally expose no force-refresh escape hatch for the cooldown.
export async function advanceGmgnFixtureTime(worker, milliseconds = 61000) {
  await worker.evaluate(async milliseconds => {
    const store = TrenchFinance.privateStore('trench-gmgn-connection');
    const account = await store.get('account');
    if (!/^(fixture|finance-test)/.test(account?.apiKey || '')) throw new Error('Fixture clock requires a synthetic credential');
    const manual = await store.get('manual-wallets');
    for (const chain of Object.keys(manual?.chains || {})) {
      const cache = await store.get('finance-cache-' + chain);
      if (cache) {
        cache.at -= milliseconds;
        for (const field of ['at', 'balanceAt', 'pnlAt', 'nextRefreshAt']) if (cache.value[field]) cache.value[field] -= milliseconds;
        await store.set('finance-cache-' + chain, cache);
      }
      const attempt = await store.get('finance-attempt-' + chain);
      if (attempt) { attempt.at -= milliseconds; attempt.nextRefreshAt -= milliseconds; await store.set('finance-attempt-' + chain, attempt); }
    }
  }, milliseconds);
}
