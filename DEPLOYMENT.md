# Devnet deployment review

Prepared 2026-10-11. No deployment transaction has been sent.

| Field | Prepared value |
| --- | --- |
| Network | Solana devnet |
| Program | `Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o` |
| Configured CLI payer / initial upgrade authority | `CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF` |
| Read-only balance check | 0 devnet SOL |
| Read-only program check | Not deployed |
| SBF artifact | `target/deploy/shared_deposit_passport.so`, 506,456 bytes |
| SHA-256 | `4acb20377c71624e2985c81a36bb099a643f938ca0808fccbd9b9bfc05c39841` |
| ProgramData rent at current size | 2.57367532 devnet SOL |
| Initial funding estimate | Approximately 6 devnet SOL, including the temporary deploy buffer and fees; buffer rent is recoverable after successful deployment |

Read-only repeatable check:

```bash
node scripts/deployment-check.mjs CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF
```

Prepared deploy command, to be executed after funding and transaction approval:

```bash
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
NO_DNA=1 solana program deploy --url devnet \
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
