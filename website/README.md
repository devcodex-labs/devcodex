# DevCodex maintainer website pointer

`website/` 是维护者本地可选的完整文档源站目录，不进入公开仓和 npm 包。

当前公开用户文档位于 `public-site/`，当前执行中的需求、修复、优化和审查任务以 workspace active-root 下的 `.devcodex/<project>/` 产物为准。

当维护者本地存在完整 `website/docs` 时，它可以作为版本化需求源站和历史文档源；当公开 checkout 中只有本指针文件时，验证器和工作流不得把缺省 `website/docs` 解释为当前需求缺失。
