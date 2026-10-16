---
artifact: pitch-script
version: "2.0"
created: 2026-10-13
status: ready-to-rehearse
event: Colosseum
duration: 1:30 primary (+ 0:45 emergency cut)
companions: PITCH.md, DEMO-SCRIPT.md, SUBMISSION.md, VERIFICATION.md
---

# Shared Deposit Passport — 90 秒演讲全套

界面是英文，**逐字稿用英文（可直接照读），每段下附中文对照**。总词数 ≈174，按 150 wpm 念约 70 秒，**留 20 秒给钱包确认与交易等待**——90 秒里，沉默的那 20 秒是设计好的，不是失误。

> 事实来源：`VERIFICATION.md`（2026-10-12 devnet + 本地结果）、`SUBMISSION.md`、`PITCH.md`。每个数字可回溯，**不要临场编数字**。

---

## 0. 讲之前先记住三件事

评委只记住三句，就够：

1. **锁定不等于收钱。** 钱从「可用」移到「锁定」，**始终在游客自己账户里**；商户从头到尾不托管押金。
2. **同一笔押金在第二个商户复用，没有再存一分钱。** ← 全场最高光。
3. **真的上链。** 没有后端、没有 demo 模式、没有假状态。

三句主动披露（别等被问）：

- Devnet only，没有真钱。
- **180 天 keeper 释放不在现场演示**——本地时间旅行证明，devnet 改不了时间，我们不伪造。
- 运营方 / keeper 控制台是内部工具，不是用户产品。

---

## 1. 分秒时间轴（1:30）

| 段 | 时间 | 屏幕 | 动作 | 论点 | 实时交易 |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:12 | 标题卡 → Guest `#/guest` | 无 | 问题：四次租借 = 四笔押金 | — |
| 2 | 0:12–0:22 | 资产列表 | 指向 `20 Available / 5 Locked` | 一笔押金，链上直读 | — |
| 3 | 0:22–0:38 | → Bikes `#/merchant` | **Return in good condition** | 钱回护照，不是退款队列 | tx 1 |
| 4 | 0:38–0:46 | → Guest `#/guest` | 指向 Camping 待接受授权 | 授权已存在，且**未动钱** | — |
| 5 | **0:46–1:06** | → Camping `#/merchant` → Guest | **Accept and lock deposit** → **Return in good condition** | **同一笔钱，第二商户，零再存入** | tx 2, tx 3 |
| 6 | 1:06–1:14 | Guest `#/guest` | **Withdraw to wallet** | 未锁定资产可提 | tx 4 ★可删 |
| 7 | 1:14–1:22 | 编辑器 / 测试运行 | 切 `product.spec.ts`、`VERIFICATION.md` | 不是 happy-path 原型 | — |
| 8 | 1:22–1:30 | 标题卡 | — | 一句话收尾 | — |

**铁律**：Demo 占 0:22–1:14（52 秒，超过一半）。★ 如果进度落后，**删第 6 段**（提取），直接跳第 7、8 段——收尾永远不能省。

---

## 2. 逐字稿（照读版）

### 段 1 — 问题（0:00–0:12）

> Rent four things in one day and you pay four deposits — four payments, four refunds, four waits. **The deposit is the friction, not the rental.**

**中文**：一天租四样东西，交四次押金——四次付款、四次退款、四次等待。**摩擦不是租金，是押金。**

### 段 2 — 方案（0:12–0:22）

> One deposit, held by a Solana program, reusable at every merchant. Everything you see is read straight from chain: **twenty available, five locked.**

**中文**：一笔押金，由 Solana 程序持有，每个商户都能复用。屏幕上所有数字直接读链：**20 可用，5 锁定。**

### 段 3 — 归还即释放（0:22–0:38）

> The merchant returns the item in good condition. That's it — **the money releases back to the passport.** Not to the merchant, not a refund queue: twenty available again.

**中文**：商户确认完好归还。就这样——**钱释放回护照**。没打给商户，没进退款队列：又是 20 可用。

### 段 4 — 授权已存在（0:38–0:46）

> Now the second merchant. The guest already authorized it: one merchant, one item, one amount — and **no funds moved.**

**中文**：现在换第二个商户。游客已经授权过：一个商户、一件物品、一个金额——而且**一分钱都没动。**

### 段 5 — MONEY SHOT（0:46–1:06）

> Accept and lock — **the only moment money moves, and only from available to locked, inside the guest's own account.** Returned, and it's back. **Same twenty dollars, second merchant, zero re-deposited.**

**中文**：接受并锁定——**这是唯一动钱的时刻，而且只是从「可用」到「锁定」，还在游客自己账户里。** 归还，钱就回来了。**还是那 20 美元，第二个商户，再存入为零。**

