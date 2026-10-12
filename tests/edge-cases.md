---
artifact: edge-cases
version: "1.0"
created: 2026-10-11
status: implemented-local
---

# Edge Cases: Shared Deposit Passport

## Feature Overview

PRD 第一版：三资产、单锁、单次授权、商户归还、冻结解冻、180 天释放与钱包交易恢复。
Related Documents: [PRD](../PRD.md), [验收](acceptance.md), [计划](../PLAN.md).

## Edge Case Categories

### Input Validation

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| 金额为空、零、负数、科学计数法、超精度或超 u64 | 拒绝，不签名 | P1 | USDC/USDT 6 位；SOL 9 位；整数账本 |
| 物品/商户名称为空或超 64 字节 | 拒绝，允许修改 | P1 | UTF-8 字节计数 |
| 无效钱包、未登记 mint 或商户 | 拒绝，允许更正 | P1 | 同名币不能替代 allowlist mint |
| 非未来归还时间、旧 nonce、非规则版本 1 | 拒绝授权 | P1 | nonce 取自链上 |
| 照片 URL 非 HTTPS 或超过 256 字节 | 拒绝，允许更正 | P2 | 空 URL/零哈希表示未提供；文件内容哈希 |

### Boundary Conditions

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| 锁定后剩余恰好最低余额 | 允许 | P1 | 1 USDC/USDT，0.01 SOL |
| 比最低余额少一原生单位 | 拒绝 | P1 | 不舍入 |
| 授权满一年或已超过约定归还时间 | 拒绝接受 | P1 | 撤销仍可执行 |
| 锁定不足 180 天/恰好 180 天 | 前者拒绝，后者允许 keeper | P1 | 从 started_at 起算 |
| 冻结超 180 天 | 不自动释放 | P1 | 原商户确认赔偿解冻 |
| 资产余额提空 | 允许，保留状态账户租金 | P1 | 仅无锁定、无冻结时 |

### Error States

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| 未部署/未初始化 | 展示准备步骤，禁用相应写入 | P1 | 不模拟成功 |
| 非 devnet RPC | 禁止资金操作 | P1 | 本地仅显式 loopback |
| 钱包拒签/模拟失败/余额不足支付网络费 | 显示错误，允许修改重试 | P1 | 未提交不修改显示余额 |
| 运营/商户权限错误 | 链上拒绝 | P1 | 原商户可处理暂停前的租借 |

### Concurrency

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| 双击提交 | 操作锁与禁用按钮阻止重复签名 | P1 | 未知结果阻止新写入 |
| 两商户竞争锁定 | 仅一笔成功 | P1 | 全局 Passport 锁 |
| 重复接受、归还、解冻、keeper | 拒绝且资金不变 | P1 | 终态不可再释放 |
| 授权后提取导致不足 | 商户接受时重新验证余额 | P1 | 授权不提前冻结资金 |
| 锁定资产充值/提现 | 拒绝；其他未锁定资产可提现 | P1 | 冻结也视为未解决的全局锁 |
| 页面刷新或切换钱包 | 重新读链，历史和照片输入清空 | P1 | 不用前个钱包的内存余额 |

### Integration Failures

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| RPC 读失败/限流 | 明确未同步，禁用写入，允许刷新 | P1 | 不把旧余额作为当前结果 |
| 发送后断网/响应丢失 | 保存签名和签名交易，查询后决定 | P1 | 重发相同字节，不重建 |
| blockhash 过期且链上查无执行 | 清除 pending，允许重新发起 | P1 | 使用 finalized block height 判断 |
| 外部照片不可访问 | 链上保留状态、时间、引用和哈希 | P2 | v1 无照片托管保证 |

## Error Messages

| Error State | User Message | Additional Action |
| --- | --- | --- |
| RPC 失败 | 读取失败，资金操作已暂停 | 刷新 |
| 未知交易结果 | 上一笔交易结果待确认 | 查询结果 / 重发同一交易 |
| 输入金额错误 | 请输入正数金额 / 最多支持 N 位小数 | 修改金额 |
| 模拟失败 | 模拟失败，显示程序错误 | 修改输入或刷新状态 |
| 角色未登记 | 当前钱包不是已登记商户 | 切换钱包或由运营登记 |

## Recovery Paths

### 交易结果未知

User sees: 保存的签名与待确认提示。

Recovery options: 查询原签名；若尚未到期，重发相同交易；只有确认失败或过期且未执行后才重新创建。

Data preservation: localStorage 保存签名、签名交易字节、钱包、摘要、有效区块高度，不存私钥；链上状态始终为准。

### 钱包/RPC 错误

User sees: 钱包错误或状态未同步。

Recovery options: 连接正确钱包、切换 devnet RPC、刷新状态、修正输入。

Data preservation: 已确认状态保留在链上；未确认资金变化不写入本地余额。

## Test Scenarios

### Must Test (P1)

- [x] SBF 三资产、越权、撤销、并发锁、另一资产提现、重复操作、损坏/遗失冻结、赔偿、过期和 180 天边界。
- [x] 浏览器：钱包切换、刷新恢复、实际照片文件哈希、取消签名、发送响应丢失后的查询恢复、390px 无横向溢出。
- [ ] 真 devnet 三资产/双商户人工验收，部署后执行。

### Should Test (P2)

- [ ] 实际商户照片服务链接的访问和保留策略（外部依赖）。

### Nice to Test (P3)

- [ ] 生产网络容量及主网钱包兼容性（不在第一版范围）。
