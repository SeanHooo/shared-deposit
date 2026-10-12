# Devnet deployment record

Prepared 2026-10-11, deployed and initialized 2026-10-12 on Solana devnet.

## Deployed state, read back from the chain

Every value below was read from devnet, not typed from memory. The two mint addresses
matter most: their keypairs were generated in the browser and discarded, so these
strings are the only remaining handle on those accounts.

| Account | Address |
| --- | --- |
| Program | `Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o` |
| Upgrade authority | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| ProgramData, seeds `[program_id]` under the upgradeable loader, bump 250 | `DNLy1eDh7ewSePKnnqpmWPikYA4XsM14f33Tf9hWYJVr` |
| Platform PDA, seeds `["platform"]`, bump 253 | `8Ui9JsxfnsnU8FW8ixGExn75ddJNwvJUmFuZ89jsSfdY` |
| `Platform.operator` | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| USDC test mint, decimals 6 | `5nhW64j6aE93mNUErsKReqNuVm7W62PTVz91WDosnTPo` |
| USDT test mint, decimals 6 | `r8AVDLFzWjeMXu9JXKKcnDsghuD4WK7Xs2xdPmg5VsC` |
| Merchant `Bikes`, PDA bump 250 | `BJ6xikwy1dn7JS8CvSBNwpmqGrrKrPY1PwpoihXtnSpT` |
| Merchant `Bikes`, wallet | `GASM7JmhynusMchjhWjRG6yjtQ9vknQszqgFwsKDVeV6` |
| Merchant `Camping`, PDA bump 254 | `HQYpHVXdg74KVnzsd8ximkPM7oWG6FKpB7cCuBzW8nsB` |
| Merchant `Camping`, wallet | `2sCWB4oaoqoy11w15oQJdv2QBqLWbwfK6fDZD5xzvBXL` |

The operator is the upgrade authority, which is what the program is written to expect:
`initialize_platform` sets `Platform.operator` to whoever signs that one transaction, and
that signature was the deploy wallet.

All four PDA derivations above were recomputed with `getProgramDerivedAddress` and match
the on-chain accounts, including the bumps. The merchant seeds are `[b"merchant", <wallet>]`
with no discriminant of their own, which is what makes a merchant's wallet its identity and
limits a wallet to one merchant.

One read-only command reproduces this whole section:

```bash
node scripts/demo-status.mjs
```

| Field | Prepared value |
| --- | --- |
| Network | Solana devnet |
| Program | `Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o` |
| Configured CLI payer / initial upgrade authority | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Read-only balance check | 2.27559592 devnet SOL remaining after the deploy || Read-only program check | Deployed and executable |
| SBF artifact | `target/deploy/shared_deposit_passport.so`, 506,456 bytes |
| SHA-256 | `4acb20377c71624e2985c81a36bb099a643f938ca0808fccbd9b9bfc05c39841` |
| ProgramData rent at current size | 2.57367532 devnet SOL, measured from the cluster rather than assumed |
| Peak funding required | One rent, not two. The deploy buffer is funded and then transferred into the ProgramData account, so the two do not coexist. The successful deploy on 2026-10-12 consumed 2.57367532 SOL of rent plus roughly 0.0007 SOL of signature fees. |
| Initial funding estimate | Fund 3 devnet SOL. The deploy itself needs about 2.6. |

**The rent rate must be measured, not assumed.** This file carried 2.57367532 SOL,
a revision in between recomputed it to 3.52613784 SOL from the published mainnet
rate of 6,960 lamports per byte, and the cluster answered 2.57367532 SOL for the
same request — implying 5,080 lamports per byte. The 6,960 figure was not
invented: it reproduces the well-known mainnet rents exactly, including 2,039,280
lamports for a 165-byte associated token account. It is simply the wrong input for
this cluster. The measured figure is the one that matters, and the deploy
confirmed it to the lamport, because the balance after deployment matches
`funded − 2.57367532 − fees` to five decimal places.

The script now derives the rate from three sample sizes instead of assuming it, and
reports the samples so the derivation can be checked:

```bash
node scripts/deployment-check.mjs CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF
```

The CLI answers the same question directly, for any size:

```bash
solana rent 506501
```

Read-only repeatable check:

```bash
node scripts/deployment-check.mjs CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF
```

The deploy command that was used:

```bash
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
RPC=https://api.devnet.solana.com   # NOT the alias 'devnet': that always resolves to api.devnet.solana.com
NO_DNA=1 solana program deploy --url "$RPC" \
  --program-id target/deploy/shared_deposit_passport-keypair.json \
  target/deploy/shared_deposit_passport.so
```

The command uses the existing configured CLI wallet without reading or copying
its private key into application code. The program account keypair was generated
by the project toolchain and remains ignored under `target/`.

After deployment, the upgrade authority must initialize the platform. The browser
supports creating two test mints, initializing the platform, issuing test tokens,
and registering merchants. Browser transactions are simulated and reviewed before
wallet signing. The connected deployment authority wallet must match the authority
used for deployment; supply only public addresses when choosing a different wallet.

Final devnet acceptance. State as of 2026-10-12, read from the chain rather than
remembered, with the pending items named:

- [x] Program deployed and executable at the expected address.
- [x] Two distinct six-decimal test mints and platform initialized, with the operator
      set to the upgrade authority.
- [x] Two merchant wallets registered and enabled, `Bikes` and `Camping`.
- [ ] Guest funded with test tokens. Both test mints report a supply of 0, so the
      `Fund devnet test assets` step has not run yet.
- [ ] Every role wallet funded with devnet SOL. `Bikes` and `Camping` hold 0, and a
      wallet with no SOL cannot pay for the lock or the return it has to sign. The
      failure looks like a simulation error rather than a funding problem.
- [ ] Each asset: deposit → authorize → merchant accept → normal return → withdraw.
      No passport, deposit account or rental lock exists yet, so the loop has not run.
- [ ] Same asset reused at the second merchant without redepositing.
- [ ] Damage/missing → freeze → original merchant compensation → release.
- [ ] Refresh, wallet switch, revoke and duplicate/permission rejection verified.
- [ ] Audit records and photo reference verified against explorer/RPC.

The 180-day boundary is tested using local time travel; devnet does not shorten or
bypass it. No live user data or real funds are part of this version.
