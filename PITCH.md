---
artifact: pitch
version: "1.0"
created: 2026-10-12
status: hackathon-submission
event: Colosseum
---

# Shared Deposit Passport — Pitch

## One-liner

**Pay a deposit once. Rent from every merchant.**

A single on-chain deposit passport that any allowlisted merchant can draw against
with a per-rental, guest-signed authorization — then release back, ready for the
next merchant. No re-depositing, no waiting for refunds, no manual transfers.

## The problem

Short-term rentals — bikes, lockers, camping gear, power banks, surfboards — all
work the same way today: **the deposit is the friction, not the rental**.

A traveller renting from four vendors in one day pays four deposits. Each one
means a separate payment, a separate refund request, and a separate wait — often
days. Merchants carry the same cost from the other side: manual refunds, chargeback
disputes, and staff time spent on deposit administration rather than the rental.

The deposit is a *trust primitive*. Today every merchant re-implements it badly,
and the customer pays for that duplication with their cash flow.

## The solution

One deposit account per guest, held by a Solana program, reusable across every
merchant in the network.

```
Deposit once  →  Authorize per rental  →  Merchant locks  →  Return  →  Released, reusable
```

The guest's funds never leave the program until the guest withdraws them.
The merchant never custodies the deposit — they can only *lock* an amount the
guest explicitly authorized, and only for the rental the guest named.

## Why Solana, why now

- **Per-action cost must be near zero.** Every rental is 2–3 on-chain actions
  (authorize, lock, release). Deposits of $5–50 cannot absorb fees that are a
  meaningful fraction of the deposit.
- **Sub-second finality is a product requirement, not a luxury.** The lock must
  confirm while the customer is standing at the counter.
- **Wallet-native consumers already exist.** Solana Pay, Wallet Standard and
  mobile wallet penetration mean the trust primitive can be a wallet signature
  instead of a card pre-auth.

## Why this is defensible

The moat is **not** the program — it is the two-sided network and the rule set:

| Layer | What compounds |
| --- | --- |
| Merchant allowlist | A trusted, curated set of vendors a guest can spend their passport at |
| Shared rule set | Damage/missing handling, 180-day timeout, minimum-balance rules — defined once, honored by all merchants |
| Audit trail | Every authorize / lock / release / freeze is an on-chain event, for both sides |
| Passport balance | A guest's deposit balance becomes a reason to pick a merchant that accepts it |

An incumbent card network can replicate the payment. It cannot replicate a
wallet-held, portable, merchant-agnostic deposit balance that the customer owns.

## Business model (post-hackathon)

Deliberately out of scope for v1, but the shape is:

- **Take rate on deposit volume**, paid by the merchant — replacing the
  refund-administration cost they already bear today. The merchant saves money;
  we capture part of the saving.
- **Merchant SaaS** for the rental workflow itself (inventory, return evidence,
  dispute records) — the deposit is the wedge, the rental desk is the product.
- **Float is not the business.** We never take custody, never lend, never earn on
  deposits. That is a trust feature we intend to keep.

## Market

Every cash-deposit rental category, in order of deposit pain:

1. **Micro-mobility** — city bikes, e-bikes, scooters (high frequency, low deposit)
2. **Travel & tourism** — lockers, beach gear, ski equipment (peak-season churn)
3. **Event & venue** — power banks, headphones, accessibility devices
4. **Short-term rental** — key deposits, amenity equipment

The wedge is a **high-density tourist zone**: one city, 20–50 merchants, one
season. Density is what makes the passport worth holding — a guest only cares
about the passport if the next merchant accepts it.

## Traction status (honest)

- Working end-to-end MVP on devnet, 16 instructions, 6 account types.
- No live users, no merchant LOIs, no revenue. This is a hackathon build.
- The 180-day keeper and dispute path are implemented and tested, but not yet
  operated by a real party.

## What's next

1. **Design partner:** one tourist-dense district, 5–10 merchants, a single rental
   category. Prove a guest reuses the passport at ≥2 merchants in one trip.
2. **Evidence quality:** merchant-signed return photos + dispute resolution, so
   damage claims are not a single party's word.
3. **Operator model:** multi-sig operator, merchant self-onboarding, so the
   network can grow without us running every registration.

## Explicitly out of scope for v1

Mainnet, real funds, fiat on-ramp, custody, interest, automated deductions,
damage arbitration, insurance, multi-chain. Each is a deliberate decision, not an
unfinished item.
