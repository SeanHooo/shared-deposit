# Verification — 2026-10-12

The MVP business flows are implemented and verified locally against the actual
compiled Solana program. The program is now also deployed and initialized on
devnet; the rows below are the local results, and the devnet state follows.

## Devnet state, as of 2026-10-12

The program is deployed and the platform is initialized, so the devnet side is no
longer pending deployment. What is pending is the recorded run, not the deployment:

| Devnet check | Result |
| --- | --- |
| Program executable | yes, `Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o` |
| Upgrade authority | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Platform initialized | yes, operator set to the upgrade authority, both mints six decimals |
| Merchants registered | 2, `Bikes` and `Camping`, both enabled |
| Test token supply | 100 USDC and 100 USDT |
| Guest test token balance | 100 USDC and 100 USDT, in two associated token accounts |
| Fee budget for merchant wallets | 0.5 SOL each; the guest holds 5.49 SOL |
| User activity | one passport with two consumed authorizations and two returned rental locks: the loop has run once against devnet |

Read with `node scripts/demo-status.mjs`, which sends no transaction and reads no
private key. Addresses and PDA derivations are recorded in [DEPLOYMENT.md](DEPLOYMENT.md).

The setup transactions are auditable from the guest wallet's history, which is the
same wallet that created both mints and therefore holds their mint authority:

| Transaction | Instructions |
| --- | --- |
| `4jQgW5s96sk8…`, `27z2LaxEkEG5…` | `createAccount` + `initializeMint2`, so the mint authority is the guest wallet rather than the platform operator |
| `4KdJKQHinxMh…` | `system.transfer`, 0.5 SOL from the authority to the guest |
| `65FUdgmNgrTJ…` | `ata.create` + `token.mintTo`, 100 USDC |
| `3iGiWKMHBW3v…` | `ata.create` + `token.mintTo`, 100 USDT |

Because the test mints record an authority that is not the platform operator, the
send-test-tokens buttons are enabled by reading that authority from the mint rather
than by testing for the operator. The two differ on this deployment, and gating on
the operator made funding the guest impossible from the interface.

## The customer loop, rehearsed against devnet, 2026-10-12

The full loop ran once without recording, driven entirely through the browser at
`https://api.devnet.solana.com`. Run `npm run report:loop -- guest=<ADDRESS>` in `app/`
to re-read every number below from the chain.

| Check | Result |
| --- | --- |
| Deposit, and the three accounts it creates | one transaction carried `InitializePassport`, `InitializeSplAccount` and `DepositSpl` |
| Guest deposit account | `available 20`, `locked 0`, `minimumReserve 1`, not frozen |
| Rentals | 2, at two different merchants: `Bikes` for `bike-42` and `Camping` for `tent-4`, 5 USDC locked each |
| Deposits made | one deposit account, holding the full amount that was deposited, so the second merchant was financed from the same passport with no second deposit |
| Authorizations | 2, both `consumed true` and `active false`, so single use held |
| Returns | both `Returned`, released at the same second they were returned, so the funds left the lock with no waiting period |
| Evidence | `https://example.com/receipt.jpg` and a 32-byte SHA-256 recorded on the `Bikes` lock; the `Camping` return was recorded without evidence, which the program allows |
| Where the money went | nothing locked, 20 available to the guest. No merchant holds it at any point |
| Withdrawal | not part of this run, and the amount is still sitting in the guest's deposit account |

What the rehearsal did not cover: the day the timer runs out. The 180-day keeper path
cannot be exercised on devnet without waiting, which is why it stays a local test with
time travel, and why the video says so.

## The bytes, named

A test suite is only evidence about the thing it actually ran. Three digests, and where
each was read from, so that claim can be checked rather than believed:

| What | Digest | Read from |
| --- | --- | --- |
| The program | `4acb20377c71624e2985c81a36bb099a643f938ca0808fccbd9b9bfc05c39841` | `programs/shared-deposit/artifacts/shared_deposit.so`, and independently out of the ProgramData account on devnet |
| The client bundle | printed by the build | `app/dist/assets/*.js`, and from the deployed site |
| The artifact the suite deploys | the same `.so` as row 1 | `app/e2e/harness.ts` logs the path and digest before deploying |

