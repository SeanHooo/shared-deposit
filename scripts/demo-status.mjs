// Read-only devnet setup status. No private key access, no signing, no transaction.
//
// The browser setup has six steps and each one depends on the last, so "what is left"
// is a question about chain state, not about memory. Answering it from the app's own
// console means opening four wallets; answering it from memory is how a missing fee
// budget gets discovered during a recording, as a simulation error that looks like a
// program bug.
//
// This also produces the evidence that VERIFICATION.md asks for, because every line it
// prints is a value read back from the cluster rather than a value typed in.
//
// Usage: node scripts/demo-status.mjs [--rpc URL] [guest=<ADDR>] [bikes=<ADDR>] ...
//        Wallet arguments may be bare addresses; labels are only for readability.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROGRAM = 'Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
// Seeds are [b"platform"]. Both the JS getProgramDerivedAddress and the Rust
// `solana find-program-derived-address ... string:platform` produce this, and the
// account is checked below for the Platform discriminator, so a wrong constant here
// fails loudly instead of printing someone else's numbers.
const PLATFORM = '8Ui9JsxfnsnU8FW8ixGExn75ddJNwvJUmFuZ89jsSfdY';
const FEE_BUDGET = 0.5;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const argv = process.argv.slice(2);
let endpoint;
const wallets = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--rpc') {
    endpoint = argv[i + 1];
    i += 1;
  } else if (arg.startsWith('--rpc=')) {
    endpoint = arg.slice(6);
  } else {
    const [label, value] = arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, arg];
    if (!ADDRESS.test(value))
      throw new Error(`Not a base58 wallet address: ${arg}`);
    wallets.push({ label, value });
  }
}

function configuredEndpoint() {
  const path = process.env.SOLANA_CONFIG ?? join(homedir(), '.config/solana/cli/config.yml');
  try {
    return readFileSync(path, 'utf8')
      .match(/^json_rpc_url:\s*(\S+)/m)?.[1]
      ?.replace(/^["']|["']$/g, '');
  } catch {
    return undefined;
  }
}
const url = endpoint ?? process.env.VITE_SOLANA_RPC_URL ?? configuredEndpoint() ?? 'https://api.devnet.solana.com';

const rpc = async (method, params) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
};

// Anchor discriminators are the first 8 bytes of sha256("account:<Name>"), computed
// here rather than copied, so this file cannot drift from the program.
const discriminator = (name) => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const PLATFORM_DISC = discriminator('Platform');
const MERCHANT_DISC = discriminator('Merchant');
const same = (bytes, disc, at = 0) => disc.every((value, i) => bytes[at + i] === value);

/** The upgrade authority recorded in ProgramData: 4-byte state, 8-byte slot, Option tag, 32 bytes. */
function upgradeAuthority(bytes) {
  if (bytes.length < 45 || bytes[12] !== 1) return null;
  return base58(bytes.subarray(13, 45));
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = (carry - digits[i]) / 58;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let text = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    text += '1';
  }
  return text + digits.reverse().map((d) => B58[d]).join('');
}

const bytesOf = (base64) => Buffer.from(base64, 'base64');
const sol = (lamports) => (lamports / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '');

console.log(`endpoint              : ${url}`);
let genesis;
try {
  genesis = await rpc('getGenesisHash', []);
} catch (error) {
  console.log(`\nThe cluster did not answer: ${error.cause?.code ?? error.message}`);
  console.log('Nothing below can be checked. A dead network is not a broken deployment.');
  process.exit(1);
}
if (genesis !== DEVNET_GENESIS) {
  console.log(`\nREFUSING: genesis hash ${genesis} is not devnet (${DEVNET_GENESIS}).`);
  process.exit(1);
}
console.log('genesis               : devnet');

const remaining = new Set();

console.log('\n--- Program ---');
const program = await rpc('getAccountInfo', [PROGRAM, { encoding: 'base64', commitment: 'confirmed' }]);
console.log(`program               : ${PROGRAM}`);
console.log(`deployed              : ${program.value?.executable ? 'yes' : 'no'}`);
if (!program.value?.executable) {
  console.log('\nThe program is not deployed, so nothing in the browser can work yet.');
  console.log('Run Step 1 of RUNBOOK-DEPLOY.md first.');
  process.exit(0);
}
if (program.value.owner !== LOADER) {
  console.log(`WARNING: owner is ${program.value.owner}, not the upgradeable loader.`);
}

