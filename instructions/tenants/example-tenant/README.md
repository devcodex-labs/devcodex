---
applyTo: "**"
---
# example-tenant

> 示例租户，仅用于演示 `instructions/tenants/<tenant-id>/` 的最小结构。

## 包含文件

- `10-dev.instructions.md`：展示如何局部覆盖 dev 工作流中的单条执行规则

## 使用方式

1. 复制 `example-tenant/` 为你自己的租户目录名
2. 按需修改其中的 `*.instructions.md`
3. 保留 frontmatter，并让 `applyTo` 与你的宿主加载规则保持一致

> ⚠️ 本目录默认不会自动生效，只有当宿主/项目明确选择对应 tenant-id 时才会进入 P3 租户覆盖层。
