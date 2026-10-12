---
artifact: runbook
version: "1.0"
created: 2026-10-12
status: ready
deadline: 2026-10-13T15:00+08:00
---

# Deploy runbook — devnet, then live demo

Ordered by what blocks the submission. Total hands-on time: ~45 minutes, plus
airdrop waiting. Do **step 0 now**, in parallel with everything else.

## Step 0 — Verify network and fund the wallet (start immediately, blocks everything)

```bash
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

# Every command below uses this variable. `--url devnet` is a cluster *alias* that
# always resolves to api.devnet.solana.com, so if that endpoint is blocked you
# must override here or the deploy will hang even after `solana config set`.
RPC=https://api.devnet.solana.com

# 1. Does devnet answer at all from your network?
solana --version
solana config set --url "$RPC"
solana balance                         # the deploy authority wallet
solana address                         # expect CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF
```

**If `solana balance` times out**, devnet RPC is unreachable from your network.
This is the single most dangerous failure mode today. Use a dedicated devnet
endpoint instead — set it in the variable, so steps 1 and 4 both inherit it:

```bash
# Free Helius devnet endpoint (or QuickNode). Create the key, then:
RPC='https://devnet.helius-rpc.com/?api-key=YOUR_KEY'
solana config set --url "$RPC"
solana balance
```

Note that `solana airdrop` goes to whatever `solana config` points at, and hosted
providers often refuse to serve it. If `requestAirdrop` fails there, fund through
the web faucet instead and keep the custom RPC only for the app and the deploy.

**Fund to 3 SOL.** The deploy needs **~2.6 SOL**, which is one rent of lamports:
the deploy buffer is funded and then transferred into the ProgramData account, so
the two do not coexist and the peak is not double. Do not target 6 or 8 SOL.

An earlier revision of this file said 8 SOL because it used the published mainnet
rent rate of 6,960 lamports per byte instead of measuring. The cluster charges
5,080 for the same size, and the real deploy consumed **2.57367532 SOL** of rent
plus ~0.0007 SOL of fees. Measure the rate rather than trusting a constant:

```bash
solana rent 506501          # authoritative, straight from the CLI
```

If airdrop fails, diagnose in this order — the error text is the same for every
cause, so guessing wastes the time you do not have:

```bash
# 1. Which endpoint is the CLI actually using? This decides everything below.
solana config get
```

- **If the URL is Helius, QuickNode, Alchemy or any other provider**, the
  "rate limit" message is misleading: those endpoints do not implement
  `requestAirdrop` at all, and they never will. Point the CLI at the public
  devnet endpoint *just for the airdrop*, then set your custom RPC back for the
  deploy. This is the most common cause and it is not a rate limit.
- **If the URL is `api.devnet.solana.com`**, it is a genuine IP-based rate limit.
  The public faucet is shared, and retrying in a tight loop usually extends the
  block rather than clearing it. Go to the web faucet instead.
- **If the connection times out rather than rate-limiting**, that is a network
  problem, not a faucet problem. See the `RPC=` override above.

```bash
# Airdrop against the public endpoint explicitly, then restore your RPC.
solana airdrop 1 --url https://api.devnet.solana.com
solana config set --url "$RPC"
```

Fallbacks, roughly in order of how well they work when rate-limited:

- **https://faucet.solana.com** — the official web faucet. It is the reliable path
  and it is a different rate-limit bucket from the CLI. It asks you to sign in
  with a GitHub account of a reasonable age, so do this early rather than at 2am.
  Paste `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` and request the maximum.
- **Request smaller amounts.** `solana airdrop 1` sometimes succeeds where
  `solana airdrop 2` does not, and repeating it accumulates the same total.
- **Change your egress IP** — a phone hotspot resets the per-IP limit immediately.
  This is the fastest fix once the CLI is genuinely rate-limited.
- **Transfer from another funded devnet wallet**, if you have one.
  `solana transfer --url "$RPC" CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF <AMOUNT>`

