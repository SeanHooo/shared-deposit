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
| User activity | no passport, deposit account or rental lock exists yet, so the customer loop is still unproven against devnet |

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

1. Run the whole loop once without recording, then record it.

A merchant is a keypair the operator registers and never a wallet that holds guest
funds, so the merchant consoles only need enough SOL to pay their own network fee.

Photo hosting remains merchant-provided. Chain state records survive refresh;
older transaction logs depend on the RPC provider's retention. There is no
persistent keeper, backend, mainnet mode, automated deduction or dispute system.

The `deliver-acceptance-criteria` and `deliver-edge-cases` skills supplied the
acceptance and recovery structure in `tests/`; `solana-dev` guided program
constraints, generated clients, simulation, signing and Surfpool validation.
