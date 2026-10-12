---
artifact: prd
version: "1.0"
created: 2026-10-07
status: draft
---

# PRD: Shared Deposit Passport

## Overview

### Problem Statement

游客在不同商户租借自行车、储物柜、露营设备或充电宝时，通常需要重复支付和等待押金处理。第一版验证一个统一的 Solana 押金 Passport：游客存入一次押金，商户按游客每次确认的授权锁定额度，归还后释放到 Passport 可用余额，游客可以继续使用其它商户。

### Solution Summary

在 Solana devnet 上建立一个由程序控制的押金 Passport。每个游客可以创建 USDC、USDT、SOL 子账户；同一 Passport 全局最多一笔活动锁定。正常归还、180 天超时释放或赔偿确认都会把资金回到对应子账户的可用余额，游客在允许时主动提取到钱包。

### Target Users

- 游客：连接自己的 Solana 钱包，存入、授权、租借、查看状态和提取押金。
- 合作商户：创建租借记录、锁定额度、提交归还状态。
- 平台运营方：维护商户 allowlist、处理商户状态和运行 keeper。

## Goals & Success Metrics

### Goals

1. 验证一笔押金在多个商户间连续复用的资金流程。
2. 验证商户只能在游客确认和程序规则范围内锁定额度。
3. 验证正常归还、180 天超时、损坏/遗失冻结三类状态转换可审计且不可重复执行。

### Success Metrics

| Metric | Current Baseline | Target | Timeline |
| --- | --- | --- | --- |
| 核心 devnet 流程通过率 | 0（未实现） | 3 种资产均完成存入、授权、锁定、归还、释放和提取演示 | MVP 验收 |
| 未授权或重复状态转换 | 未实现 | 0 次成功；所有越权、重复、并发锁定请求被拒绝 | MVP 验收 |
| 资金状态可追溯性 | 未实现 | 每笔存入、授权、锁定、归还、释放、冻结和解冻均可查询 | MVP 验收 |
| 关键异常恢复 | 未实现 | 覆盖 RPC 超时、180 天 keeper、损坏/遗失冻结和未锁定资产提取 | MVP 验收 |

### Non-Goals

- 主网真实资金、法币入金、钱包托管和多链支持。
- 租金、消费金额、商户结算、佣金和自动罚扣。
- 损坏/遗失争议仲裁、保险和链上赔偿结算。
- 物联网开锁、设备遥测、动态定价和信用评分。

## User Stories

| ID | User Story | Priority |
| --- | --- | --- |
| US-1 | 作为游客，我希望为 USDC、USDT 或 SOL 创建押金子账户并存入押金，以便使用合作商户服务。 | P0 |
| US-2 | 作为游客，我希望每次租借前确认商户、物品和金额，以便明确授权范围。 | P0 |
| US-3 | 作为商户，我希望在有效授权和可用余额范围内锁定额度，以便开始租借。 | P0 |
| US-4 | 作为商户，我希望提交正常归还、损坏或遗失状态，以便系统正确释放或冻结押金。 | P0 |
| US-5 | 作为游客，我希望看到可用、锁定、冻结和可提取余额，以便知道资金当前能否使用。 | P1 |
| US-6 | 作为平台运营方，我希望 keeper 在商户 180 天未操作时释放活动锁定，以便押金不会永久卡住。 | P1 |

## Scope

### In Scope

- Solana devnet 押金 Passport 和 USDC/USDT/SOL 子账户。
- 平台商户 allowlist、游客钱包连接、每次租借授权和一年有效期。
- 单一全局活动锁定、最低剩余余额：USDC 1、USDT 1、SOL 0.01。
- 正常归还释放到程序可用余额；无锁定时游客可提取到钱包。
- 180 天未操作时 keeper 释放；损坏/遗失冻结，商户确认已赔偿后解冻。
- 归还状态、时间和照片 URL/内容哈希的记录与查询。
- 关键链上事件和基本索引展示。

### Out of Scope

- 活动锁定期间追加押金或追加锁定。
- 任意 Token 接入、汇率换算和多币种统一计价。
- 商户自助入驻、商户结算和赔偿凭证审核。
- 主网部署、生产级监控、客服和合规系统。

### Future Considerations

- 多笔并发锁定：需要重新评估风险和用户价值。
- 赔偿凭证、游客确认和争议仲裁：解决商户单方“已赔偿”确认的信任风险。
- 商户多签、紧急冻结和正式运营权限模型。