### 段 6 — 提取（1:06–1:14）★可删

> The guest withdraws what isn't locked — one asset can leave while another is still locked.

**中文**：游客把未锁定的部分提走——一种资产可以提，另一种仍锁在租借里。

### 段 7 — 可信度（1:14–1:22）

> Real SBF tests reject replayed nonces, wrong signers, expired authorizations, concurrent locks. **Not a happy-path prototype.**

**中文**：真实 SBF 测试会拒绝重放 nonce、错误签名者、过期授权、并发锁定。**不是只跑通顺路的原型。**

### 段 8 — 收尾（1:22–1:30）

> Shared Deposit Passport: **pay a deposit once, rent from every merchant.** Devnet today, no real funds.

**中文**：共享押金护照：**存一次押金，租遍所有商户。** 今天是 devnet，没有真钱。

---

## 3. 45 秒急救版（超时/被打断时用）

预置：**两笔租借都已完成锁定**，只剩镜头前的归还。

> Rent four things in one day, you pay four deposits — four payments, four refunds, four waits.
> Here is **one deposit**, held by a Solana program, reusable at every merchant. This merchant can only **lock** five dollars — never hold it. Return it, and it releases straight back: twenty available.
> Now the second merchant, **same twenty dollars — zero re-deposited.** Returned, and it's whole again.
> Real SBF tests reject replayed nonces, wrong signers, expired authorizations, concurrent locks. The 180-day keeper is proven by time travel, not faked.
> **Pay a deposit once. Rent from every merchant.** Devnet today.

---

## 4. Demo 操作脚本（点击级）

### 4.1 上台前：预置状态（不占用 90 秒）

90 秒装不下 setup，所以下面这些**必须在录制/上台前完成**：

| 预置项 | 目标状态 |
| --- | --- |
| 游客 | 已存 **20 USDC**（Passport + DepositAccount 已建） |
| `Bikes` | 租借 **bike-42 已 ACTIVE、5 USDC 已锁定** |
| `Camping` | 授权 **已存在、待接受**（`Awaiting merchant`），tent-7，5 USDC |
| Phantom | 切到 **Devnet**，选中 **Guest**，页面在 `#/guest` |
| 顶栏 | `On-chain state synced · slot N` |

> 为什么可以把 Bikes 预置成已锁定？因为「锁定」这一动作**在 Camping 那一步会实时点给你看**（段 5 的 `Accept and lock deposit`）。两点都保住了，还省下一整轮交易。

**环境**：四个账户各自有 devnet SOL（0 SOL 会在 simulation 阶段失败，而不是提示余额不足）；浏览器 1440×900、缩放 110%、无书签栏、干净 profile；关系统通知；静音录屏 + 二次配音。

### 4.2 点击序列

| 步 | 段 | 角色 | 精确操作 |
| --- | --- | --- | --- |
| 0 | 1–2 | Guest | 起始画面，指向 `20 Available / 5 Locked` |
| 1 | 3 | 切 **Bikes** → `#/merchant` | **Return in good condition** ← tx 1 |
| 2 | 4 | 切 **Guest** → `#/guest` | 指向 Camping 的待接受授权（`Awaiting merchant`） |
| 3 | 5 | 切 **Camping** → `#/merchant` | **Accept and lock deposit** ← tx 2（旁白念「唯一动钱点」） |
| 4 | 5 | Camping | **Return in good condition** ← tx 3 |
| 5 | 5 | 切 **Guest** → `#/guest` | 定格 `20 Available` |
| 6 | 6 ★ | Guest | USDC 行勾选、Amount=`5` → **Withdraw to wallet** ← tx 4（可删） |
| 7 | 7 | — | 切编辑器 `app/e2e/product.spec.ts`、`VERIFICATION.md` |
| 8 | 8 | — | 标题卡 |

**实时交易 4 笔（1 笔可删），总计 ≈28 秒**，正好被旁白的空档吸收。这就是那 20 秒余量的用途。

### 4.3 角色切换铁律（最容易翻车）

**一次换角色 = 两个动作：**

1. Phantom 扩展里切 active account；
2. 回页面点对应控制台标签。

原因（见 `DEMO-SCRIPT.md`）：钱包只在你**还没自己选过控制台**时决定落点；一旦点过标签，选择被固定，之后切账户**不会**跳转。

**兜底**：切账户后顶栏地址没变 → 用地址栏深链（`#/merchant`、`#/guest`），或一角色一浏览器 profile。

### 4.4 现场出错怎么办