```bash
# Retry loop, deliberately slow: hammering a shared faucet makes it worse.
for i in 1 2 3 4 5; do solana airdrop 1 && break || sleep 60; done
solana balance
```

**Time box this to 45 minutes.** Devnet SOL is the one thing on this critical path
you do not control, and every alternative below is a real, submittable plan. If you
cannot reach ~3 SOL within that window, stop and switch to the localnet recording
plan in the fallback section. A submitted video with an honest disclosure beats a
perfect deploy that never got recorded.

Sanity check the exact rent for your wallet before committing:

```bash
node scripts/deployment-check.mjs CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF
```

## Step 1 — Deploy the program (~5 min)

The `.so` is already built and current (`target/deploy/shared_deposit_passport.so`,
506,456 bytes, SHA-256 `4acb20377c71624e2985c81a36bb099a643f938ca0808fccbd9b9bfc05c39841`).
**Do not rebuild** unless you change the program — a rebuild costs time and risks
a new hash.

```bash
cd /Users/seanho/Desktop/shared-deposit-passport
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
RPC=https://api.devnet.solana.com   # or your Helius URL from step 0

NO_DNA=1 solana program deploy --url "$RPC" \
  --program-id target/deploy/shared_deposit_passport-keypair.json \
  target/deploy/shared_deposit_passport.so
```

On a flaky link the upload may abort partway. It is resumable — rerun the same
command; the buffer is reused. If it will not finish, add:

```bash
  --max-sign-attempts 50
```

Verify:

```bash
solana program show --url "$RPC" Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o
```

Expect `Executable: true` and `Upgrade Authority: CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF`.

> If the deploy fails after you had a previous buffer, recover the temporary rent
> with `solana program close --buffers --url "$RPC"`. Keep the program itself open.

## Step 2 — Initialize the platform (browser, ~10 min)

The platform can only be initialized by the program **upgrade authority**, which is
the wallet that deployed: `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF`. This is not a
convention, it is enforced — `programs/shared-deposit-passport/src/lib.rs:552`
constrains `program_data.upgrade_authority_address == Some(operator.key())`. That is
the only place in the program that reads the upgrade authority; every other operator
action compares against `Platform.operator`, which is set to whoever signs *this*
transaction. So this one signature decides who the operator is permanently.

Which means the deploy keypair has to be usable from the browser. Phantom cannot
import a JSON keypair file, so convert it to the base58 form it accepts. Pipe it
straight to the clipboard: that way the secret is never printed to the terminal and
never lands in your shell history.

```bash
cd app
node --input-type=module -e "
import { getBase58Decoder } from '@solana/kit';
import { readFileSync } from 'node:fs';
const k = Uint8Array.from(JSON.parse(readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8')));
console.log(getBase58Decoder().decode(k));
" | pbcopy && echo "88-char key is on your clipboard"
```

Then Phantom → Add account → Import private key, paste, and clear the clipboard with
`pbcopy < /dev/null`.

Two honest notes. This puts a real secret inside a browser extension; the key is
devnet-only and governs a program holding no funds, and it must never be reused for
anything that holds value. And the alternative avoids the secret entirely: run
`solana program set-upgrade-authority` to make a Phantom-native wallet the authority
first, then that wallet signs. That is cleaner in principle, but it is three more
steps on the critical path, it changes an on-chain authority, and it is untested here.
This runbook keeps the import because it is one step with no state change.

Four wallets, two consoles. The app picks the landing console from the connected
wallet, so you switch roles by switching the active account in Phantom:

| Wallet | Role | Lands on |
| --- | --- | --- |
| `CMNgjVq…` (deploy authority) | Operator | `#/operator` |
| A fresh account, `Guest` | Guest | `#/guest` |
| A fresh account, `Bikes` | Merchant | `#/merchant` |
| A fresh account, `Camping` | Merchant | `#/merchant` |

