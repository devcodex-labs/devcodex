---
name: fix-security
description: 安全修复子类型规范 — CVE/漏洞响应 + 四项安全专项扫描
---
# Fix Security Skill

## 触发条件

安全漏洞修复：CVE 响应、XSS/SQL注入/CSRF 修复、依赖漏洞升级、权限越权修复、敏感信息泄露处理。

## 安全专项扫描（S1~S4）

在标准 fix 三步扫描之外，额外执行：

| 扫描 | 内容 | 工具 |
|------|------|------|
| S1 漏洞验证 | 确认漏洞可重现 + CVSS 评分 | 手动/PoC |
| S2 依赖扫描 | 全量依赖树安全检查 | `npm audit` / `pnpm audit` |
| S3 代码扫描 | 修复文件及相关模块的安全模式检查 | 静态分析 |
| S4 回归扫描 | 修复后重新运行 S1~S3 确认修复有效 | 同上 |

## 执行规则

- CP1 必须包含：漏洞描述 + CVSS 评分 + 影响版本范围
- CP2 必须包含：修复方案 + 是否需要 Breaking Change + 公告计划
- 安全修复 PR 描述中**禁止包含**漏洞细节（防止公开 CVE 前泄露）
- 依赖升级必须检查 Peer Dependencies 兼容性

## 发布流程

1. 修复完成 → 安全测试通过
2. 准备 Security Advisory
3. 协调发布节奏（如有 CVE 编号，对齐披露时间）
4. 发布 patch 版本 + CHANGELOG 安全公告
5. 输出安全报告：优先 `.devcodex/bugs/<问题>/reports/<agent>/YYYYMMDD/NN--security.md`；无任务上下文时回退到 `.devcodex/reports/bugs/<agent>/YYYYMMDD/NN--security.md`