## Solution Design

### Functional Requirements

#### 押金账户与提取

- **FR-1：** 系统必须允许游客分别创建 USDC、USDT、SOL 子账户，并只接受平台登记的资产 mint/原生 SOL。
- **FR-2：** 游客可以存入押金；未被锁定或冻结的资产子账户可以提取可用余额到自己的钱包，即使另一资产子账户仍有活动锁定。
- **FR-3：** 活动锁定期间，被锁定资产子账户必须保留最低余额：USDC 1、USDT 1、SOL 0.01；其它未锁定资产子账户仍可自由提取。

#### 商户授权与锁定

- **FR-4：** 只有平台 allowlist 中的有效商户可以创建租借记录。
- **FR-5：** 每次租借必须由游客确认，确认至少绑定游客、商户、资产子账户、物品 ID、金额、有效期、nonce 和规则版本；授权有效期暂定一年。
- **FR-6：** 程序必须拒绝过期/撤销授权、余额不足、低于最低余额、错误资产、重复租借和第二笔并发活动锁定。
- **FR-7：** 第一版不支持活动锁定期间追加锁定；锁定金额固定到该租借记录终止。

#### 归还、释放与冻结

- **FR-8：** 商户提交 `ReturnedGood` 后，锁定金额只能释放一次并回到对应子账户的程序可用余额。
- **FR-9：** 商户提交 `ReturnedDamaged` 或 `Missing` 后，资金进入 `Frozen`，不执行扣款；商户确认已赔偿后回到可用余额。
- **FR-10：** `RentalLock` 仍为 `Active` 且锁定满 180 天、商户未提交任何归还或冻结状态时，keeper 可以提交释放；程序必须自行校验时间、状态和唯一性。
- **FR-11：** `ReturnedDamaged`/`Missing` 状态不适用 180 天自动释放，必须等待商户确认已赔偿。

#### 记录与查询

- **FR-12：** 系统必须记录存入、授权、撤销、锁定、归还、释放、冻结、解冻和提取事件。
- **FR-13：** 归还记录必须包含状态、时间、物品 ID 和照片 URL/内容哈希；照片原件不直接上链。
- **FR-14：** 前端必须区分 `Available`、`Locked`、`Frozen`、`Withdrawable`，并展示租借、到期和状态转换记录。

### User Experience

核心流程：连接钱包 → 选择/创建资产子账户 → 存入押金 → 选择商户和物品 → 游客确认本次授权 → 锁定额度 → 查看租借状态 → 商户提交归还状态 → 释放或冻结 → 游客查看可用余额并按需提取。

异常状态必须明确说明：已有活动锁定、余额不足、授权过期、交易状态未知、照片上传失败、损坏/遗失冻结和 180 天 keeper 释放。钱包签名失败或 RPC 超时时，先查询链上状态再允许重试。

### Edge Cases

| Scenario | Expected Behavior |
| --- | --- |
| 同一 Passport 已有活动锁定 | 拒绝第二笔商户锁定；其它未锁定资产仍可提取 |
| 锁定后低于资产最低余额 | 拒绝锁定，原余额不变 |
| 商户 180 天未操作 | keeper 释放到程序可用余额，不从游客押金扣额外费用 |
| 已进入损坏/遗失冻结 | 不因 180 天自动释放；等待商户确认已赔偿 |
| RPC 超时但交易可能已确认 | 查询签名和链上状态，避免重复提交 |
| 游客重复点击授权或锁定 | 通过 nonce/幂等 ID 只允许一笔有效记录 |

## Technical Considerations

### Constraints

- 目标网络为 Solana devnet；平台不托管游客私钥。
- 押金由链上程序控制；释放只回到程序余额，提取是单独动作。
- 180 天 keeper 交易费由平台/运营方承担；游客仅承担自己主动交易的钱包网络费。
- 同一 Passport 全局最多一笔活动锁定，但未锁定资产子账户可以提取。
- 归还照片和索引数据在链下存储；链上保存稳定引用或哈希。

### Integration Points

- Wallet Standard 钱包：连接、签名和交易确认。
- Solana devnet RPC：账户、交易和事件读取。
- 链下索引服务：聚合链上事件供前端查询。
- 照片存储：保存照片 URL 和内容哈希。
- Keeper 服务：提交 180 天超时释放交易。

### Data Requirements

