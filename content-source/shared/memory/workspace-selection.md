当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，MCP memory 工具从工作区根调用不得静默回退到 workspace 记忆。调用方必须二选一：
- 传入 `project`，写入 `<工作区根>/.devcodex/<project>/.memory/...`
- 显式传入 `scope: "workspace"`，写入 `<工作区根>/.devcodex/workspace/.memory/...`