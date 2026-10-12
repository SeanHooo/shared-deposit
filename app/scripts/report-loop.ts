/*
 * Print what the program actually stored for the customer loop, decoded with the same
 * generated decoders the application uses, so the numbers in VERIFICATION.md can be
 * re-read from the chain instead of trusted. Read-only: no keypair, no transaction, no
 * wallet. Run it after the loop to see whether a rehearsal proved anything.
 *
 *   npm run report:loop -- guest=<ADDRESS> [--rpc <URL>]
 */
import { address, type Address } from "@solana/kit";
import { loadSnapshot, makeRpc } from "../src/chain";

const args = process.argv.slice(2);
/** Accept both `--guest=X` and `guest=X`, and `--rpc X`, as demo-status.mjs does. */
function valueOf(flag: string) {
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}
const rpcUrl = valueOf("--rpc") ?? "https://api.devnet.solana.com";
const guestArg = valueOf("--guest") ?? args.find((a) => a.startsWith("guest="))?.slice(6);

// Mirrors the constants in programs/shared-deposit-passport/src/lib.rs rather than
// guessing them: ACTIVE 0, RETURNED 1, FROZEN 2, COMPENSATED 3, and the return statuses
// that `record_return` accepts, where 0 is the good return that releases the funds and
// 1 and 2 freeze them. 255 is the sentinel written when the lock is created.
const STATUS = ["Locked", "Returned", "Frozen", "Compensated"];
const RETURN_STATUS = [
  "returned in good condition",
  "reported damaged",
  "reported missing",
];
const NOT_RECORDED = 255;
const usd = (v: bigint) => (Number(v) / 1e6).toFixed(6).replace(/\.?0+$/, "");
const when = (v: bigint) =>
  v === 0n ? "-" : `${new Date(Number(v) * 1000).toISOString().slice(0, 19)}Z`;
const hex = (b: Uint8Array) =>
  Buffer.from(b).toString("hex").replace(/^(00)+$/, "").slice(0, 48);

async function main() {
  const rpc = makeRpc(rpcUrl);
  const s = await loadSnapshot(rpc);
  const guest = guestArg ? address(guestArg) : null;
  const name = new Map(s.merchants.map((m) => [m.address, m.data.name]));
  const label = (m: Address) => name.get(m) ?? m;
  const owned = <T extends { data: { owner: Address } }>(rows: T[]) =>
    guest ? rows.filter((r) => r.data.owner === guest) : rows;

  console.log(`endpoint              : ${rpcUrl}`);
  console.log(`slot                  : ${s.slot}`);
  console.log(`chain time            : ${when(s.timestamp)}\n`);

  for (const p of owned(s.passports)) {
    console.log(`Passport ${p.address}`);
    console.log(`  owner               : ${p.data.owner}`);
    console.log(
      `  activeLock          : ${p.data.activeLock === address("11111111111111111111111111111111") ? "none" : p.data.activeLock}`,
    );
    console.log(`  authorizations used : ${p.data.nextNonce}`);
  }

  for (const d of owned(s.deposits)) {
    console.log(`\nDepositAccount ${d.address}`);
    console.log(`  mint                : ${d.data.mint}`);
    console.log(`  available           : ${usd(d.data.available)}`);
    console.log(`  locked              : ${usd(d.data.locked)}`);
    console.log(`  minimumReserve      : ${usd(d.data.minimumReserve)}`);
    console.log(`  frozen              : ${d.data.frozen}`);
  }

  for (const a of owned(s.authorizations)) {
    console.log(`\nAuthorization ${a.address}`);
    console.log(`  merchant            : ${label(a.data.merchant)}`);
    console.log(`  amount              : ${usd(a.data.amount)}   item ${a.data.itemId}   nonce ${a.data.nonce}`);
    console.log(`  active ${a.data.active}   consumed ${a.data.consumed}   expires ${when(a.data.expiresAt)}`);
  }

  for (const l of owned(s.rentals)) {
    console.log(`\nRentalLock ${l.address}`);
    console.log(`  merchant            : ${label(l.data.merchant)}`);
    console.log(`  amount              : ${usd(l.data.amount)}   item ${l.data.itemId}   nonce ${l.data.nonce}`);
    const returned =
      l.data.returnStatus === NOT_RECORDED
        ? "not recorded"
        : (RETURN_STATUS[l.data.returnStatus] ?? `unknown ${l.data.returnStatus}`);
    console.log(`  status              : ${STATUS[l.data.status] ?? `unknown ${l.data.status}`}`);
    console.log(`  return status       : ${returned}`);
    console.log(`  started / due       : ${when(l.data.startedAt)} / ${when(l.data.dueAt)}`);
    console.log(`  returned / released : ${when(l.data.returnedAt)} / ${when(l.data.releasedAt)}`);
    console.log(`  photoUrl            : ${l.data.photoUrl || "(none recorded)"}`);
    console.log(`  photoHash           : ${hex(l.data.photoHash) || "(none recorded)"}`);
  }

  // The claim this project makes, checked against the accounts rather than restated.
  const deposits = owned(s.deposits);
  const locks = owned(s.rentals);
  const merchants = [...new Set(locks.map((l) => l.data.merchant))];
  const returned = locks.filter((l) => l.data.returnedAt > 0n);
  const locked = deposits.reduce((sum, d) => sum + d.data.locked, 0n);
  const available = deposits.reduce((sum, d) => sum + d.data.available, 0n);
  console.log("\nWhat the chain says");
  console.log(`  passports           : ${owned(s.passports).length}`);
  console.log(`  rentals             : ${locks.length} across ${merchants.length} merchant(s), ${returned.length} returned`);
  console.log(`  still locked        : ${locked === 0n ? "nothing" : usd(locked)}`);
  console.log(`  available to guest  : ${usd(available)}`);
  if (locks.length > 1 && merchants.length > 1 && locked === 0n)
    console.log(
      "  => one passport financed rentals at more than one merchant, and no merchant is\n" +
        "     holding the guest's deposit: the funds moved between available and locked\n" +
        "     inside the guest's own account.",
    );
  console.log("\nThis command sends no transaction and reads no private key.");
}

main().catch((e: unknown) => {
  console.error(`\nCould not read the chain: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
