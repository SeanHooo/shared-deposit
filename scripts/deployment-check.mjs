// Read-only devnet deployment check. No private key access, no signing, no transaction.
//
// Works offline for the parts that are network-independent: the rent a deploy will
// charge is a function of the artifact size and the compiled-in rent parameters,
// so it can be computed without an RPC. That matters when the network is exactly
// what is failing.
//
// Usage: node scripts/deployment-check.mjs <PUBLIC_WALLET_ADDRESS>
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const wallet = process.argv[2];
if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
  throw new Error('Usage: node scripts/deployment-check.mjs <PUBLIC_WALLET_ADDRESS>');
}
const PROGRAM = 'Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const FAUCET = 'https://faucet.solana.com';
const size = statSync(new URL('../target/deploy/shared_deposit_passport.so', import.meta.url)).size;

// Solana rent parameters. Protocol constants, not per-cluster settings.
const ACCOUNT_STORAGE_OVERHEAD = 128;
const LAMPORTS_PER_BYTE_YEAR = 3480;
const EXEMPTION_THRESHOLD = 2.0;
const rent = (dataLen) =>
  Math.trunc((dataLen + ACCOUNT_STORAGE_OVERHEAD) * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_THRESHOLD);
const sol = (lamports) => Number((lamports / 1e9).toFixed(8));

const programData = rent(size + 45); // ProgramData::size_of() is 45 bytes of header
const buffer = rent(size); // the deploy buffer holds the raw program data
const peak = programData + buffer;
const fees = 20_000_000; // ~0.02 SOL of headroom for the write transactions

console.log('--- Offline: what the deploy will cost ---');
console.log(`artifact              : ${size.toLocaleString()} bytes`);
console.log(`ProgramData rent      : ${sol(programData)} SOL  (permanent)`);
console.log(`deploy buffer rent    : ${sol(buffer)} SOL  (refunded when the deploy finalizes)`);
console.log(`PEAK REQUIRED         : ${sol(peak)} SOL  (buffer and ProgramData coexist)`);
console.log(`net after refund      : ${sol(programData)} SOL`);
console.log(`recommended balance   : ${sol(peak + fees)} SOL`);
console.log();
console.log('Cross-check: a 1 MB program needs ~6.96 SOL of rent, and these figures scale');
console.log('from that. If an RPC reports a materially different number below, suspect the');
console.log('artifact, not the formula.');

// The CLI's configured endpoint decides whether an airdrop can work at all, and it
// reports the same "rate limit" message for causes that are nothing of the sort.
const configPath = process.env.SOLANA_CONFIG ?? join(homedir(), '.config/solana/cli/config.yml');
let configuredUrl;
try {
  configuredUrl = readFileSync(configPath, 'utf8')
    .match(/^json_rpc_url:\s*(\S+)/m)?.[1]
    ?.replace(/^["']|["']$/g, '');
} catch {
  configuredUrl = undefined;
}
const kind = !configuredUrl
  ? 'default'
  : configuredUrl.includes('api.devnet.solana.com')
    ? 'public'
    : /(helius|quicknode|alchemy|ankr|genesys|shyft|blockdaemon|rpcpool|triton)/i.test(configuredUrl)
      ? 'provider'
      : 'unknown';

console.log();
console.log('--- CLI endpoint ---');
console.log(`config                : ${configPath}`);
console.log(`json_rpc_url          : ${configuredUrl ?? 'not set, so the public devnet endpoint is used'}`);

const rpc = async (method, params) => {
  const response = await fetch(configuredUrl ?? 'https://api.devnet.solana.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
};

console.log();
console.log('--- Live checks ---');
let reachable = false;
let balance;
try {
  const [genesis, account, rpcRent] = await Promise.all([
    rpc('getGenesisHash', []),
    rpc('getAccountInfo', [PROGRAM, { encoding: 'base64' }]),
    rpc('getMinimumBalanceForRentExemption', [size + 45]),
  ]);
  balance = (await rpc('getBalance', [wallet])).value;
  reachable = true;
  if (genesis !== DEVNET_GENESIS) {
    console.log(`WARNING: genesis hash ${genesis} is not devnet. Do not deploy here.`);
  }
  console.log(`wallet                : ${wallet}`);
  console.log(`balance               : ${balance / 1e9} SOL`);
  console.log(`program deployed      : ${account.value?.executable ? 'yes' : 'no'}`);
  console.log(`RPC rent for ProgramData: ${sol(rpcRent)} SOL`);
  if (rpcRent !== programData) {
    console.log(`NOTE: the RPC disagrees with the offline figure by ${sol(Math.abs(rpcRent - programData))} SOL.`);
  }
} catch (error) {
  console.log(`Unreachable: ${error.message}`);
}

console.log();
console.log('--- Diagnosis ---');
if (!reachable && kind === 'provider') {
  console.log('The configured endpoint is a hosted provider and it is not answering.');
  console.log('Those endpoints do not implement requestAirdrop, so the airdrop failure is');
  console.log('not a rate limit. Airdrop against the public endpoint, then restore yours:');
  console.log('  solana airdrop 1 --url https://api.devnet.solana.com');
} else if (!reachable) {
  console.log('The endpoint is not answering at all, so the airdrop error is a connectivity');
  console.log('failure, not a rate limit — the CLI prints the same sentence for both. Fix the');
  console.log('network or the endpoint before trying to fund anything.');
} else if (kind === 'provider') {
  console.log('The endpoint is a hosted provider. It does not implement requestAirdrop, so any');
  console.log('airdrop failure through it is not a rate limit. Use the public endpoint:');
  console.log('  solana airdrop 1 --url https://api.devnet.solana.com');
} else {
  console.log('The public devnet endpoint is configured and it is answering, so a failed');
  console.log(`airdrop is a genuine IP-based rate limit. Use ${FAUCET} — a different bucket,`);
  console.log('though it needs a GitHub sign-in — or change egress IP, or ask for 1 SOL at a time.');
}

if (reachable) {
  const shortfall = peak + fees - balance;
  console.log();
  if (shortfall <= 0) {
    console.log(`FUNDED: ${balance / 1e9} SOL covers the ${sol(peak + fees)} SOL peak. Deploy now.`);
  } else {
    console.log(`SHORT by ${sol(shortfall)} SOL. Expect a rent error until this is met.`);
    console.log(`Request it from ${FAUCET} in 2 SOL steps, ${Math.ceil(shortfall / 2)} times.`);
  }
}

console.log();
console.log('A per-command `--url` flag overrides the config file above, and this check');
console.log('cannot see it. The deploy itself is unaffected either way.');
console.log('This command sends no transaction and reads no private key.');
