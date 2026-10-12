# Devnet setup

The on-chain program expects a platform PDA initialized with the operator's public key and two allowlisted devnet SPL mints. Keep the operator key in the wallet/CLI environment only; never add it to this repository.

Required setup values:

- Program address from the Anchor deploy.
- Platform PDA derived from `platform`.
- Devnet USDC and USDT test mint addresses.
- Devnet operator, guest and merchant public keys.

The browser uses `app/.env` only for the public RPC and localnet flag. The generated client fixes the program address; platform and mints are read directly from chain. It does not accept private keys. See the root README for deployment and the operator initialization flow.