Run the app locally against devnet:

```bash
cd app
VITE_SOLANA_RPC_URL=<your-working-devnet-rpc> npm run dev -- --host 127.0.0.1
```

Then, in order. **The order matters**: `Initialize platform` writes the two mint
addresses into the platform account and the program rejects any mint that is not
6-decimal, so the mints have to exist first.

1. Connect the **authority** wallet. It lands on the operator console.
2. `Create USDC test mint` → wait for `Confirmed on chain`. The address appears in
   the **USDC test mint** field. Do the same for `Create USDT test mint`.
   The field keeps its value across a reload, but note the addresses anyway: the
   mint keypair is generated in the browser and discarded, so if they are lost the
   account can only be found again in an explorer.
3. `Initialize platform`. Afterwards the two addresses are shown read-only, which
   means they came from chain and the platform is live.
4. `Fund devnet test assets`: send ~100 USDC and ~100 USDT to the **guest** wallet.
   Do this before the guest's first deposit, since the guest signs the deposit
   themselves. The recipient's token account is created if it does not exist.
5. Register two merchants: `Bikes` and `Camping`, each as its wallet public key.
   Register them **before** connecting as those wallets, or the merchant console has
   nothing to show and the wallet lands on the guest console.
6. Fund all three non-authority wallets with SOL — see the next section. Do not skip
   it and do not leave it until the recording.

### Sanity check before recording

- `solana balance --url "$RPC"` should read about **2.574 SOL less than you funded**:
  the deploy locks one rent (2.57367532 SOL) in the ProgramData account plus roughly
  0.0007 SOL of signature fees, and it returns nothing, because the buffer lamports
  are transferred into the ProgramData account rather than refunded. A drop of about
  twice that means a buffer was left behind; recover it with
  `solana program close --buffers --url "$RPC"`.
- Switch to `Guest`, deposit 20 USDC, and confirm the balance appears **without**
  clicking anything labelled initialize. The first deposit creates the passport and
  the asset sub-account inside the same transaction.
- Switch back to the authority and confirm the header band shows the authority
  address. **The console will not follow on its own at this point**, and that is by
  design, not a bug — see the note below. Click the `Operator` tab.

### How console switching actually works

Worth knowing before you record, because it is easy to misread as a broken wallet:

- The connected wallet chooses the console **only while you have not chosen one
  yourself**. Click a console tab once and that choice is pinned for the session.
- Reloading a URL that already contains `#/guest` also counts as an explicit choice,
  so a wallet guess never overrides a deep link. That is the point of having URLs.
- Everything degrades safely: a connected merchant wallet sitting on the guest
  console shows the guest view, and the merchant console shows an explicit "switch
  to the merchant wallet" notice rather than silently rendering someone else's data.
- Therefore, during setup and during the demo, **switch the Phantom account and then
  click the console tab**. It is one extra click and it is deterministic. Do not
  build any part of the recording on the automatic jump.

### Fund every signing wallet with SOL (do not skip)

Each role pays its own network fee: the guest pays to deposit, authorize and
withdraw, and each merchant pays to lock, return and compensate. A wallet with
0 SOL cannot move anything, and the failure looks like a simulation error rather
than a funding problem. These wallets need only a fee budget, not rent, so 0.5 SOL
each is plenty and 1.5 SOL covers all three.

Fund them from the authority wallet rather than the faucet: the faucet is
rate-limited per address, and spending four requests on fee budgets before the
deploy is funded is the wrong order. The deploy authority gets its SOL first.

```bash
for W in <guest> <bikes> <camping>; do
  solana transfer --url "$RPC" "$W" 0.5 --allow-unfunded-recipient
done
solana balance   # after the deploy, confirm the buffer rent came back
```

### Two Phantom traps that will bite during recording

- Phantom defaults to **mainnet**. Switch it to Devnet first, or every action will
  fail with an account-not-found style error.
