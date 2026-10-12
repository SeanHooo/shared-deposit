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
const rpc = makeRpc(RPC_URL);
const statusNames = ["租借中", "正常归还", "冻结", "已赔偿解冻", "超时释放"];
const actionNames = [
  "平台初始化",
  "创建 Passport",
  "创建资产账户",
  "存入",
  "提取",
  "登记商户",
  "更新商户",
  "租借授权",
  "撤销授权",
  "锁定",
  "正常归还",
  "冻结",
  "已赔偿解冻",
  "超时释放",
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
  const [role, setRole] = useState("guest"),
    [asset, setAsset] = useState<p.Asset>("SOL");
  const [amount, setAmount] = useState("0.1"),
    [merchant, setMerchant] = useState(""),
    [item, setItem] = useState(""),
    [due, setDue] = useState("");
  const [photoUrl, setPhotoUrl] = useState(""),
    [photoHash, setPhotoHash] = useState(new Uint8Array(32));
  const [merchantKey, setMerchantKey] = useState(""),
    [name, setName] = useState(""),
    [usdc, setUsdc] = useState(""),
    [usdt, setUsdt] = useState("");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("正在读取链上状态…");
  const [history, setHistory] = useState<HistoryRow[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const epoch = useRef(0);
  const historyQuery = useRef(0);
  const [testRecipient, setTestRecipient] = useState(""),
    [testAmount, setTestAmount] = useState("100");
  const activeAction = useRef(false);
  const refresh = useCallback(async () => {
    const generation = epoch.current;
    try {
      await assertNetwork(rpc, LOCAL);
      const next = await loadSnapshot(rpc);
      if (epoch.current === generation) {
        setState((current) => (next.slot >= current.slot ? next : current));
        setFresh(true);
        setNotice((current) =>
          current.startsWith("正在读取链上状态") ||
          current.startsWith("读取失败")
            ? "链上状态已同步。"
            : current,
        );
      }
    } catch (error) {
      if (epoch.current === generation) {
        setFresh(false);
        setNotice(`读取失败，资金操作已暂停：${String(error)}`);
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
  async function act(
    summary: string | (() => string),
    build: () => Promise<Instruction[]>,
    confirmed?: () => void,
  ) {
    if (blocked || activeAction.current) return;
    activeAction.current = true;
    setBusy(true);
    setNotice("正在校验并模拟交易…");
    try {
      const instructions = await build();
      const result = await submitTransaction(
        who!,
        instructions,
        typeof summary === "function" ? summary() : summary,
        connected?.supportedTransactionVersions.has(1) ? 1 : 0,
      );
      setNotice(result);
      if (result.startsWith("链上已确认")) confirmed?.();
    } catch (error) {
      setNotice(
        `${String(error)}${pendingTransaction() ? "；已保存交易签名，请先查询结果。" : ""}`,
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
        `创建 ${symbol} 测试 mint：${mint}\n精度 6；铸币权限：${owner}\n仅测试资产，没有真实稳定币价值。`,
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
      `发放 ${testAmount} ${symbol} 测试币\n接收钱包：${testRecipient}\n运营钱包支付网络费及接收账户租金；不修改任何押金。`,
      async () => {
        if (!platform) throw new Error("平台尚未初始化。");
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
      setNotice(String(e));
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
      if (!target) throw new Error("当前角色还没有链上账户。");
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
      if (historyQuery.current === query) setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  function balance(action: "deposit" | "withdraw") {
    void act(
      `${action === "deposit" ? "存入程序押金账户" : "提取到当前游客钱包"}：${amount} ${asset}\n游客：${owner}`,
      async () => {
        if (!platform) throw new Error("平台尚未初始化。");
        const mint = assetMint(asset, platform),
          account = await p.depositAddress(owner!, mint),
          existing = ownDeposits.find((e) => e.address === account);
        if (action === "withdraw" && !existing)
          throw new Error("尚未创建该资产账户。");
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
      `单次租借授权：${amount} ${asset}\n商户账户：${merchant}\n物品：${item}\n约定归还：${due}\n有效期一年；正常释放回程序余额，提取需另行签名。`,
      async () => {
        if (!passport || !platform) throw new Error("请先存入押金。");
        if (!item.trim() || new TextEncoder().encode(item).length > 64)
          throw new Error("物品 ID 必填且不超过 64 字节。");
        const seconds = Math.floor(new Date(due).getTime() / 1000);
        if (!Number.isFinite(seconds) || seconds <= Number(state.timestamp))
          throw new Error("请选择未来归还时间。");
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
          <h1>一笔押金，跨商户复用。</h1>
          <p className="lead">
            存入 → 单次授权 → 商户锁定 → 归还释放 → 再次租借或提取
          </p>
        </div>
        <div className="wallets">
          {connected ? (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => disconnect()}
            >
              断开 {short(connected.account.address)}
            </button>
          ) : wallets.length ? (
            wallets.map((wallet) => (
              <button
                className="button primary"
                key={wallet.name}
                onClick={() => connect(wallet)}
              >
                连接 {wallet.name}
              </button>
            ))
          ) : (
            <p>请安装支持 Solana 的钱包，然后刷新页面。</p>
          )}
        </div>
      </header>
      <section className="hero-band">
        <span>
          {fresh ? `链上已同步 · slot ${state.slot}` : "链上状态未确认"}
        </span>
        <span>{owner ?? "尚未连接钱包"}</span>
        <button onClick={() => void refresh()} disabled={busy}>
          刷新
        </button>
      </section>
      <div className="panel notice-panel" role="status">
        <p>{notice}</p>
        {!state.deployed && fresh && (
          <p>程序尚未部署。请按 README 完成 devnet 部署后初始化平台。</p>
        )}
        {state.deployed && !platform && (
          <p>平台尚未初始化，请部署权限钱包进入运营方页面配置两个测试 mint。</p>
        )}
        {pendingTransaction() && (
          <>
            <p>待确认操作：{pendingTransaction()?.summary}</p>
            <p>上一笔交易结果待确认。刷新页面仍可恢复；请勿重新创建交易。</p>
            <button disabled={busy} onClick={() => void recover(false)}>
              查询交易结果
            </button>
            <button disabled={busy} onClick={() => void recover(true)}>
              重发同一已签名交易
            </button>
          </>
        )}
      </div>
      <nav className="role-tabs">
        {[
          ["guest", "游客"],
          ["merchant", "商户"],
          ["operator", "运营方"],
          ["keeper", "超时释放"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`role ${role === key ? "active" : ""}`}
            onClick={() => {
              historyQuery.current++;
              setRole(key);
              setHistory([]);
              setCursor(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="grid">
        {role === "guest" && (
          <>
            <div className="panel wide">
              <h2>我的押金子账户</h2>
              <p className="muted">
                同一 Passport 最多一笔未解决的租借；其他未锁定资产可自由提取。
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
                        可用 {p.formatAmount(available, a)}
                        <br />
                        锁定 {p.formatAmount(entry?.frozen ? 0n : locked, a)}
                      </span>
                      <span>
                        冻结 {p.formatAmount(entry?.frozen ? locked : 0n, a)}
                        <br />
                        可提取{" "}
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
                金额（{asset}）
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <div className="actions">
                {button("存入", () => balance("deposit"), !platform)}
                {button("提取到钱包", () => balance("withdraw"), !platform)}
              </div>
              <p className="muted">
                新锁定需额外保留 1 USDC / 1 USDT / 0.01
                SOL。当前签名钱包支付网络费及新账户租金。
              </p>
            </div>
            <div className="panel">
              <h2>确认本次租借</h2>
              <label>
                合作商户
                <select
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                >
                  <option value="">请选择商户</option>
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
                物品 ID
                <input
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                  maxLength={64}
                />
              </label>
              <label>
                约定归还时间
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <p>
                锁定金额：{amount} {asset}
              </p>
              {button(
                "确认单次授权，等待商户接受",
                authorize,
                !merchant || !passport || passport.data.activeLock !== p.ZERO,
              )}
            </div>
          </>
        )}
        {(role === "guest" || role === "merchant") && (
          <div className="panel">
            <h2>{role === "merchant" ? "待处理游客授权" : "我的租借授权"}</h2>
            {role === "merchant" && !ownMerchant && (
              <p>当前钱包不是已登记商户。</p>
            )}
            {relevantAuths.length === 0 && <p className="muted">暂无授权。</p>}
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
                    游客 {short(a.owner)} · 归还 {date(a.dueAt)}
                    <br />
                    授权截至 {date(a.expiresAt)} ·{" "}
                    {a.consumed
                      ? "已使用"
                      : !a.active
                        ? "已撤销"
                        : valid
                          ? "待商户接受"
                          : "已过期"}
                  </p>
                  {role === "guest"
                    ? button(
                        "撤销未使用授权",
                        () =>
                          void act(`撤销授权 ${row.address}`, async () => [
                            p.getRevokeAuthorizationInstruction({
                              owner: who!,
                              passport: a.passport,
                              depositAccount: a.depositAccount,
                              authorization: row.address,
                            }),
                          ]),
                        !a.active || a.consumed,
                      )
                    : button(
                        "接受并锁定押金",
                        () =>
                          void act(
                            `接受租借：${a.itemId}\n游客：${a.owner}\n锁定 ${p.formatAmount(a.amount, symbol)} ${symbol}`,
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
            <h2>归还证据</h2>
            <label>
              照片 HTTPS 地址（可选）
              <input
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
              />
            </label>
            <label>
              选择照片，计算实际文件 SHA-256
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
              文件不会上传；照片地址由商户提供。链上只保存引用、文件哈希、状态和时间。
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
            <h2>{role === "keeper" ? "180 天到期锁定" : "租借与归还记录"}</h2>
            {role === "keeper" && (
              <p className="muted">
                建议由平台运营钱包提交并承担网络费。任何钱包都可自付网络费调用，费用不会从游客押金扣除。冻结租借不能超时释放。
              </p>
            )}
            {relevantRentals.length === 0 && (
              <p className="muted">暂无记录。</p>
            )}
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
                    {r.itemId} · {statusNames[r.status] ?? "未知状态"}
                  </strong>
                  <p>
                    {p.formatAmount(r.amount, symbol)} {symbol} · 商户{" "}
                    {shop?.data.name ?? short(r.merchant)}
                    <br />
                    游客 {short(r.owner)} · 开始 {date(r.startedAt)}
                    <br />
                    约定归还 {date(r.dueAt)} · 已归还 {date(r.returnedAt)}
                    <br />
                    释放 {date(r.releasedAt)} · 180 天到期{" "}
                    {date(r.startedAt + 180n * 86400n)}
                  </p>
                  {r.photoUrl.startsWith("https://") && (
                    <a href={r.photoUrl} target="_blank" rel="noreferrer">
                      查看归还照片
                    </a>
                  )}
                  {role === "merchant" && r.status === 0 && (
                    <div className="return-actions">
                      {["正常归还", "损坏并冻结", "遗失并冻结"].map(
                        (label, returnStatus) =>
                          button(
                            label,
                            () =>
                              void act(
                                `${label}：${r.itemId}\n${returnStatus ? "仅冻结，不扣款" : "释放到程序可用余额，不转出钱包"}`,
                                async () => {
                                  if (
                                    photoUrl &&
                                    (!photoUrl.startsWith("https://") ||
                                      new TextEncoder().encode(photoUrl)
                                        .length > 256)
                                  )
                                    throw new Error(
                                      "照片引用必须是 HTTPS，最多 256 字节。",
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
                    button(
                      "确认已赔偿，解冻回程序余额",
                      () =>
                        void act(
                          `确认已赔偿：${r.itemId}\n此操作只解冻，不执行扣款。`,
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
                      eligible ? "释放到程序可用余额" : "未满 180 天",
                      () =>
                        void act(
                          `180 天超时释放：${r.itemId}\n游客：${r.owner}\n仅释放活动锁定，不扣押金；调用钱包支付手续费。`,
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
              <h2>平台与合作商户管理</h2>
              {!platform ? (
                <>
                  <p>
                    仅程序部署权限钱包可初始化。请使用两个不同的 6 位精度 SPL
                    测试 mint。
                  </p>
                  <label>
                    USDC 测试 mint
                    <input
                      value={usdc}
                      onChange={(e) => setUsdc(e.target.value)}
                    />
                  </label>
                  <label>
                    USDT 测试 mint
                    <input
                      value={usdt}
                      onChange={(e) => setUsdt(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    {button("创建 USDC 测试 mint", () => prepareMint("USDC"))}
                    {button("创建 USDT 测试 mint", () => prepareMint("USDT"))}
                  </div>
                  <p className="muted">
                    可填写已有测试
                    mint，或由当前钱包创建测试资产。名称仅是本项目标签，不代表真实
                    USDC/USDT。
                  </p>
                  {button(
                    "初始化平台",
                    () =>
                      void act(
                        `初始化平台\nUSDC mint：${usdc}\nUSDT mint：${usdt}\n运营钱包：${owner}`,
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
                    运营钱包：{platform.operator}
                    <br />
                    USDC mint：{platform.usdcMint}
                    <br />
                    USDT mint：{platform.usdtMint}
                  </p>
                  {!isOperator && <p>请切换到运营钱包进行管理。</p>}
                  <details>
                    <summary>发放 devnet 测试资产</summary>
                    <p className="muted">
                      仅测试环境使用。需要当前钱包持有测试 mint 的铸币权限。
                    </p>
                    <label>
                      测试币接收钱包
                      <input
                        value={testRecipient}
                        onChange={(e) => setTestRecipient(e.target.value)}
                      />
                    </label>
                    <label>
                      测试币金额
                      <input
                        value={testAmount}
                        onChange={(e) => setTestAmount(e.target.value)}
                      />
                    </label>
                    <div className="actions">
                      {button(
                        "发放 USDC 测试币",
                        () => supplyTestTokens("USDC"),
                        !isOperator,
                      )}
                      {button(
                        "发放 USDT 测试币",
                        () => supplyTestTokens("USDT"),
                        !isOperator,
                      )}
                    </div>
                  </details>
                  <label>
                    商户钱包地址
                    <input
                      value={merchantKey}
                      onChange={(e) => setMerchantKey(e.target.value)}
                    />
                  </label>
                  <label>
                    商户名称
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  {button(
                    "登记合作商户",
                    () =>
                      void act(
                        `登记商户：${name}\n签名权限钱包：${merchantKey}`,
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
              <h2>商户名单</h2>
              {state.merchants.map((m) => (
                <article className="record" key={m.address}>
                  <strong>
                    {m.data.name} · {m.data.active ? "已启用" : "已暂停"}
                  </strong>
                  <p>{m.data.authority}</p>
                  {button(
                    m.data.active ? "暂停新租借" : "恢复新租借",
                    () =>
                      void act(
                        `${m.data.active ? "暂停" : "恢复"}商户 ${m.data.name}\n历史归还处理仍可继续。`,
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
          <h2>链上活动记录</h2>
          <div className="actions">
            <button
              disabled={!owner || busy || !fresh}
              onClick={() => void readHistory()}
            >
              查询当前角色记录
            </button>
            {cursor && (
              <button disabled={busy} onClick={() => void readHistory(true)}>
                加载更早记录
              </button>
            )}
          </div>
          {history.map((h, i) => (
            <article className="record" key={`${h.signature}-${i}`}>
              <strong>{actionNames[h.action] ?? "链上操作"}</strong>
              <p>
                {date(h.timestamp)} · {short(h.actor)}
              </p>
              <code>{h.signature}</code>
            </article>
          ))}
          <p className="muted">
            状态和记录来自 RPC；刷新或切换钱包后重新读取。网络错误时暂停写入。
          </p>
        </div>
      </section>
      <footer>
        仅供 {LOCAL ? "Localnet" : "Solana devnet"}{" "}
        测试。损坏与遗失只冻结，不罚扣。当前签名钱包承担网络费。
      </footer>
    </main>
  );
}
