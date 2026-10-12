# Devnet deployment review

Prepared 2026-10-11. No deployment transaction has been sent.

| Field | Prepared value |
| --- | --- |
| Network | Solana devnet |
| Program | `Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o` |
| Configured CLI payer / initial upgrade authority | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Read-only balance check | 2.27559592 devnet SOL remaining after the deploy |
| Read-only program check | Deployed and executable |
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

Prepared deploy command, to be executed after funding and transaction approval:

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

Final devnet acceptance:

- [ ] Program deployed and executable at the expected address.
- [ ] Two distinct six-decimal test mints and platform initialized.
- [ ] Guest funded and two merchant wallets registered.
- [ ] Each asset: deposit → authorize → merchant accept → normal return → withdraw.
- [ ] Same asset reused at the second merchant without redepositing.
- [ ] Damage/missing → freeze → original merchant compensation → release.
- [ ] Refresh, wallet switch, revoke and duplicate/permission rejection verified.
- [ ] Audit records and photo reference verified against explorer/RPC.

The 180-day boundary is tested using local time travel; devnet does not shorten or
bypass it. No live user data or real funds are part of this version.