| 故障 | 处置 |
| --- | --- |
| devnet RPC 超时 | 说一句「RPC 慢，切本地同一份程序」，`cd app && npm run demo`（同一 `.so`、真实签名、真实执行，**说明这是本地验证器**） |
| 交易结果不确定 | **先查已保存的签名**，别重复提交；页面保存了签名与已签名字节 |
| 钱包弹窗不弹 | 检查账户是否正确、是否有 SOL 付手续费 |
| `On-chain state unconfirmed` | 这是保护：写操作被禁用。刷新一次，仍失败走本地兜底 |
| 进度落后 | **删第 6 段（提取）**，直接跳 7、8 |
| 只剩余 45 秒 | 切第 3 节「急救版」，只做一次归还 |

### 4.5 绝对不要做

- 不要演示 operator 建 mint / 注册商户（内部工具，吃掉你的时间）。
- 不要在镜头前演示钱包拒签、RPC 报错、或那条**故意制造**的网络错误 console 日志。
- 别说「商户拿走了押金」（**错的**，见段 4/5）。
- 不要说屏幕上没有的 item ID。
- 不要超 1:30。宁短勿超。

### 4.6 上台前 60 秒自检

- [ ] 起始画面 = Guest + `#/guest` + `20 Available / 5 Locked`，Bikes 租借 ACTIVE，Camping 授权 PENDING
- [ ] Phantom 在 Devnet，四个账户都有 SOL
- [ ] 计时器 + 静音录屏已开
- [ ] 记得三件事（锁定≠收钱 / 第二商户零再存入 / 真的上链）
- [ ] 记得三句披露（devnet / 180 天不现场演示 / 运营台是内部工具）
- [ ] 兜底命令在手边：`cd app && npm run demo`

---

## 5. QA 预案

> QA 不受 90 秒限制，但**每个回答以 15 秒为上限**：先给结论，再给理由。

### 回答三原则

1. **先给结论，再给理由。**
2. **不知道就说不知道**，并说「我会怎么验证」。
3. **区分「已实现」和「有意不做」**——v1 之外的东西是**故意不做**，不是「还没做」。

### 产品与需求

**Q1. 冷启动怎么办，商户没接入谁会用？**
> 冷启动靠**密度**不靠总量：一个旅游街区、20–50 个商户、一个租借品类。游客只在下一个商户也接受时才会持有护照，所以先做一个街区。下一步就是设计合作方：5–10 个商户、单一品类。

**Q2. 商户图什么？**
> 他今天已经在承担押金的成本：人工退款、拒付争议、员工处理时间。我们把这笔成本换成程序规则。v1 免费；商业形态是向商户收押金体量的 take rate，替掉他现在的退款管理成本——他省钱，我们拿一部分省下来的。

**Q3. 和信用卡预授权有什么区别？**
> 三点：押金是**游客持有的余额**，不是商户侧的一次性冻结；可以**跨商户复用**，预授权做不到；规则是**共享的一份**（最低余额、损坏冻结、180 天超时），不是每个商户各写一套政策。

**Q4. 这和 escrow / 押金池有什么不同？**
> 不托管、不借出、不吃利息（float 不是商业模式）。资金一直在程序里，直到游客自己提取。商户只有「锁定」一个权力，且只能锁游客点名授权的额度。

### 商业与市场

**Q5. 怎么赚钱？**
> v1 不赚钱，是刻意的。形态：对押金体量向商户收 take rate（替代他的人工退款成本）+ 商户侧 SaaS（库存、归还凭证、争议记录）。押金是楔子，租借台才是产品。

**Q6. 护城河是什么，合约不是谁都能抄？**

> 护城河不是程序，是**双边网络和规则集**：受信商户 allowlist、所有商户共同遵守的一份规则、双方共享的审计轨迹、以及「我余额在这儿，就优先选接受它的商户」。卡组织能复制支付，复制不了**游客拥有、可携带、跨商户**的押金余额。

### 技术

**Q7. 这用个数据库不就行了，为什么要链？**
> 因为需要**多个互不信任的商户**信任同一份押金状态，而没有一方该独占它。中心化押金池 = 你信任运营方不挪用——这正是今天的问题本身。链上程序是唯一权威：没有后端、数据库、索引器在信任路径里。

**Q8. 为什么是 Solana？**
> 两个**产品级**要求：单次动作成本必须接近于零（一笔租借 2–3 次上链动作，5–50 美元押金吸收不了有意义的费用）；确认必须亚秒级——锁要能在客人**站在柜台前**完成。多链刻意排除：护照只有在所有商户结算**同一个**余额时才成立。

**Q9. 为什么只允许一笔全局活动锁定？**
> v1 的**安全决定**，不是能力缺失——先把并发、重复、幂等这类资金风险掐掉。并发锁定留给真实商户流程验证后再评估。已经支持的是：**未锁定资产不受影响**（USDC 锁着时 USDT/SOL 仍可提取）。

