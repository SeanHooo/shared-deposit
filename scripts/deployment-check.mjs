// Read-only public devnet checks. No private key access or signing.
import { statSync } from 'node:fs';
const wallet = process.argv[2];
if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error('Usage: node scripts/deployment-check.mjs <PUBLIC_WALLET_ADDRESS>');
const program = 'Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o';
const size = statSync(new URL('../target/deploy/shared_deposit_passport.so', import.meta.url)).size;
async function rpc(method, params) {
  const response = await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const data = await response.json(); if (data.error) throw new Error(JSON.stringify(data.error)); return data.result;
}
const [genesis, balance, account, rent] = await Promise.all([
  rpc('getGenesisHash', []), rpc('getBalance', [wallet]), rpc('getAccountInfo', [program, { encoding: 'base64' }]), rpc('getMinimumBalanceForRentExemption', [size + 45]),
]);
if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Not devnet');
console.log(JSON.stringify({ cluster: 'devnet', program, payer: wallet, balanceSol: balance.value / 1e9, deployed: !!account.value?.executable, programBytes: size, programDataRentSol: rent / 1e9, note: 'Deployment also temporarily funds a buffer of approximately the same rent plus fees. This command sends no transaction.' }, null, 2));
