// Read-only devnet deployment check. No private key access, no signing, no transaction.
//
// Three things this exists for:
//   1. The rent a deploy charges is a function of the artifact size and the rent
//      rate, and the rate is NOT a constant to be assumed. This script measures it
//      from the cluster instead. An earlier revision hardcoded the mainnet rate and
//      overstated a real devnet deploy by 37%, which is how you learn not to do that.
//   2. A dead network has several causes with different fixes, and Node reports all
//      of them as "fetch failed". The live check is staged so the cause is visible.
//   3. It separates "Node cannot reach it" from "the CLI cannot reach it", because
//      only the second one blocks a deploy.
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
// ProgramData is the program bytes plus a 45-byte loader header.
const programDataLen = size + 45;
// Account storage overhead, whatever the cluster's rate turns out to be.
const ACCOUNT_STORAGE_OVERHEAD = 128;
// Mainnet's published rate, used ONLY as a labelled fallback when nothing can be
// measured. Never present this as the answer.
const ASSUMED_RATE = 6960;

const sol = (lamports) => Number((lamports / 1e9).toFixed(8));
const rentFor = (rate, dataLen) => Math.trunc((dataLen + ACCOUNT_STORAGE_OVERHEAD) * rate);

console.log('--- Artifact ---');
console.log(`program bytes         : ${size.toLocaleString()}`);
console.log(`ProgramData bytes     : ${programDataLen.toLocaleString()}  (+45 loader header)`);

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
const url = endpoint ?? 'https://api.devnet.solana.com';
const provider = /(helius|quicknode|alchemy|ankr|genesys|shyft|blockdaemon|rpcpool|triton)/i.test(url);
const publicFaucet = url.includes('api.devnet.solana.com');

console.log();
console.log('--- Endpoint ---');
console.log(`config                : ${configPath}`);
console.log(`json_rpc_url          : ${configuredUrl ?? 'not set, so the public devnet endpoint is used'}`);
console.log(`checked against       : ${url}`);

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

