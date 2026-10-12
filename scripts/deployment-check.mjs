// Read-only devnet deployment check. No private key access, no signing, no transaction.
//
// Two things this exists for:
//   1. The rent a deploy will charge is a function of the artifact size and the
//      protocol's rent parameters, so it can be computed with no RPC at all. That
//      matters exactly when the network is what is broken.
//   2. A dead network has several causes with different fixes, and Node reports all
//      of them as "fetch failed". The live check below stages DNS, TLS and RPC so the
//      real cause is visible.
//
// Usage: node scripts/deployment-check.mjs <PUBLIC_WALLET_ADDRESS> [RPC_URL]
import { lookup } from 'node:dns/promises';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const wallet = process.argv[2];
if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
  throw new Error('Usage: node scripts/deployment-check.mjs <PUBLIC_WALLET_ADDRESS> [RPC_URL]');
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// The CLI's configured endpoint is the one the deploy will use, and it decides
// whether an airdrop can work at all. The CLI reports the same "rate limit" message
// for causes that are nothing of the sort.
const configPath = process.env.SOLANA_CONFIG ?? join(homedir(), '.config/solana/cli/config.yml');
let configuredUrl;
try {
  configuredUrl = readFileSync(configPath, 'utf8')
    .match(/^json_rpc_url:\s*(\S+)/m)?.[1]
    ?.replace(/^["']|["']$/g, '');
} catch {
  configuredUrl = undefined;
}
const endpoint = process.argv[3] ?? process.env.VITE_SOLANA_RPC_URL ?? configuredUrl;
const provider = /(helius|quicknode|alchemy|ankr|genesys|shyft|blockdaemon|rpcpool|triton)/i.test(
  endpoint ?? '',
);
const publicFaucet = (endpoint ?? '').includes('api.devnet.solana.com');

console.log();
console.log('--- Endpoint ---');
console.log(`config                : ${configPath}`);
console.log(`json_rpc_url          : ${configuredUrl ?? 'not set, so the public devnet endpoint is used'}`);
console.log(`checked against       : ${endpoint ?? 'https://api.devnet.solana.com'}`);

const rpc = async (method, params, url = endpoint ?? 'https://api.devnet.solana.com') => {
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

// Staged so that a failure names its own cause. Node wraps everything as
// "fetch failed" and hides the real reason in .cause, which is what makes network
// problems indistinguishable from a dead RPC.
console.log();
console.log('--- Reaching the network (staged) ---');
let host;
try {
  host = new URL(endpoint ?? 'https://api.devnet.solana.com').hostname;
} catch {
  console.log(`The endpoint is not a valid URL: ${endpoint}`);
  process.exit(1);
}

let dns = 'unknown';
try {
  const addresses = await lookup(host, { all: true });
  dns = addresses.map((entry) => `IPv${entry.family === 6 ? '6' : '4'} ${entry.address}`).join(', ');
  console.log(`1. DNS                : ${dns}`);
} catch (error) {
  console.log(`1. DNS                : FAILED (${error.code ?? error.message})`);
}

let reachable = false;
try {
  await rpc('getGenesisHash', []);
  reachable = true;
  console.log('2. TLS + JSON-RPC     : ok');
} catch (error) {
  const cause = error.cause ?? error;
  console.log(`2. TLS + JSON-RPC     : FAILED (${cause.code ?? cause.message})`);
}

if (reachable) {
  try {
    const [genesis, account, rpcRent] = await Promise.all([
      rpc('getGenesisHash', []),
      rpc('getAccountInfo', [PROGRAM, { encoding: 'base64' }]),
      rpc('getMinimumBalanceForRentExemption', [size + 45]),
    ]);
    const balance = (await rpc('getBalance', [wallet])).value;
    if (genesis !== DEVNET_GENESIS) {
      console.log(`   WARNING: genesis hash ${genesis} is not devnet. Do not deploy here.`);
    }
    console.log(`3. Wallet             : ${wallet}`);
    console.log(`   balance            : ${balance / 1e9} SOL`);
    console.log(`   program deployed   : ${account.value?.executable ? 'yes' : 'no'}`);
    console.log(`   RPC's rent figure  : ${sol(rpcRent)} SOL`);
    if (rpcRent !== programData) {
      console.log(`   NOTE: the RPC disagrees with the offline figure by ${sol(Math.abs(rpcRent - programData))} SOL.`);
    }
    console.log();
    const shortfall = peak + fees - balance;
    if (shortfall <= 0) {
      console.log(`FUNDED: ${balance / 1e9} SOL covers the ${sol(peak + fees)} SOL peak. Deploy now.`);
    } else {
      console.log(`SHORT by ${sol(shortfall)} SOL. Expect a rent error until this is met.`);
      console.log(`Request it from ${FAUCET} in 2 SOL steps, ${Math.ceil(shortfall / 2)} times.`);
    }
  } catch (error) {
    console.log(`3. Wallet             : FAILED (${error.message})`);
  }
} else {
  // Node's network stack is not the CLI's and it is not a browser's. A failure here
  // does not mean the deploy will fail, and saying otherwise sends people to fix
  // something that is not broken.
  console.log();
  console.log('--- What that failure does and does not tell you ---');
  if (dns === 'unknown') {
    console.log('DNS itself failed, so nothing on this machine can resolve the endpoint.');
  } else {
    console.log(`DNS resolved fine (${dns}), so the name is not the problem. The failure is`);
    console.log('in connecting or in TLS.');
  }
  console.log();
  console.log('IMPORTANT: this check uses Node, whose fetch fails for reasons that do not');
  console.log('affect the tools you actually deploy with. The deploy uses the solana CLI');
  console.log('(Rust) and the app uses a browser; both have their own network stacks and');
  console.log('both often work when Node does not. Two causes worth ruling out first:');
  console.log();
  console.log('  a) Node prefers IPv6 and many networks have broken IPv6. Browsers fall');
  console.log('     back, Node does not. A quick test:');
  console.log('       node -e "fetch(\\"https://api.devnet.solana.com\\").then(r=>console.log(r.status)).catch(e=>console.log(e.cause))"');
  console.log('     against the same command with ipv4first (what a browser effectively does):');
  console.log('       node --dns-result-order=ipv4first -e "fetch(\\"https://api.devnet.solana.com\\").then(r=>console.log(r.status)).catch(e=>console.log(e.cause))"');
  console.log('  b) Node ignores the HTTPS_PROXY environment variable entirely, while curl,');
  console.log('     browsers and often the CLI honour it or bypass it. If you are behind a');
  console.log('     proxy, this check will always fail and the deploy will still work.');
  console.log();
  console.log('THE TEST THAT DECIDES THE DEPLOY:');
  console.log('  solana balance --url https://api.devnet.solana.com');
  console.log('If that returns a number, ignore the warning above and deploy:');
  console.log('  NO_DNA=1 solana program deploy --url https://api.devnet.solana.com \\');
  console.log('    --program-id target/deploy/shared_deposit_passport-keypair.json \\');
  console.log('    target/deploy/shared_deposit_passport.so');
}

if (provider) {
  console.log();
  console.log('Note: the endpoint is a hosted provider. Those do not implement');
  console.log('requestAirdrop at all, so an airdrop through it is never a rate limit.');
} else if (publicFaucet) {
  console.log();
  console.log('Note: the shared public faucet is in use, so a failed airdrop here is a');
  console.log(`genuine IP-based rate limit. ${FAUCET} uses a different bucket.`);
}

console.log();
console.log('The rent figures above are exact and need no network.');
console.log('This command sends no transaction and reads no private key.');
