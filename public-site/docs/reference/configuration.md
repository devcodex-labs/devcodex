# 配置

普通单项目只需 `devcodex init`。需要团队别名或完成策略时，再编辑 workspace Profile 的 `config.json`。

## 自动推进别名

正式入口始终是 `@devcodex-auto`。默认快捷别名为 `@rocky`。

```json
{
  "extensions": {
    "devcodex": {
      "autoAliases": ["@team-auto"]
    }
  }
}
```

- 省略 `extensions.devcodex.autoAliases`：保留默认 `@rocky`；
- 非空数组：替换默认快捷别名；
- 空数组 `[]`：关闭默认快捷别名；
- 配置不会重命名正式的 `@devcodex-auto` 入口。

## 项目 Profile

多项目 workspace 中，某个子项目需要独立 Profile 时，可以从 workspace 根预览并初始化：

```bash
devcodex init --profile <项目相对路径> --dry-run
devcodex init --profile <项目相对路径>
```

目标必须真实存在且唯一。`--dry-run` 不创建文件；正式执行只补充缺失基线，不覆盖已编辑内容。

## 状态优先于猜测

```bash
devcodex status
devcodex doctor
```

配置、adapter、native 与 workspace 状态分别显示。不要根据一个文件存在、一个命令可运行或另一个宿主通过，就推断当前宿主已经完整就绪。