核心数据对象包括 `DepositPassport`、按资产划分的 `DepositAccount`、`Merchant`、`MerchantAuthorization`、`RentalLock` 和 `ReturnRecord`。所有金额使用资产原生精度保存；不得接受未登记 mint。照片原件和个人身份信息不上链。

## Agent Execution Contract

### Authoritative Sources

| Source | Path | Definitive for |
| --- | --- | --- |
| Research decisions | `RESEARCH.md` | 产品背景、已确认规则、非目标和风险 |
| This PRD | `PRD.md` | 第一版功能范围、FR、验收和交接顺序 |

当两者冲突时，以本 PRD 的 FR 和 Scope 为实现依据；发现资金权限、锁定并发、180 天释放或资产支持范围冲突时，停止并回报产品负责人。

### Do Not Touch

| Path or system | Reason it is off limits |
| --- | --- |
| Mainnet、真实资金和真实用户钱包 | 本版本只做 devnet 演示 |
| 游客私钥、助记词和托管密钥 | 平台不托管游客私钥 |
| 未登记的 Token mint | 防止同名恶意资产进入押金系统 |

### Requirement Verification Map

| Requirement | How it is verified | Who verifies |
| --- | --- | --- |
| FR-1–FR-3 | 三资产账户、最低余额、未锁定资产提取测试 | 自动化测试 + QA |
| FR-4–FR-7 | allowlist、游客签名、过期/撤销/并发/重复锁定测试 | 自动化测试 |
| FR-8–FR-11 | 正常归还、损坏/遗失冻结、赔偿解冻、180 天 keeper 测试 | 自动化测试 + QA |
| FR-12–FR-14 | 事件查询、照片引用、四种用户状态演示 | QA + PM |

### Stop and Escalate

| Condition | Escalate to |
| --- | --- |
| 需要改变押金资产、最低余额、并发规则或 180 天释放规则 | 产品负责人 |
| 需要从押金中扣除费用、罚款或赔偿 | 产品负责人 + 安全负责人 |
| 需要支持主网、托管钱包或新 Token mint | 产品负责人 + 安全负责人 |

## Dependencies & Risks

### Dependencies

| Dependency | Owner | Status | Impact if Delayed |
| --- | --- | --- | --- |
| Devnet RPC 与测试资产 mint | 工程 | 待准备 | 无法完成三资产演示 |
| 商户 allowlist 与运营方钱包 | 平台运营 | 待准备 | 无法创建有效租借 |
| Keeper 服务与费用预算 | 平台运营 | 待准备 | 180 天释放无法演示 |
| 索引和照片存储 | 工程 | 待准备 | 状态查询或归还记录不完整 |

### Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| 商户单方确认“已赔偿”引发争议 | M | H | MVP 明确记录为已知风险；生产阶段增加游客确认、凭证或仲裁 |
| keeper 未运行导致活动锁定超过 180 天 | M | H | 监控 keeper、记录到期状态，并允许可重试的 permissionless 调用 |
| 三种资产精度或 mint 配置错误 | M | H | mint allowlist、资产精度校验和每种资产独立测试 |
| 全局单锁降低多商户连续使用价值 | M | M | devnet 先验证；后续用真实商户流程决定是否支持并发 |

## Timeline & Milestones

| Milestone | Description | Target |
| --- | --- | --- |
| M1 需求冻结 | 确认 FR、状态机、资产 mint 和运营权限 | 开始实现前 |
| M2 链上最小流程 | 完成存入、授权、锁定、正常释放、提取 | 第一开发阶段 |
| M3 异常流程 | 完成冻结/解冻、180 天 keeper、并发和幂等处理 | 第二开发阶段 |
| M4 devnet 演示 | 完成三资产、双商户、事件查询和异常演示 | MVP 验收 |

## Open Questions

- [ ] 确定 devnet 使用的 USDC/USDT 测试 mint 和 SOL 精度配置。Owner：工程
- [ ] 确定照片存储服务、访问权限和保留时间。Owner：工程/平台运营
- [ ] 确定商户登记、暂停和恢复是否需要多签。Owner：平台运营/安全
- [ ] 确定生产阶段对“已赔偿”单方确认的治理方案。Owner：产品/平台运营

## Appendix

### Related Documents

- User Research: `RESEARCH.md`

### Revision History

| Version | Date | Author | Changes |
| --- | --- | --- | --- |
| 1.0 | 2026-10-07 | Codex | Based on `RESEARCH.md`; initial MVP PRD |
