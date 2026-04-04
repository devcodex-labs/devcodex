# Auth Server 部署指南

DevCodex Auth Server 是托管 `auth.devcodex.dev` 的后端服务，基于 **VextJS** 框架构建，提供 GitHub OAuth 登录、Token 验证和 GitHub Webhook 处理。

## 架构概览

```
用户browser/Plugin                   auth.devcodex.dev
     │                                       │
     │  GET /auth/github                     │
     │──────────────────────────────────────▶│
     │                                       │── redirect ──▶ github.com/oauth
     │                                       │
     │  GET /auth/github/callback?code=xxx   │◀──── GitHub 回调 ────
     │──────────────────────────────────────▶│
     │                                       │── 换 access_token ──▶ GitHub API
     │  ◀── redirect with DevCodex Token ───│
     │
     │  POST /validate { token }  (Plugin 调用)
     │──────────────────────────────────────▶│
     │  ◀── { valid, tier, sub } ───────────│
     │
     │                        GitHub Marketplace
     │                               │── POST /webhooks/github ──▶│
     │                               │                            │── 升级 tier
```

## 本地开发

### 前置条件

- Node.js 18+
- npm 9+
- 一个 [GitHub OAuth App](https://github.com/settings/developers)（本地测试用回调地址：`http://localhost:3300/auth/github/callback`）

### 启动步骤

```bash
# 进入 auth server 目录
cd auth

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 GitHub OAuth App 凭据和 JWT_SECRET

# 修改 .env 中的回调地址（本地测试）
DEVCODEX_BASE_URL=http://localhost:3300

# 启动开发服务器（热重载）
npm run dev
```

服务启动后：
- `http://localhost:3300/auth/github` — 触发 OAuth 授权
- `http://localhost:3300/validate` — Token 验证
- `http://localhost:3300/health` — 健康检查

### 测试 OAuth 流程

```bash
# 浏览器中访问（将自动重定向到 GitHub 授权页）
open http://localhost:3300/auth/github?redirect=http://localhost:3300/auth/success

# 授权后 GitHub 回调到 /auth/github/callback，最终携带 token 重定向回 redirect URL
```

### 测试 Webhook（使用 GitHub CLI）

```bash
# 安装 GitHub CLI smee 代理（本地接收 webhook）
npm install -g smee-client

# 在 smee.io 创建频道，获取 URL（如 https://smee.io/xyz）
smee --url https://smee.io/xyz --target http://localhost:3300/webhooks/github
# 在 GitHub App 的 Webhook URL 填入 smee 地址
```

## 生产部署（Railway / Render / Fly.io）

### Railway（推荐）

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 在项目根目录创建新服务
cd auth
railway init

# 设置环境变量
railway variables set GITHUB_CLIENT_ID=xxx
railway variables set GITHUB_CLIENT_SECRET=xxx
railway variables set GITHUB_WEBHOOK_SECRET=xxx
railway variables set JWT_SECRET=xxx
railway variables set DEVCODEX_BASE_URL=https://auth.devcodex.dev
railway variables set NODE_ENV=production

# 部署
railway up
```

### Docker 部署

```dockerfile
# auth/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src/ ./src/
ENV NODE_ENV=production
EXPOSE 3300
CMD ["npm", "start"]
```

```bash
# 构建镜像
docker build -t devcodex-auth ./auth

# 运行（通过 --env-file 注入环境变量）
docker run -p 3300:3300 --env-file auth/.env devcodex-auth
```

### docker-compose（含 Redis 缓存，v5.1+）

```yaml
# docker-compose.yml（放在 auth/ 目录）
services:
  auth:
    build: .
    ports:
      - "3300:3300"
    env_file: .env
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
```

## GitHub Actions CI/CD

```yaml
# .github/workflows/deploy-auth.yml
name: Deploy Auth Server

on:
  push:
    branches: [main]
    paths:
      - 'auth/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Railway
        uses: railwayapp/railway-github-action@v1
        with:
          service: devcodex-auth
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

## GitHub OAuth App 配置步骤

1. 前往 [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. 点击 **New OAuth App**，填写：

   | 字段 | 值 |
   |------|-----|
   | Application name | DevCodex |
   | Homepage URL | `https://devcodex.dev` |
   | Authorization callback URL | `https://auth.devcodex.dev/auth/github/callback` |

3. 生成 Client Secret，保存到部署平台的环境变量

## GitHub App Webhook 配置

1. 前往 GitHub → Settings → Developer settings → **GitHub Apps**
2. 编辑 DevCodex App，在 **Webhook** 部分：
   - **Webhook URL**：`https://auth.devcodex.dev/webhooks/github`
   - **Webhook secret**：生成随机字符串（`openssl rand -hex 32`），同步写入 `GITHUB_WEBHOOK_SECRET`
3. 在 **Subscribe to events** 勾选：
   - `installation` — App 安装/卸载（企业版授权联动）
   - `marketplace_purchase` — Marketplace 购买事件（Pro 层级自动激活）

## GitHub Marketplace 购买流程

```
用户在 GitHub Marketplace 购买 DevCodex Pro
        │
        ▼
GitHub 发送 marketplace_purchase 事件至 /webhooks/github
        │
        ▼
webhooks.js handleMarketplacePurchase():
  action=purchased/changed → 更新用户 tier 为 "pro"
  action=cancelled         → 降级用户 tier 为 "free"
        │
        ▼
DevCodex Plugin 下次调用 /validate 时返回 tier="pro"
```

## 安全注意事项

- **GITHUB_WEBHOOK_SECRET** 必须配置，用于验证所有 Webhook 请求的 HMAC 签名
- **JWT_SECRET** 至少 32 个字符，生产环境使用 `openssl rand -hex 32` 生成
- **.env 文件已加入 .gitignore**，永远不要提交到代码仓库
- 生产环境建议启用 HTTPS（Railway/Render 自动处理）
- Token 黑名单（logout 功能）在 v5.1 接入 Redis 后完整实现
