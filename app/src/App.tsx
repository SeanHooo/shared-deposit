import { useCallback, useEffect, useRef, useState } from "react";
import { address, type Instruction } from "@solana/kit";
import {
  useConnectedWallet,
  useConnect,
  useDisconnect,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import type { AppClient } from "./providers";
import * as p from "./program";
import { createTestMint, fundTestTokens } from "./test-assets";
import { describeError } from "./errors";
import { readSetupCache, writeSetupCache } from "./setup-cache";
import {
  assetFor,
  assetMint,
  assertNetwork,
  emptySnapshot,
  loadHistory,
  loadSnapshot,
  makeRpc,
  type HistoryRow,
  type Row,
  type Snapshot,
} from "./chain";
import {
  LOCAL,
  RPC_URL,
  pendingTransaction,
  resolvePending,
  submitTransaction,
} from "./transactions";
import {
  DEFAULT_ROLE,
  ROLES,
  roleFromHash,
  roleHash,
  roleLabel,
  type Role,
} from "./routes";
const rpc = makeRpc(RPC_URL);
const statusNames = [
  "Active",
  "Returned",
  "Frozen",
  "Compensated",
  "Keeper release",
];
const actionNames = [
  "Platform initialized",
  "Passport created",
  "Asset account created",
  "Deposit",
  "Withdrawal",
  "Merchant registered",
  "Merchant updated",
  "Rental authorized",
  "Authorization revoked",
  "Locked",
  "Returned",
  "Frozen",
  "Unfrozen after compensation",
  "Keeper release",
];
const date = (seconds: bigint) =>
  seconds ? new Date(Number(seconds) * 1000).toLocaleString() : "—";
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-5)}`;
export function App() {
  const client = useClient<AppClient>();
  const wallets = useWallets(client),
    connected = useConnectedWallet(client);
  const { dispatch: connect } = useConnect(client),
    { dispatch: disconnect } = useDisconnect(client);
  const owner = connected ? address(connected.account.address) : null,
    who = connected?.signer;
  const [state, setState] = useState<Snapshot>(emptySnapshot),
    [fresh, setFresh] = useState(false);
  const [role, setRoleState] = useState<Role>(
      () => roleFromHash(location.hash) ?? DEFAULT_ROLE,
    ),
    [asset, setAsset] = useState<p.Asset>("SOL");
  const [amount, setAmount] = useState("0.1"),
    [merchant, setMerchant] = useState(""),
    [item, setItem] = useState(""),
    [due, setDue] = useState("");
  const [photoUrl, setPhotoUrl] = useState(""),
    [photoHash, setPhotoHash] = useState(new Uint8Array(32));
  const [merchantKey, setMerchantKey] = useState(""),
    [name, setName] = useState(""),
    [usdc, setUsdc] = useState(() => readSetupCache().usdcMint),
    [usdt, setUsdt] = useState(() => readSetupCache().usdtMint);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("Reading on-chain state…");
  const [history, setHistory] = useState<HistoryRow[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const epoch = useRef(0);
  const historyQuery = useRef(0);
  const [testRecipient, setTestRecipient] = useState(""),
    [testAmount, setTestAmount] = useState("100");
  const activeAction = useRef(false);
  /*
   * Keep the two mint fields across reloads. They are shown read-only from the
   * platform account once it is initialized, so this only covers the window before
   * `Initialize platform` lands — which is exactly the window where the address is
   * unrecoverable, because the mint keypair is generated and thrown away.
   */
  useEffect(() => {
    writeSetupCache({ usdcMint: usdc, usdtMint: usdt });
  }, [usdc, usdt]);
  /*
   * Switching consoles by any route — tab click, back button, edited URL or the
   * wallet guess below — drops the previous console's activity list. Otherwise
   * one role's records stay on screen under another role's heading.
   */
  const applyRole = useCallback((next: Role) => {
    historyQuery.current++;
    setHistory([]);
    setCursor(null);
    setRoleState(next);
  }, []);
  /*
   * Explicit navigation outranks the wallet-based guess below. Pinned on mount
   * too, so reloading a bookmarked console does not re-guess and jump away.
   */
  const pinnedRole = useRef(roleFromHash(location.hash) !== null);
  const setRole = useCallback(
    (next: Role) => {
      pinnedRole.current = true;
      applyRole(next);
      // pushState does not fire hashchange, so there is no feedback loop here.
      if (roleFromHash(location.hash) !== next) {
        window.history.pushState(null, "", roleHash(next));
      }
    },
    [applyRole],
  );
  // Normalize the address bar once, without pushing a history entry, so a link
  // copied at any point reproduces the console it was copied from.
  useEffect(() => {
    if (roleFromHash(location.hash) !== role) {
      window.history.replaceState(null, "", roleHash(role));
    }
  }, [role]);
  useEffect(() => {
    const sync = () => {
      pinnedRole.current = true;
      applyRole(roleFromHash(location.hash) ?? DEFAULT_ROLE);
    };
    // Only real user navigation reaches these: back, forward, or an edited URL.
    addEventListener("hashchange", sync);
    addEventListener("popstate", sync);
    return () => {
      removeEventListener("hashchange", sync);
      removeEventListener("popstate", sync);
    };
  }, [applyRole]);
  const refresh = useCallback(async () => {
    const generation = epoch.current;
    try {
      await assertNetwork(rpc, LOCAL);
      const next = await loadSnapshot(rpc);
      if (epoch.current === generation) {
        setState((current) => (next.slot >= current.slot ? next : current));
        setFresh(true);
        setNotice((current) =>
          current.startsWith("Reading on-chain state") ||
          current.startsWith("Read failed")
            ? "Chain state is up to date."
            : current,
        );
      }
    } catch (error) {
      if (epoch.current === generation) {
        setFresh(false);
        setNotice(`Read failed, money operations are paused: ${describeError(error)}`);
      }
    }
  }, []);
  useEffect(() => {
    epoch.current++;
    historyQuery.current++;
    setFresh(false);
    setHistory([]);
    setCursor(null);
    setPhotoHash(new Uint8Array(32));
    setPhotoUrl("");
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [owner, refresh]);
  const platform = state.platform?.data,
    passport = state.passports.find((e) => e.data.owner === owner),
    ownMerchant = state.merchants.find((e) => e.data.authority === owner);
  const ownDeposits = state.deposits.filter((e) => e.data.owner === owner),
    isOperator = platform?.operator === owner;
  const blocked =
    busy || !who || !fresh || !state.deployed || !!pendingTransaction();
  /*
   * The wallet decides which console a first-time visitor lands on: the platform
   * authority gets the operations console, a registered merchant gets the
   * merchant console, everyone else gets the guest console. Replacing rather
   * than pushing means Back leaves the site instead of bouncing between two
   * consoles the user never chose. Declared after ownMerchant and isOperator
   * because the dependency array is read during render, not in the callback.
   */
  useEffect(() => {
    if (pinnedRole.current || !owner || !fresh) return;
    const guess: Role = isOperator
      ? "operator"
      : ownMerchant
        ? "merchant"
        : DEFAULT_ROLE;
    if (guess === role) return;
    applyRole(guess);
    window.history.replaceState(null, "", roleHash(guess));
  }, [owner, fresh, isOperator, ownMerchant, role, applyRole]);
  async function act(
    summary: string | (() => string),
    build: () => Promise<Instruction[]>,
    confirmed?: () => void,
  ) {
    if (blocked || activeAction.current) return;
    activeAction.current = true;
    setBusy(true);
    setNotice("Validating and simulating the transaction…");
    try {
      const instructions = await build();
      const result = await submitTransaction(
        who!,
        instructions,
        typeof summary === "function" ? summary() : summary,
        connected?.supportedTransactionVersions.has(1) ? 1 : 0,
      );
      setNotice(result);
      if (result.startsWith("Confirmed on chain")) confirmed?.();
    } catch (error) {
      setNotice(
        `${describeError(error)}${pendingTransaction() ? " A transaction signature is saved; check its result first." : ""}`,
      );
    } finally {
      await refresh();
      setBusy(false);
      activeAction.current = false;
    }
  }
  function prepareMint(symbol: "USDC" | "USDT") {
    let mint = "";
    void act(
      () =>
        `Create ${symbol} test mint: ${mint}\nDecimals 6; mint authority: ${owner}\nTest asset only, not redeemable USDC/USDT.`,
      async () => {
        const result = await createTestMint(rpc, who!);
        mint = result.address;
        return result.instructions;
      },
      () => (symbol === "USDC" ? setUsdc(mint) : setUsdt(mint)),
    );
  }
  function supplyTestTokens(symbol: "USDC" | "USDT") {
    void act(
      `Send ${testAmount} ${symbol} test tokens\nRecipient: ${testRecipient}\nThe operator wallet pays the network fee and the recipient account rent. No deposit is modified.`,
      async () => {
        if (!platform) throw new Error("Platform is not initialized.");
        return fundTestTokens(
          who!,
          assetMint(symbol, platform),
          address(testRecipient),
          p.parseAmount(testAmount, symbol),
        );
      },
    );
  }
  async function recover(resend: boolean) {
    setBusy(true);
    try {
      setNotice(await resolvePending(resend));
    } catch (e) {
      setNotice(describeError(e));
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  async function readHistory(more = false) {
    if (!owner) return;
    const query = ++historyQuery.current;
    setBusy(true);
    try {
      const target =
        role === "keeper"
          ? owner
          : role === "operator" && state.platform
            ? state.platform.address
            : role === "merchant" && ownMerchant
              ? ownMerchant.address
              : passport?.address;
      if (!target) throw new Error("This role has no on-chain account yet.");
      const result = await loadHistory(
        rpc,
        target,
        more ? (cursor ?? undefined) : undefined,
      );
      if (historyQuery.current !== query) return;
      const rows =
        role === "keeper"
          ? result.rows.filter((e) => e.action === 13 && e.actor === owner)
          : result.rows;
      setHistory((old) => (more ? [...old, ...rows] : rows));
      setCursor(result.cursor);
    } catch (e) {
      if (historyQuery.current === query) setNotice(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  function balance(action: "deposit" | "withdraw") {
    void act(
      `${action === "deposit" ? "Deposit into the program vault" : "Withdraw to the connected wallet"}: ${amount} ${asset}\nGuest: ${owner}`,
      async () => {
        if (!platform) throw new Error("Platform is not initialized.");
        const mint = assetMint(asset, platform),
          account = await p.depositAddress(owner!, mint),
          existing = ownDeposits.find((e) => e.address === account);
        if (action === "withdraw" && !existing)
          throw new Error("This asset account does not exist yet.");
        return p.balanceInstructions(
          who!,
          mint,
          p.parseAmount(amount, asset),
          action,
          !passport,
          !existing,
        );
      },
    );
  }
  function authorize() {
    void act(
      `Single-use rental authorization: ${amount} ${asset}\nMerchant account: ${merchant}\nItem: ${item}\nAgreed return: ${due}\nValid for one year. A normal return releases the funds back into the program balance; withdrawing still requires a separate signature.`,
      async () => {
        if (!passport || !platform) throw new Error("Deposit first.");
        if (!item.trim() || new TextEncoder().encode(item).length > 64)
          throw new Error("Item ID is required and must be at most 64 bytes.");
        const seconds = Math.floor(new Date(due).getTime() / 1000);
        if (!Number.isFinite(seconds) || seconds <= Number(state.timestamp))
          throw new Error("Choose a return time in the future.");
        return [
          p.getAuthorizeRentalInstruction({
            owner: who!,
            passport: passport.address,
            merchant: address(merchant),
            depositAccount: await p.depositAddress(
              owner!,
              assetMint(asset, platform),
            ),
            authorization: await p.authorizationAddress(
              passport.address,
              passport.data.nextNonce,
            ),
            amount: p.parseAmount(amount, asset),
            itemId: item,
            dueAt: BigInt(seconds),
            nonce: passport.data.nextNonce,
            rulesVersion: 1,
          }),
        ];
      },
    );
  }
  const rentalAccounts = (row: Row<p.RentalLock>) => ({
    passport: row.data.passport,
    depositAccount: row.data.depositAccount,
    merchant: row.data.merchant,
    rentalLock: row.address,
  });
  const button = (text: string, fn: () => void, disabled = false) => (
    <button
      key={text}
      className="button secondary"
      disabled={blocked || disabled}
      onClick={fn}
    >
      {text}
    </button>
  );
  const relevantRentals = state.rentals.filter((e) =>
    role === "keeper"
      ? e.data.status === 0
      : role === "merchant"
        ? e.data.merchant === ownMerchant?.address
        : e.data.owner === owner,
  );
  const relevantAuths = state.authorizations.filter((e) =>
    role === "merchant"
      ? e.data.merchant === ownMerchant?.address
      : e.data.owner === owner,
  );
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">
            SHARED DEPOSIT PASSPORT · {LOCAL ? "LOCALNET" : "DEVNET"}
          </p>
          <h1>One deposit. Every merchant.</h1>
          <p className="lead">
            Deposit → authorize once → merchant locks → return releases → rent
            again or withdraw
          </p>
        </div>
        <div className="wallets">
          {connected ? (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => disconnect()}
            >
              Disconnect {short(connected.account.address)}
            </button>
          ) : wallets.length ? (
            wallets.map((wallet) => (
              <button
                className="button primary"
                key={wallet.name}
                onClick={() => connect(wallet)}
              >
                Connect {wallet.name}
              </button>
            ))
          ) : (
            <p>Install a Solana wallet, then refresh this page.</p>
          )}
        </div>
      </header>
      <section className="hero-band">
        <span>
          {fresh
            ? `On-chain state synced · slot ${state.slot}`
            : "On-chain state unconfirmed"}
        </span>
        <span>{owner ?? "No wallet connected"}</span>
        <code className="route">{roleHash(role)}</code>
        <button onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>      </section>
      <div className="panel notice-panel" role="status">
        <p>{notice}</p>
        {!state.deployed && fresh && (
          <p>
            Program not deployed. Follow the README to deploy to devnet, then
            initialize the platform.
          </p>
        )}
        {state.deployed && !platform && (
          <p>
            Platform not initialized. Connect the deployment authority wallet and
            open the Operator console to configure the two test mints.
          </p>
        )}
        {pendingTransaction() && (
          <>
            <p>Unresolved operation: {pendingTransaction()?.summary}</p>
            <p>
              A previous transaction is unresolved. A page refresh recovers it;
              do not create another transaction.
            </p>
            <button disabled={busy} onClick={() => void recover(false)}>
              Check transaction result
            </button>
            <button disabled={busy} onClick={() => void recover(true)}>
              Resend the same signed transaction
            </button>
          </>
        )}
      </div>
      <nav className="role-tabs">
        {ROLES.map((key) => (
          <button
            key={key}
            className={`role ${role === key ? "active" : ""}`}
            onClick={() => setRole(key)}
          >
            {roleLabel(key)}
          </button>
        ))}
      </nav>
      <section className="grid">
        {role === "guest" && (
          <>
            <div className="panel wide">
              <h2>My deposit sub-accounts</h2>
              <p className="muted">
                One unresolved rental per passport at a time. Any other unlocked
                asset can be withdrawn freely.
              </p>
              <div className="asset-list">
                {(["SOL", "USDC", "USDT"] as p.Asset[]).map((a) => {
                  const entry = platform
                      ? ownDeposits.find(
                          (e) => e.data.mint === assetMint(a, platform),
                        )?.data
                      : undefined,
                    locked = entry?.locked ?? 0n,
                    available = entry?.available ?? 0n;
                  return (
                    <button
                      key={a}
                      className={`asset-row ${asset === a ? "selected" : ""}`}
                      onClick={() => {
                        setAsset(a);
                        setAmount(a === "SOL" ? "0.1" : "5");
                      }}
                    >
                      <strong>{a}</strong>
                      <span>
                        Available {p.formatAmount(available, a)}
                        <br />
                        Locked {p.formatAmount(entry?.frozen ? 0n : locked, a)}
                      </span>
                      <span>
                        Frozen {p.formatAmount(entry?.frozen ? locked : 0n, a)}
                        <br />
                        Withdrawable{" "}
                        {p.formatAmount(
                          locked || entry?.frozen ? 0n : available,
                          a,
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <label>
                Amount ({asset})
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <div className="actions">
                {button("Deposit", () => balance("deposit"), !platform)}
                {button(
                  "Withdraw to wallet",
                  () => balance("withdraw"),
                  !platform,
                )}
              </div>
              <p className="muted">
                A new lock must leave at least 1 USDC / 1 USDT / 0.01 SOL
                available. The connected wallet pays the network fee and the rent
                for any new account.
              </p>
            </div>
            <div className="panel">
              <h2>Confirm this rental</h2>
              <label>
                Merchant
                <select
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                >
                  <option value="">Select a merchant</option>
                  {state.merchants
                    .filter((e) => e.data.active)
                    .map((e) => (
                      <option key={e.address} value={e.address}>
                        {e.data.name} · {short(e.data.authority)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Item ID
                <input
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                  maxLength={64}
                />
              </label>
              <label>
                Agreed return time
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <p>
                Lock amount: {amount} {asset}
              </p>
              {button(
                "Confirm single-use authorization",
                authorize,
                !merchant || !passport || passport.data.activeLock !== p.ZERO,
              )}
            </div>
          </>
        )}
        {(role === "guest" || role === "merchant") && (
          <div className="panel">
            <h2>
              {role === "merchant"
                ? "Pending guest authorizations"
                : "My rental authorizations"}
            </h2>
            {role === "merchant" && !ownMerchant && (
              <p>This wallet is not a registered merchant.</p>
            )}
            {relevantAuths.length === 0 && <p className="muted">None yet.</p>}
            {relevantAuths.map((row) => {
              const a = row.data,
                deposit = state.deposits.find(
                  (e) => e.address === a.depositAccount,
                ),
                symbol =
                  platform && deposit
                    ? assetFor(deposit.data.mint, platform)
                    : "SOL",
                valid =
                  a.active &&
                  !a.consumed &&
                  a.expiresAt > state.timestamp &&
                  a.dueAt > state.timestamp;
              return (
                <article className="record" key={row.address}>
                  <strong>
                    {a.itemId} · {p.formatAmount(a.amount, symbol)} {symbol}
                  </strong>
                  <p>
                    Guest {short(a.owner)} · due {date(a.dueAt)}
                    <br />
                    Authorized until {date(a.expiresAt)} ·{" "}
                    {a.consumed
                      ? "Used"
                      : !a.active
                        ? "Revoked"
                        : valid
                          ? "Awaiting merchant"
                          : "Expired"}
                  </p>
                  {role === "guest"
                    ? button(
                        "Revoke unused authorization",
                        () =>
                          void act(
                            `Revoke authorization ${row.address}`,
                            async () => [
                              p.getRevokeAuthorizationInstruction({
                                owner: who!,
                                passport: a.passport,
                                depositAccount: a.depositAccount,
                                authorization: row.address,
                              }),
                            ],
                          ),
                        !a.active || a.consumed,
                      )
                    : button(
                        "Accept and lock deposit",
                        () =>
                          void act(
                            `Accept rental: ${a.itemId}\nGuest: ${a.owner}\nLock ${p.formatAmount(a.amount, symbol)} ${symbol}`,
                            async () => [
                              p.getLockDepositInstruction({
                                merchantSigner: who!,
                                passport: a.passport,
                                merchant: a.merchant,
                                depositAccount: a.depositAccount,
                                authorization: row.address,
                                rentalLock: await p.rentalAddress(
                                  a.passport,
                                  a.nonce,
                                ),
                              }),
                            ],
                          ),
                        !valid || !ownMerchant?.data.active,
                      )}
                </article>
              );
            })}
          </div>
        )}
        {role === "merchant" && (
          <div className="panel">
            <h2>Return evidence</h2>
            <label>
              Photo HTTPS URL (optional)
              <input
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
              />
            </label>
            <label>
              Choose a photo to hash its actual file contents
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  setPhotoHash(
                    file
                      ? new Uint8Array(
                          await crypto.subtle.digest(
                            "SHA-256",
                            await file.arrayBuffer(),
                          ),
                        )
                      : new Uint8Array(32),
                  );
                }}
              />
            </label>
            <p className="muted">
              The file is never uploaded; the photo URL is supplied by the
              merchant. The chain stores only the reference, the file hash, the
              status and the timestamps.
            </p>
            <code>
              {Array.from(photoHash, (v) =>
                v.toString(16).padStart(2, "0"),
              ).join("")}
            </code>
          </div>
        )}
        {role !== "operator" && (
          <div className="panel">
            <h2>
              {role === "keeper"
                ? "Rentals past 180 days"
                : "Rentals and returns"}
            </h2>
            {role === "keeper" && (
              <p className="muted">
                The platform operator wallet is expected to submit this and pay
                the network fee. Any wallet may submit and pay its own fee; no fee
                is ever taken from a guest deposit. Frozen rentals cannot time
                out.
              </p>
            )}
            {relevantRentals.length === 0 && <p className="muted">None yet.</p>}
            {relevantRentals.map((row) => {
              const r = row.data,
                eligible =
                  r.status === 0 &&
                  state.timestamp >= r.startedAt + 180n * 86400n;
              const deposit = state.deposits.find(
                (e) => e.address === r.depositAccount,
              );
              const symbol =
                platform && deposit
                  ? assetFor(deposit.data.mint, platform)
                  : "SOL";
              const shop = state.merchants.find(
                (e) => e.address === r.merchant,
              );
              return (
                <article className="record" key={row.address}>
                  <strong>
                    {r.itemId} · {statusNames[r.status] ?? "Unknown status"}
                  </strong>
                  <p>
                    {p.formatAmount(r.amount, symbol)} {symbol} · merchant{" "}
                    {shop?.data.name ?? short(r.merchant)}
                    <br />
                    Guest {short(r.owner)} · started {date(r.startedAt)}
                    <br />
                    Agreed return {date(r.dueAt)} · returned {date(r.returnedAt)}
                    <br />
                    Released {date(r.releasedAt)} · 180 days on{" "}
                    {date(r.startedAt + 180n * 86400n)}
                  </p>
                  {r.photoUrl.startsWith("https://") && (
                    <a href={r.photoUrl} target="_blank" rel="noreferrer">
                      View return photo
                    </a>
                  )}
                  {role === "merchant" && r.status === 0 && (
                    <div className="return-actions">
                      {[
                        "Return in good condition",
                        "Return damaged, freeze",
                        "Report missing, freeze",
                      ].map((label, returnStatus) =>
                        button(label, () =>
                          void act(
                            `${label}: ${r.itemId}\n${returnStatus ? "Freeze only, no deduction" : "Release to the program's available balance, not to a wallet"}`,
                            async () => {
                              if (
                                photoUrl &&
                                (!photoUrl.startsWith("https://") ||
                                  new TextEncoder().encode(photoUrl).length >
                                    256)
                              )
                                throw new Error(
                                  "The photo reference must be HTTPS and at most 256 bytes.",
                                );
                              return [
                                p.getRecordReturnInstruction({
                                  ...rentalAccounts(row),
                                  merchantSigner: who!,
                                  returnStatus,
                                  photoUrl,
                                  photoHash,
                                }),
                              ];
                            },
                          ),
                        ),
                      )}
                    </div>
                  )}
                  {role === "merchant" &&
                    r.status === 2 &&
                    button("Confirm compensation, unfreeze", () =>
                      void act(
                        `Confirm compensation: ${r.itemId}\nThis unfreezes only; no deduction is executed.`,
                        async () => [
                          p.getConfirmCompensatedInstruction({
                            ...rentalAccounts(row),
                            merchantSigner: who!,
                          }),
                        ],
                      ),
                    )}
                  {role === "keeper" &&
                    button(
                      eligible ? "Release to available balance" : "180 days not reached",
                      () =>
                        void act(
                          `180-day keeper release: ${r.itemId}\nGuest: ${r.owner}\nReleases the active lock only, with no penalty; the invoking wallet pays the fee.`,
                          async () => [
                            p.getKeeperReleaseInstruction({
                              ...rentalAccounts(row),
                              keeper: who!,
                            }),
                          ],
                        ),
                      !eligible,
                    )}
                </article>
              );
            })}
          </div>
        )}
        {role === "operator" && (
          <>
            <div className="panel">
              <h2>Platform and merchant management</h2>
              {!platform ? (
                <>
                  <p>
                    Only the program deployment authority can initialize. Use two
                    distinct 6-decimal SPL test mints.
                  </p>
                  <label>
                    USDC test mint
                    <input
                      value={usdc}
                      onChange={(e) => setUsdc(e.target.value)}
                    />
                  </label>
                  <label>
                    USDT test mint
                    <input
                      value={usdt}
                      onChange={(e) => setUsdt(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    {button("Create USDC test mint", () => prepareMint("USDC"))}
                    {button("Create USDT test mint", () => prepareMint("USDT"))}
                  </div>
                  <p className="muted">
                    Enter existing test mints, or create test assets with this
                    wallet. The names are project labels only; they are not real
                    USDC/USDT.
                  </p>
                  {button("Initialize platform", () =>
                    void act(
                      `Initialize platform\nUSDC mint: ${usdc}\nUSDT mint: ${usdt}\nOperator wallet: ${owner}`,
                      async () => [
                        p.getInitializePlatformInstruction({
                          operator: who!,
                          programData: await p.programDataAddress(),
                          platform: await p.platformAddress(),
                          usdcMint: address(usdc),
                          usdtMint: address(usdt),
                        }),
                      ],
                    ),
                  )}
                </>
              ) : (
                <>
                  <p>
                    Operator wallet: {platform.operator}
                    <br />
                    USDC mint: {platform.usdcMint}
                    <br />
                    USDT mint: {platform.usdtMint}
                  </p>
                  {!isOperator && (
                    <p>Switch to the operator wallet to manage.</p>
                  )}
                  <details>
                    <summary>Fund devnet test assets</summary>
                    <p className="muted">
                      Test environments only. This wallet must hold the mint
                      authority of the test mint.
                    </p>
                    <label>
                      Test token recipient
                      <input
                        value={testRecipient}
                        onChange={(e) => setTestRecipient(e.target.value)}
                      />
                    </label>
                    <label>
                      Test token amount
                      <input
                        value={testAmount}
                        onChange={(e) => setTestAmount(e.target.value)}
                      />
                    </label>
                    <div className="actions">
                      {button(
                        "Send USDC test tokens",
                        () => supplyTestTokens("USDC"),
                        !isOperator,
                      )}
                      {button(
                        "Send USDT test tokens",
                        () => supplyTestTokens("USDT"),
                        !isOperator,
                      )}
                    </div>
                  </details>
                  <label>
                    Merchant wallet address
                    <input
                      value={merchantKey}
                      onChange={(e) => setMerchantKey(e.target.value)}
                    />
                  </label>
                  <label>
                    Merchant name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  {button(
                    "Register merchant",
                    () =>
                      void act(
                        `Register merchant: ${name}\nSigning authority wallet: ${merchantKey}`,
                        async () => [
                          p.getRegisterMerchantInstruction({
                            operator: who!,
                            platform: state.platform!.address,
                            merchantKey: address(merchantKey),
                            merchant: await p.merchantAddress(
                              address(merchantKey),
                            ),
                            name,
                          }),
                        ],
                      ),
                    !isOperator,
                  )}
                </>
              )}
            </div>
            <div className="panel">
              <h2>Merchants</h2>
              {state.merchants.map((m) => (
                <article className="record" key={m.address}>
                  <strong>
                    {m.data.name} · {m.data.active ? "Enabled" : "Paused"}
                  </strong>
                  <p>{m.data.authority}</p>
                  {button(
                    m.data.active ? "Pause new rentals" : "Resume new rentals",
                    () =>
                      void act(
                        `${m.data.active ? "Pause" : "Resume"} merchant ${m.data.name}\nHistorical return handling continues.`,
                        async () => [
                          p.getSetMerchantActiveInstruction({
                            operator: who!,
                            platform: state.platform!.address,
                            merchant: m.address,
                            active: !m.data.active,
                          }),
                        ],
                      ),
                    !isOperator,
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        <div className="panel">
          <h2>On-chain activity</h2>
          <div className="actions">
            <button
              disabled={!owner || busy || !fresh}
              onClick={() => void readHistory()}
            >
              Query this role's activity
            </button>
            {cursor && (
              <button disabled={busy} onClick={() => void readHistory(true)}>
                Load older records
              </button>
            )}
          </div>
          {history.map((h, i) => (
            <article className="record" key={`${h.signature}-${i}`}>
              <strong>{actionNames[h.action] ?? "On-chain action"}</strong>
              <p>
                {date(h.timestamp)} · {short(h.actor)}
              </p>
              <code>{h.signature}</code>
            </article>
          ))}
          <p className="muted">
            Status and records come from RPC; they are re-read after a refresh or
            a wallet switch. Writes are paused while the network is failing.
          </p>
        </div>
      </section>
      <footer>
        {LOCAL ? "Localnet" : "Solana devnet"} testing only. Damage and loss
        freeze funds without penalty. The connected wallet pays network fees.
      </footer>
    </main>
  );
}