- All accounts inside one Phantom extension are exposed to the page as **one**
  wallet called `Phantom`, and connecting returns whichever account is currently
  selected in the extension. So switching role means switching the active account
  in Phantom, then clicking **Disconnect** and **Connect Phantom** in the app.
  Confirm that this actually updates the address shown in the header band during the
  step 3 dry run — it is the one interaction the automated suite cannot cover,
  because the suite injects four independent synthetic wallets instead.
- The `USDC`/`USDT` balances shown in Phantom are the *real* devnet USDC/USDT. The
  app's test mints are separate assets, so Phantom will show them as unknown or
  zero. That is expected; trust the balances in the app, which reads them from the
  chain.

## Step 3 — Prove it is live before you record

Minimum evidence that the live demo works end to end. Do the whole loop **once
without recording**:

- [ ] Guest deposits 20 USDC
- [ ] Guest authorizes 5 USDC to `Bikes`
- [ ] `Bikes` accepts and locks
- [ ] `Bikes` submits normal return
- [ ] Guest sees 20 USDC available again
- [ ] Guest authorizes 5 USDC to `Camping` **without depositing** ← the money shot
- [ ] `Camping` locks, returns
- [ ] Guest withdraws

Every wallet in that loop must hold devnet SOL, or the run stalls on a fee error.

Then update `VERIFICATION.md`'s devnet acceptance checklist with real results and
the program address.

## Step 4 — Build and host the live link (~15 min)

The RPC URL is compiled in at build time (`import.meta.env`), so set it:

```bash
cd app
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com npm run build
```

Hosting — pick one and get a public HTTPS URL:

```bash
npx vercel deploy --prod dist
# or: npx netlify deploy --prod --dir=dist
```

Use a **public** devnet RPC for the hosted build, not your personal Helius key —
the key would ship inside the JavaScript bundle and is trivially extracted. The
public `api.devnet.solana.com` is the right default for judges; a dedicated key is
only for your local recording, where your network may need it.

Verify that for yourself before you publish, because it takes two seconds and the
error is invisible once deployed:

```bash
grep -oE "https://[a-zA-Z0-9./?=_&:-]*" dist/assets/*.js | sort -u
grep -icE "helius|quicknode|alchemy|api-key" dist/assets/*.js   # must print 0 for each
```

The first command must show `https://api.devnet.solana.com` and nothing provider-
specific; the second must be zero. If a key appears, rebuild with the public URL
and republish — the old bundle may already be cached by a CDN.

Then paste the URL into `README.md` (`Live demo`) and into the Colosseum form.

## Step 5 — Record

See [DEMO-SCRIPT.md](DEMO-SCRIPT.md). Budget 90 minutes including retakes.

## Fallback plan if devnet stays unreachable or unfunded

Do **not** present a broken live link. Present the working product honestly:

1. **Record the automated proof.** The Playwright suite already drives all four
   roles end to end against the real compiled program with real signatures. Run it
   headed while screen recording:
   ```bash
   cd app
   npx playwright install chromium
   npm run test:e2e -- --headed
   ```
   This starts a local validator, deploys the SBF program, registers two merchants,
   deposits, authorizes, locks, returns, freezes, compensates, time-travels 180 days,
   keeper-releases, and survives a deliberately dropped RPC response — unattended.
   A screen capture of that run is a legitimate demonstration of a working product.
2. **Say so on the submission and in the video**, on screen: "devnet RPC was
   unreachable from the build environment; this is the integration test against the
   compiled program". Judges reward that far more than a dead link.
3. Link the repo, the test file and `VERIFICATION.md` as the evidence.

## Do not

- Do not commit `~/.config/solana/id.json`, Phantom keys, `.env`, or
  `target/deploy/*-keypair.json`. `.gitignore` already covers these — verify with
  `git status` before the first push.
- Do not deposit real funds. Devnet only.
- Do not rebuild the program at 02:00.
- Do not leave the Colosseum form for the last hour.