**Q10. 精度、最低余额这些细节怎么保证？**
> Mint 走 allowlist，只接受平台登记的 mint（拒绝同名恶意资产），精度逐资产校验并单独测试。最低余额 USDC 1 / USDT 1 / SOL 0.01，低于它的锁定被程序直接拒绝。金额用 u64 原生精度，输入层有测试防精度丢失和小数位强转。

**Q11. 交易失败/超时会不会重复扣钱？**
> 这是重点测的场景。客户端**发送前保存已签名字节**，结果不确定时先**查原签名**，只在有效期内重发**同一份字节**。测试里故意在 validator 执行完之后丢弃 RPC 响应，断言新写入被阻断、刷新后解析回原签名，且余额**只增加一次**。

**Q12. 前端会不会伪造状态？**
> 不会，前端不产生状态。所有余额直接读链；有 genesis 校验，RPC 不是真 devnet 就禁用资金操作。UI 有 `On-chain state unconfirmed` 状态，此时写操作被禁用直到刷新成功。

**Q13. 归还凭证怎么存？**
> 照片原件不上链。链上存 HTTPS 引用（≤256 字节）+ 文件内容的 SHA-256（浏览器本地算）。哈希算的是**文件内容**，不是 URL。v1 不提供上传服务，托管由商户负责。

### 安全与治理

**Q14. Operator 是单密钥，中心化风险？**
> 是，我们把它写在「下一步」而不是藏起来：多签 operator、商户自助入驻。当前 operator 就是 program 的 upgrade authority。这是 v1 为跑起来做的取舍。

**Q15. 商户单方说「已赔偿」就解冻，不可信吧？**
> 对，这是**已知风险**，PRD 明确记录（M 概率 / H 影响）。注意它**不扣钱**：损坏/遗失只冻结、不划扣，只有原商户确认赔偿后才解冻回可用。生产治理方案是游客确认 + 凭证 + 仲裁，是明确的 roadmap 项。

**Q16. 180 天超时会不会被滥用？**
> 反过来：它是**防止资金被永久卡住**的兜底。Active 且满 180 天无人操作时**任何人**都能提交释放，程序自行校验时间、状态、唯一性。keeper 拿不走押金，也不从押金扣费。而且冻结态**不适用**超时释放，必须等赔偿确认。

**Q17. 你们碰私钥吗？合约可升级吗？**
> 不碰私钥，平台不托管游客私钥，签名是标准钱包签名。现在合约可被 upgrade authority 升级——和 Q14 是同一个中心化取舍，roadmap 是多签。仓库里没有任何 keypair、助记词或 `.env`。

### 进度与真实性（最容易被追问）

**Q18. 现在跑到哪一步了，哪些是真的？**
> Program 已部署并在 devnet 初始化，2 个商户、游客已充值 100 USDC + 100 USDT，客户全流程已在 devnet **跑通一次**（一笔护照、两笔已消费授权、两笔已归还锁定）。本地：**32 个自动化测试（5 文件，含 7 组真实 SBF 场景）通过；3 个浏览器端到端测试通过**（真实 Wallet Standard 合成钱包、真实签名、真实 validator）。**没有**真实用户、没有商户意向书、没有收入。

**Q19. 180 天那步演示不了，是不是没做？**
> 做了且被测：本地用**时间旅行**验证满 180 天释放、以及「冻结态 180 天后仍不释放」。devnet 不能改时间，所以我们**不演示也不伪造**——这本身就是可信度的一部分。

**Q20. 测试数字可复现吗？**
> 可以，无需私钥、无需网络：`cd app && npm install && npm test && npm run test:e2e`。套件自己起 validator 并部署编译好的程序。`VERIFICATION.md` 里连程序 `.so` 的 SHA-256 都写了，且能从 devnet ProgramData 账户独立重算。

> ⚠️ **对外前必须统一**：`VERIFICATION.md` = 32 测试（5 文件），`SUBMISSION.md` = 「10 tests, including 7 grouped scenarios」。实测 `tests/` = 10+7+8+3+4 = 32。**先改 `SUBMISSION.md`**，否则被问数字自相矛盾。

### 答不上来时

> That is not something we have measured yet. I do not know the number. What I would do to find out is ⟨具体一步⟩ — and I would rather tell you that than guess.

中文：这个还没测过，我不知道具体数字。要弄清它我会⟨具体动作⟩——我宁愿这么说，也不想编。

**红线**：任何涉及「押金被扣款/罚款/抽成」的问题，正确回答永远是——v1 **只锁不扣**；扣款属于需产品负责人 + 安全负责人批准的变更。