A ProgramData account is a 45-byte header followed by the ELF file, which is why the program
can be hashed from the cluster: `getAccountInfo` on `DNLy1eDh7ewSePKnnqpmWPikYA4XsM14f33Tf9hWYJVr`,
skip 45 bytes, hash the remaining 506,456. That is `deployed.spec.ts`, not a claim in prose —
`DEMO_URL=… npm run test:e2e` compares the repository's artifact and the local build against
what the live site and the cluster are actually serving. Both checks exist because both
failed once during preparation: the hosted site served a bundle built before the interface
was corrected, and the project was renamed after the live URL had already been written into
these documents.


## Local results, from before the deployment

| Check | Evidence |
| --- | --- |
| Anchor/SBF build | `bash scripts/build.sh` passed; SBF tools v1.57 and generated IDL |
| Typed client generation | `npm run generate` passed; Codama generated from that IDL |
| Frontend production build | `npm run build` passed |
| Program and input checks | `npm test`: 32 tests passed across 5 files, including 7 grouped real-SBF scenarios |
| Browser product flow | `npm run test:e2e`: 3 tests passed — the full Wallet Standard flow, plus console deep links and wallet-based landing consoles |
| Default devnet page | Browser reads actual devnet, correctly reports not deployed; no page errors |

The browser tests drive the real UI against a real validator with real synthetic
signatures. The first creates both SPL test mints with real instructions,
initializes the platform, funds the guest with test tokens, registers two
merchants and tests pause/resume. It then exercises all three assets, normal
returns, withdrawal, photo-file hashing, damage and compensation, keeper time
travel, reload and wallet switching, cancellation, and chain history.

The other two cover routing: every console is reachable by its own deep link,
only that console renders, the link survives a reload, a bare link normalizes to
the guest console, and the connected wallet chooses the landing console without
overriding a console the user opened by hand.

It deliberately drops an RPC response **after execution**, checks that new writes
are blocked, reloads the page and resolves the original saved signature. The SOL
balance increases exactly once. This test intentionally produces a network-error
console message; it produces no JavaScript page errors.

The SBF suite also rejects foreign mints, wrong signers, revoked and expired
authorizations, nonce replays, bound-account substitutions, concurrent locks,
locked-asset top-ups/withdrawals, duplicate transitions, invalid evidence and
premature keeper calls. It allows another unlocked asset to withdraw. Frozen
rentals remain frozen beyond 180 days, and only the original merchant can release
them after compensation. Keeper calls do not deduct from the deposit vault.

Input tests preserve exact u64 precision, reject coercion/extra decimal places,
and validate RPC account owner, discriminator, allocated length and full devnet
genesis hash. A 390-pixel browser view is checked for horizontal overflow.

Screenshots: [mobile completed flow](tests/product-mobile.png),
[actual devnet readiness](tests/devnet-readiness.png). Per-console screenshots are
saved by the e2e run into [docs/screenshots/](docs/screenshots/) and are embedded
in the README.

## Remaining external steps

The deployment, the platform, both merchants and the guest funding are complete. What
remains is the customer loop and the recording:

1. Withdraw the 20 USDC that the rehearsal left available, then run the whole loop
   again on camera. See [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

A merchant is a keypair the operator registers and never a wallet that holds guest
funds, so the merchant consoles only need enough SOL to pay their own network fee.

Photo hosting remains merchant-provided. Chain state records survive refresh;
older transaction logs depend on the RPC provider's retention. There is no
persistent keeper, backend, mainnet mode, automated deduction or dispute system.

The `deliver-acceptance-criteria` and `deliver-edge-cases` skills supplied the
acceptance and recovery structure in `tests/`; `solana-dev` guided program
constraints, generated clients, simulation, signing and Surfpool validation.

## v2 release-candidate verification, 2026-10-30

This section records the current v2 workspace. It is separate from the legacy v1
devnet evidence above and does not claim that v2 is deployed or production-ready.

| Gate | Result |
| --- | --- |
| Anchor build | `bash scripts/build.sh` passed with Anchor CLI 0.31.1, Solana CLI 2.3.0, and SBF platform-tools v1.57 |
| Committed IDL | `programs/shared-deposit-v2/idl/shared_deposit_v2.json`, 55,314 bytes |
| IDL SHA-256 | `b4f6accda8741c0ec2a017fbf8c4d31281a3ae0998eea74d19e062d443d56922` |
| Program artifact | `programs/shared-deposit-v2/artifacts/shared_deposit_v2.so`, 501,504 bytes |
| Program SHA-256 | `902a31e8defab69f8fa404837149eb682b7fedbd509ed69f1952d61e58e2133e` |
| Generated-client drift | `bash scripts/check-generated-v2.sh` passed; the Codama output exactly matches the committed IDL |
| Web tests | 41 passed across 7 files |
| Web production build | `npm run build` passed; Vite emitted a 392.32 kB JavaScript bundle |
| Surfpool v2 suite | 6 passed; the suite deploys the committed SBF artifact |
| API typecheck and tests | TypeScript passed; 16 tests passed across 4 files |
| Rust workspace tests | 6 passed: 1 v1 and 5 v2 |
| Whitespace check | `git diff --check` passed |

### v2 devnet readiness, 2026-10-30

Read-only checks against `https://api.devnet.solana.com` confirmed the full devnet
genesis hash and the expected release artifact. They also confirmed that v2 has not
been deployed: `getAccountInfo` returns `null` for the program address.

| Check | Result |
| --- | --- |
| Cluster | Solana devnet, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| RPC version | `4.4.0-beta.1` |
| Program address | `5rnNqVQG4zy4JUYHWxCEaYsbBEpNu8fHLn9p2MsdrVfx` |
| Program account | absent; `solana program show` reports that it cannot find the account |
| Deploy payer | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Payer balance | `0.771621062 SOL` |
| ProgramData rent for the 501,504-byte artifact | `2.54858012 SOL`, before signature fees |
| Recommended deploy balance | `3 SOL`; current shortfall is `2.228378938 SOL` |
| Official devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, SPL Token, six decimals |

The public devnet faucet has rate-limited this network address, and the official web
faucet requires a human interactive sign-in. No transaction has been sent, no alternate
USDC mint has been substituted, and no mainnet operation has been attempted. Deployment
and initialization remain blocked until the payer is funded with devnet SOL and the
operator wallet receives a small amount of official devnet USDC for the smoke test.

The build prints Anchor/Rust `unexpected_cfgs` warnings from dependency and macro
expansion, plus an Anchor `AccountInfo::realloc` deprecation warning. These are
recorded as warnings because the pinned build succeeds; they are not audit
clearance.

The historical v1 program artifact remains pinned to the deployed devnet digest
`4acb20377c71624e2985c81a36bb099a643f938ca0808fccbd9b9bfc05c39841`.
`scripts/build.sh` rebuilds v1 and refreshes the v1 IDL in `target/`, but it no
longer overwrites that committed legacy artifact.

Still unverified or unimplemented: Android MWA signing on a real device, iOS
read-only pairing, persistent Postgres/Supabase state and private evidence
storage, production indexing and keeper operation, the v2 React UI, Flutter,
third-party audit and fuzzing, store-release engineering, the closed pilot, and
any mainnet activity.

### v2 devnet deployment, 2026-11-02

The release-candidate program is deployed to Solana devnet. This section records
the final deployment only; it does not claim that initialization or any deposit
flow has run on v2.

| Check | Result |
| --- | --- |
| Cluster | Solana devnet, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Program | `5rnNqVQG4zy4JUYHWxCEaYsbBEpNu8fHLn9p2MsdrVfx` |
| Program owner | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Executable | yes |
| ProgramData | `CiCGcKQuP4dnacBAww36r4fAD14NWNSF31fvbqXBxTxB` |
| Upgrade authority | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Deploy payer | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Deploy buffer | `5BGPTRyHV5ZnwnJsFLot5yQ5fhL1JjmtkzVyfJvefieh`, closed after deployment |
| Final deploy signature | `TVB7Tn977A9wCqrBcgwNqb1ih934u796iovW5TugYuUsSnqVLXbGdjrwyYwMy8tFnoHXtqAp2jG9hCPGHHcohGc` |
| Final deploy slot | `517789956` |
| Transaction result | `finalized`, `err: null` |
| ProgramData account bytes | `501,549` |
| ELF bytes after 45-byte loader header | `501,504` |
| On-chain ELF SHA-256 | `902a31e8defab69f8fa404837149eb682b7fedbd509ed69f1952d61e58e2133e` |
| Release artifact SHA-256 | `902a31e8defab69f8fa404837149eb682b7fedbd509ed69f1952d61e58e2133e` |
| Byte-for-byte hash match | yes |
| ProgramData rent | `2.548519160 SOL` |
| Payer balance after deployment | `0.671059622 SOL` |

Read-only reproduction of the program metadata:

```bash
solana program show 5rnNqVQG4zy4JUYHWxCEaYsbBEpNu8fHLn9p2MsdrVfx \
  --url https://api.devnet.solana.com
```

The program account itself is a loader header and contains no ELF bytes. The
hash above was computed by reading ProgramData and skipping its 45-byte
upgradeable-loader header, then comparing the remaining bytes with
`programs/shared-deposit-v2/artifacts/shared_deposit_v2.so`.

No platform initialization, merchant registration, deposit, USDC transfer, or
other user transaction was executed as part of this deployment.

### v2 devnet platform initialization and deposit smoke test, 2026-11-02

After the deployment was verified, one explicitly approved devnet transaction
initialized the v2 platform and operator state, then transferred exactly 1
official devnet USDC into the deposit vault. The transaction was simulated
without error before signing, broadcast once, and confirmed without error. The
resulting platform, passport, deposit, vault, SOL, and token balances were read
back and checked against the expected state.

| Check | Result |
| --- | --- |
| Cluster | Solana devnet, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Program | `5rnNqVQG4zy4JUYHWxCEaYsbBEpNu8fHLn9p2MsdrVfx` |
| ProgramData | `CiCGcKQuP4dnacBAww36r4fAD14NWNSF31fvbqXBxTxB` |
| Operator and fee payer | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Official devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, SPL Token, six decimals |
| Owner USDC associated token account | `6EQHQDNn7VRuW32jFdz4qGBZF7KzYyhRP79WrLcmL5k5` |
| Platform PDA | `3Vr9PyqtNKrpM8L9F8MPwHMWLoijq6o47gV2zA28iWdN` |
| Passport PDA | `2AFEktzF249Uar9gvzaQNTtF8suAY2ivQvs2p61S4WjV` |
| Deposit PDA | `AQKs55y2e2dHYMchkZuFeNiw88ukkniCF3xPQc6dzY95` |
| Vault associated token account | `9VFCFZTWZEzA79GAPjX1wVsDvnoSitnB2P8U3HiAhM17` |
| Deposit amount | exactly `1,000,000` raw units, or `1 USDC` |
| Transaction version | `0` |
| Signature | `5RNavKpTQ8kTXh7ydmtRkrQHMMoA8mVCXYE8qgQD1wBvnWbtdMxK6FndhwNFiFwtnaCUCnfzhagkbvjCgxcrsFv7` |
| Slot | `517796302` |
| Transaction result | `Ok`, `err: null` |
| Fee | `5,000` lamports |
| Compute consumed | `75,052` CU |
| New account rent | `4,836,160` lamports total |
| Operator SOL before transaction | `671,059,622` lamports |
| Operator SOL after transaction | `666,218,462` lamports, or `0.666218462 SOL` |
| Owner USDC before transaction | `20 USDC` |
| Owner USDC after transaction | `19 USDC` |
| Vault USDC after transaction | `1 USDC` |

The atomic transaction performed these actions:

1. Initialized the v2 platform with the official devnet USDC mint.
2. Initialized the operator's passport.
3. Initialized the operator's USDC deposit account and deposit vault.
4. Transferred exactly 1 USDC from the owner token account into the vault.

Post-transaction account decoding confirmed that the platform operator is
`CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF`, the platform mint is official
devnet USDC, and the passport owner is the operator. The passport `nextNonce` is
`0`; the deposit has `1,000,000` raw units available and `0` locked.

The smoke script is
`app/scripts/devnet-v2-smoke.ts`. Its default mode refuses non-devnet genesis
hashes, checks the deployed program and upgrade authority, verifies the official
USDC mint, and simulates the transaction without reading a keypair. Sending
requires the explicit `--send` mode after human review.

Read-only reproduction of the confirmed transaction:

```bash
curl -sS https://api.devnet.solana.com \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"tx","method":"getTransaction","params":["5RNavKpTQ8kTXh7ydmtRkrQHMMoA8mVCXYE8qgQD1wBvnWbtdMxK6FndhwNFiFwtnaCUCnfzhagkbvjCgxcrsFv7",{"encoding":"jsonParsed","commitment":"confirmed","maxSupportedTransactionVersion":1}]}'
```

This verifies initialization and the first USDC deposit only. It does not
represent a completed rental, return, dispute, backend, mobile app, audit, or
mainnet release.
