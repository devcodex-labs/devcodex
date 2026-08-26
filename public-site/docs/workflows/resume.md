# `resume`：跨会话续接

新的主入口是 [对话与任务续接](/workflows/session)。本页保留 `/workflows/resume` 深链，并展开 resume 的文件事实与授权继承；稳定定义见[工作流索引](/reference/workflows)。

## 适用 / 不适用

适用：同一项目里继续昨天没做完的任务。  
不适用：全新题目（应直接说新意图，不要假装续接）。

## 是否改文件

取决于被恢复的任务。原来只读，续接后仍只读。

## 阶段

解析当前 project/active-root → 解析精确任务名或 task ID → 读取该 task 的有界 hot A/B、cold stub、记忆与报告锚点 → 核对当前文件和 git 状态 → 恢复原工作流、CP 和剩余项 → 继续执行。

## 确认边界

不因为换了会话就省略原来的工作流确认。发布与越界仍要取得当前授权；删除等文件/命令操作权限由当前宿主重新判断。另一个 session/project/task 的 artifact、validation、task-write 或 release authority 一律不能继承。

## 产物

续接记录、原任务的后续产物。

## 验证

先核对 session、project、root、task、当前文件、分支、依赖和外部状态是否还对得上记忆。若证据过期、任务已 terminal 或范围漂移，先重新判定/确认，不把旧摘要、最近目录或 mtime 当成当前真相。

如果中断发生在准入阶段，重复同一正式任务请求会先精确核对已经落盘的 identity、概况、产品原文和 CP 状态，确定最大完整阶段前缀后自动补齐阶段内缺失文件；内容漂移才会阻断。如果中断发生在 artifact closeout，恢复必须消费 exact operation/CAS；完整效果直接复证，partial/零效果从预写快照重新观察当前文件系统。它不会要求复制一条等价授权语句，也不会借恢复获得新的文件操作权限。

## 完成条件

原任务按原工作流的完成条件结束，或明确还差什么。

## 示例请求

```text
继续公开站点内容与事实生成升级任务
```

故事见 [跨会话续接案例](/examples/resume)。

交付前需要留下可靠续接点时，使用[带证据交付与续接](/tutorials/evidence-handoff)。