// Staged so a failure names its own cause: Node wraps everything as "fetch failed"
// and hides the reason in .cause, which makes a DNS failure, a TLS failure, a proxy
// and a genuinely dead endpoint look identical.
console.log();
console.log('--- Reaching the network (staged) ---');
let host;
try {
  host = new URL(url).hostname;
} catch {
  console.log(`The endpoint is not a valid URL: ${url}`);
  process.exit(1);
}
let dns = 'unknown';
try {
  const addresses = await lookup(host, { all: true });
  dns = addresses.map((entry) => `IPv${entry.family === 6 ? '6' : '4'} ${entry.address}`).join(', ');
  console.log(`1. DNS                : ${dns}`);
  if (addresses.some((entry) => entry.address.startsWith('198.18.'))) {
    console.log('   NOTE: that is inside the reserved 198.18.0.0/15 benchmark range, which is');
    console.log('   how transparent proxies and VPN tools present fake IPs. Traffic is still');
    console.log('   reaching the real endpoint if TLS below validates, but be aware of it.');
  }
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

console.log();
console.log('--- Rent, measured rather than assumed ---');
let rate = ASSUMED_RATE;
let measured = false;
if (reachable) {
  try {
    // Solve the rate from independent sample sizes. Agreement between them is what
    // makes the extrapolation to the program size trustworthy.
    const samples = [0, 165, 1_000];
    const quoted = await Promise.all(samples.map((n) => rpc('getMinimumBalanceForRentExemption', [n])));
    const rates = samples.map((n, index) => Number(quoted[index]) / (n + ACCOUNT_STORAGE_OVERHEAD));
    const spread = Math.max(...rates) - Math.min(...rates);
    console.log(`samples               : ${samples.map((n, i) => `${n}B=${quoted[i]}`).join('  ')}`);
    console.log(`implied rates/byte    : ${rates.map((r) => r.toFixed(2)).join('  ')}`);
    if (spread > 1) {
      console.log('The RPC is not quoting a consistent rate per byte, so a single rate cannot');
      console.log('be extrapolated. Falling back to the RPC quote for the real size below.');
    } else {
      rate = rates[rates.length - 1];
      measured = true;
      console.log(`measured rate         : ${rate.toFixed(2)} lamports/byte`);
      if (Math.abs(rate / ASSUMED_RATE - 1) > 0.01) {
        console.log(`That differs from the published mainnet rate of ${ASSUMED_RATE} by`);
        console.log(`${((rate / ASSUMED_RATE - 1) * 100).toFixed(1)}%. Use the measured value. Whether the difference is this cluster or`);
        console.log('the network as a whole is not something this script can tell you, and it does');
        console.log('not need to: a remembered constant is the wrong input either way.');
      }
    }
  } catch (error) {
    console.log(`Could not measure the rate: ${error.message}`);
  }
}

const programDataRent = rentFor(rate, programDataLen);
console.log();
console.log(`ProgramData rent      : ${sol(programDataRent)} SOL   ${measured ? '(measured)' : '(estimate)'}`);
console.log('The deploy buffer is funded and then transferred into ProgramData, so the peak');
console.log('is one rent, not two. An earlier revision of this script doubled it and told the');
console.log('operator to fund 8 SOL for a deploy that needed 2.6.');

let balance;
let deployed = false;
if (reachable) {
  try {
    const [genesis, account, rpcQuote] = await Promise.all([
      rpc('getGenesisHash', []),
      rpc('getAccountInfo', [PROGRAM, { encoding: 'base64' }]),
      rpc('getMinimumBalanceForRentExemption', [programDataLen]),
    ]);
    balance = (await rpc('getBalance', [wallet])).value;
    deployed = Boolean(account.value?.executable);
    if (genesis !== DEVNET_GENESIS) {
      console.log();
      console.log(`WARNING: genesis hash ${genesis} is not devnet. Do not deploy here.`);
    }
    console.log();
    console.log('--- Chain state ---');
    console.log(`wallet                : ${wallet}`);
    console.log(`balance               : ${sol(balance)} SOL`);
    console.log(`program deployed      : ${deployed ? 'yes' : 'no'}`);
    console.log(`RPC quote for this size: ${sol(rpcQuote)} SOL`);
    if (Math.abs(rpcQuote - programDataRent) > 1) {
      console.log(`NOTE: that differs from the extrapolated figure by ${sol(Math.abs(rpcQuote - programDataRent))} SOL.`);
      console.log('Trust the quote for this size over any extrapolation, including this one.');
    }
  } catch (error) {
    console.log(`Chain state unavailable: ${error.message}`);
  }
}

console.log();
console.log('--- Verdict ---');
if (reachable && typeof balance === 'number') {
  if (deployed) {
    // The rent is already paid and the buffer has been transferred, so a shortfall
    // against a figure for a future deploy is not a problem and must not look like one.
    console.log('ALREADY DEPLOYED. The rent is paid: roughly one rent of lamports is now locked');
    console.log(`in the ProgramData account (${sol(programDataRent)} SOL at the measured rate), and`);
    console.log('the buffer lamports were transferred into it rather than refunded.');
    console.log(`The remaining ${sol(balance)} SOL is free for fees. Fund the three non-authority`);
    console.log('wallets — 0.5 SOL each is plenty — and move on to the browser setup.');
    console.log();
    console.log('Verify the deploy is sane before building on it:');
    console.log(`  solana program show --url ${url} ${PROGRAM}`);
    console.log('Expect Executable: true and the authority CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF.');
  } else {
    const shortfall = programDataRent + 20_000_000 - balance;
    if (shortfall <= 0) {
      console.log(`FUNDED: ${sol(balance)} SOL covers ${sol(programDataRent)} SOL of rent plus fees.`);
    } else {
      console.log(`SHORT by ${sol(shortfall)} SOL. Expect a rent error until this is met.`);
      console.log(`Request it from ${FAUCET} in 2 SOL steps.`);
    }
  }
} else {
  console.log('Network checks did not run, so the figures above are estimates from the');
  console.log(`published mainnet rate (${ASSUMED_RATE} lamports/byte) and are NOT authoritative.`);
  console.log();
  console.log('IMPORTANT: this check uses Node, whose fetch fails for reasons that do not');
  console.log('affect the tools you actually deploy with. The deploy uses the solana CLI');
  console.log('(Rust); the app uses a browser. Node prefers IPv6 and ignores HTTPS_PROXY,');
  console.log('both of which break it on networks where the CLI works fine.');
  console.log();
  console.log('THE TEST THAT DECIDES THE DEPLOY:');
  console.log('  solana balance --url https://api.devnet.solana.com');
  console.log('And the authoritative rent figure for any size, from the CLI itself:');
  console.log(`  solana rent ${programDataLen}`);
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
console.log('This command sends no transaction and reads no private key.');