// ProgramData is [program_id] under the loader. Deriving it needs an ed25519
// on-curve check, so it is computed once and pasted, then verified by the fact that
// it decodes to an authority that is a plausible address.
const PROGRAM_DATA = 'DNLy1eDh7ewSePKnnqpmWPikYA4XsM14f33Tf9hWYJVr';
const pd = await rpc('getAccountInfo', [PROGRAM_DATA, { encoding: 'base64', commitment: 'confirmed' }]);
let authority = null;
if (!pd.value) {
  console.log(`ProgramData           : ${PROGRAM_DATA} NOT FOUND`);
  console.log('That is unexpected for a deployed program; do not build on this state.');
} else if (pd.value.owner !== LOADER) {
  console.log(`ProgramData           : owner is ${pd.value.owner}, not the upgradeable loader`);
  console.log('Refusing to read an authority out of an account the loader does not own.');
} else {
  authority = upgradeAuthority(bytesOf(pd.value.data[0]));
  console.log(`ProgramData           : ${PROGRAM_DATA}`);
  console.log(`upgrade authority     : ${authority ?? 'none (the program is immutable)'}`);
  if (authority === null)
    console.log('No authority means initialize_platform can never run. Redeploy is the only path.');
}

console.log('\n--- Platform ---');
const platformAccount = await rpc('getAccountInfo', [PLATFORM, { encoding: 'base64', commitment: 'confirmed' }]);
let minted = null;
if (!platformAccount.value) {
  console.log(`platform PDA          : ${PLATFORM} not found`);
  console.log('Step 2.3 Initialize platform is still pending.');
  remaining.add('Initialize platform (operator console, signed by the upgrade authority)');
} else {
  const data = bytesOf(platformAccount.value.data[0]);
  if (!same(data, PLATFORM_DISC)) {
    console.log(`platform PDA          : ${PLATFORM} exists but is not a Platform account`);
    console.log('Do not trust anything below. This is the wrong address for this program.');
    process.exit(1);
  }
  minted = {
    operator: base58(data.subarray(8, 40)),
    usdc: base58(data.subarray(40, 72)),
    usdt: base58(data.subarray(72, 104)),
  };
  console.log(`platform PDA          : ${PLATFORM}`);
  console.log(`operator              : ${minted.operator}`);
  if (authority && minted.operator !== authority) {
    console.log(`NOTE: the operator is not the upgrade authority (${authority}). That is allowed —`);
    console.log('initialize_platform sets the operator to whoever signed that one transaction — but');
    console.log('it means the two wallets are separate identities from here on.');
  }
  console.log(`USDC test mint        : ${minted.usdc}`);
  console.log(`USDT test mint        : ${minted.usdt}`);
  if (minted.usdc === minted.usdt)
    console.log('WARNING: the two mints are the same address, which the program forbids.');
  for (const [name, mint] of [['USDC', minted.usdc], ['USDT', minted.usdt]]) {
    const info = await rpc('getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!info.value) {
      console.log(`  ${name} mint account    : NOT FOUND — the platform points at a missing mint`);
      continue;
    }
    // SPL token mint layout: authority tag and key at 0, supply at 36, decimals at 44.
    // Cross-checked against `spl-token display`, which parses with its own code.
    const data = bytesOf(info.value.data[0]);
    const decimals = data[44];
    const raw = data.readBigUInt64LE(36);
    const supply = decimals > 0 ? Number(raw) / 10 ** decimals : Number(raw);
    console.log(`  ${name} mint decimals   : ${decimals}${decimals === 6 ? '' : '  UNEXPECTED, the program requires 6'}`);
    console.log(`  ${name} mint supply     : ${supply}${raw === 0n ? '  (nothing has ever been minted)' : ''}`);
    if (raw === 0n)
      remaining.add(`Fund devnet test assets: the ${name} test mint still has a supply of 0, so no wallet holds any`);
  }
}

console.log('\n--- Merchants ---');
const all = await rpc('getProgramAccounts', [PROGRAM, { encoding: 'base64', commitment: 'confirmed' }]);
const merchants = all
  .filter((row) => same(bytesOf(row.account.data[0]), MERCHANT_DISC))
  .map((row) => {
    const data = bytesOf(row.account.data[0]);
    const length = data.readUInt32LE(73);
    return {
      address: row.pubkey,
      authority: base58(data.subarray(8, 40)),
      operator: base58(data.subarray(40, 72)),
      active: data[72] === 1,
      name: data.subarray(77, 77 + length).toString('utf8'),
    };
  });
