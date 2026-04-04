# DevCodex 一键同步脚本
# 将规范文件同步到 MySelf 工作区，并同步 profile 到 .devcodex\
# 用法：直接运行，或通过 VS Code Task（Ctrl+Shift+B）触发

Set-Location "E:\MySelf"
Write-Host "🔄 Syncing DevCodex to .github\..." -ForegroundColor Cyan
devcodex update

Write-Host "🔄 Syncing profile to .devcodex\profile\..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path "E:\MySelf\.devcodex\profile" -Force | Out-Null
Copy-Item "E:\MySelf\devcodex\.devcodex\profile\*" "E:\MySelf\.devcodex\profile\" -Force

Write-Host ""
Write-Host "✅ Done! Press Ctrl+N in VS Code to open a new Chat session and verify." -ForegroundColor Green
