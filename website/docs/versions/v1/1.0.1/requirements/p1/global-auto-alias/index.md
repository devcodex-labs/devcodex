# 全局默认 Auto 别名

> **状态**: 已实现  
> **优先级**: P1  
> **关联**: Auto v1.1 / Profile config / Hook runtime

## 背景

Auto v1.1 已支持显式 `@devcodex-auto`、自然语言 auto 授权和 Profile `extensions.devcodex.autoAliases`。原实现把 `@rocky` 作为项目 Profile 示例别名，需要项目主动配置后才生效。

在高频维护场景中，`@rocky` 已成为 DevCodex 默认使用心智。继续要求每个项目重复配置会增加安装成本，也容易让“默认入口”和“项目覆盖入口”形成混淆。

## 需求

1. `@rocky` 是 Auto v1.1 的全局默认精确别名。
2. `extensions.devcodex.autoAliases` 不再表示“追加项目别名”，而是替换全局默认别名。
3. 省略 `autoAliases` 表示沿用默认 `@rocky`。
4. `autoAliases: []` 表示关闭默认别名。
5. 显式 `@devcodex-auto` 与明确自然语言 auto 授权继续保留，不受替换列表影响。
6. 模糊提及、询问 auto 规则、未生效昵称或普通“继续”不算授权。

## 验证

- Hook runtime 覆盖默认 `@rocky` 进入 auto。
- Hook runtime 覆盖配置替换后 `@rocky` 不再生效。
- Hook runtime 覆盖空数组关闭默认别名。
- Profile schema 继续校验 `autoAliases` 必须是精确 `@alias` token，且不得使用保留别名。
- V14 治理探针检查规范源、Auto agent、README 与 runtime 的默认/替换语义。