if (merchants.length === 0) {
  console.log('none registered');
  remaining.add('Register Bikes and Camping by wallet public key, while the operator wallet is connected');
} else {
  for (const merchant of merchants)
    console.log(`${merchant.name.padEnd(10)} ${merchant.active ? 'Enabled' : 'Paused '}  ${merchant.authority}`);
  for (const merchant of merchants)
    console.log(`  ${`${merchant.name} PDA`.padEnd(22)}: ${merchant.address}`);
  const named = new Set(merchants.map((m) => m.name));
  for (const expected of ['Bikes', 'Camping'])
    if (!named.has(expected))
      remaining.add(`Register the merchant named ${expected}`);
}
// Every account type gets a discriminator, so the rehearsal can be read off the chain:
// a completed deposit and return leave a passport, a deposit account and a rental lock
// behind, and their presence is the evidence rather than a claim about the UI.
const TYPES = [
  'Platform',
  'DepositPassport',
  'DepositAccount',
  'Merchant',
  'MerchantAuthorization',
  'RentalLock',
].map((name) => [name, discriminator(name)]);
const tally = new Map(TYPES.map(([name]) => [name, 0]));
for (const row of all) {
  const bytes = bytesOf(row.account.data[0]);
  const match = TYPES.find(([, disc]) => same(bytes, disc));
  if (match) tally.set(match[0], tally.get(match[0]) + 1);
}
const counts = TYPES.map(([name]) => `${name} ${tally.get(name)}`).join('  ');
console.log(counts.replace(/Platform \d+ {2}/, ''));
if (tally.get('DepositPassport') === 0)
  remaining.add('Run the unrecorded loop at least once: no passport exists yet, so nothing is proven');

console.log('\n--- Fee budgets (each role pays its own network fee) ---');
if (wallets.length === 0) {
  console.log('No wallets given, so this cannot be checked.');
  console.log('Pass the role addresses: node scripts/demo-status.mjs guest=<ADDR> bikes=<ADDR> camping=<ADDR>');
  remaining.add(`Fund every role wallet with ${FEE_BUDGET} SOL (addresses not supplied, so unchecked)`);
} else {
  for (const { label, value } of wallets) {
    const lamports = (await rpc('getBalance', [value])).value;
    const amount = lamports / 1e9;
    const verdict = amount === 0 ? 'NO SOL' : amount < FEE_BUDGET / 10 ? 'too low for fees' : 'ok';
    console.log(`${label.padEnd(10)} ${sol(lamports).padStart(14)} SOL  ${verdict}`);
    if (amount < FEE_BUDGET / 10)
      remaining.add(`Fund ${label} ${value} with ${FEE_BUDGET} SOL from the authority wallet`);
  }
}

console.log('\n--- Test token balances ---');
if (!minted) {
  console.log('The platform is not initialized, so there are no test mints to hold.');
} else {
  for (const { label, value } of wallets) {
    const held = await rpc('getTokenAccountsByOwner', [
      value,
      { programId: TOKEN_PROGRAM },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    const mine = held.value
      .map((row) => ({
        mint: row.account.data.parsed.info.mint,
        amount: Number(row.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
      }))
      .filter((row) => row.mint === minted.usdc || row.mint === minted.usdt);
    const shown = mine.map((row) => `${row.amount} ${row.mint === minted.usdc ? 'USDC' : 'USDT'}`);
    console.log(`${label.padEnd(10)} ${shown.length ? shown.join('  ') : 'no test tokens'}`);
    if (label === 'guest' && !mine.some((row) => row.amount >= 1))
      remaining.add('Fund devnet test assets to the guest wallet before its first deposit');
  }
}

console.log('\n--- What is left ---');
if (remaining.size === 0) {
  console.log('Setup is complete as far as the chain can tell. Next: Step 3 of RUNBOOK-DEPLOY.md,');
  console.log('the unrecorded run of the whole loop (deposit, authorize, lock, return, authorize a');
  console.log('second merchant without depositing, withdraw). Every wallet in that loop is funded,');
  console.log('so a failure there is a real defect and not a fee problem.');
} else {
  for (const item of remaining) console.log(`  - ${item}`);
  console.log('\nIn the order the runbook uses, because each depends on the last.');
}

console.log('\nThis command sends no transaction and reads no private key.');
