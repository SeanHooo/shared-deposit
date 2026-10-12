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

# 1. Does devnet answer at all from your network?
solana --version
solana config get                      # must show https://api.devnet.solana.com
solana balance                         # the deploy authority wallet
solana address                         # expect CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF
```

**If `solana balance` times out**, devnet RPC is unreachable from your network.
This is the single most dangerous failure mode today. Use a dedicated devnet
endpoint instead:

```bash
# Free Helius devnet endpoint (or QuickNode). Create the key, then:
solana config set --url https://devnet.helius-rpc.com/?api-key=YOUR_KEY
```

Then use the same URL for the frontend build in step 4.

**Fund to ~6 SOL.** The deploy needs ~5.3 SOL at peak: ~2.57 SOL of ProgramData
rent (permanent) plus ~2.55 SOL of temporary buffer rent (recoverable after a
successful deploy) plus fees. The devnet faucet is IP-rate-limited, so expect to
issue several requests:

```bash
for i in 1 2 3 4 5; do solana airdrop 2 || sleep 20; done
solana balance
```

Fallbacks if the faucet refuses:

- https://faucet.solana.com (web faucet, same address)
- A different IP / hotspot
- If you cannot reach ~6 SOL by **midnight**, stop and switch to the
  localnet recording plan in the fallback section. Do not burn the whole night here.

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

NO_DNA=1 solana program deploy --url devnet \
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
solana program show --url devnet Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o
```

Expect `Executable: true` and `Upgrade Authority: CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF`.

> If the deploy fails after you had a previous buffer, recover the temporary rent
> with `solana program close --buffers`. Keep the program itself open.

## Step 2 — Initialize the platform (browser, ~10 min)

The platform can only be initialized by the program **upgrade authority**, which is
the wallet that deployed: `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF`.

Import that keypair into Phantom as a **devnet-only** account (Phantom → Add
account → Import private key). Note the trade-off honestly: it puts the devnet
key inside a browser extension. It never enters this repository, and it must never
be reused for anything real.

1. Run the app locally against devnet:
   ```bash
   cd app
   VITE_SOLANA_RPC_URL=<your-working-devnet-rpc> npm run dev -- --host 127.0.0.1
   ```
2. Connect the authority wallet. Open the **运营方** tab.
3. `创建 USDC 测试 mint` → wait for 链上已确认. Repeat for `创建 USDT 测试 mint`.
4. `初始化平台`.
5. Open `发放 devnet 测试资产`, send ~100 USDC and ~100 USDT to the guest wallet
   you will demo with.
6. Register two merchants (wallet public key + name). Use two more Phantom
   accounts: `Bikes` and `Camping`.

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
