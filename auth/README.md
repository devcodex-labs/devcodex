# DevCodex Auth Server

> 基于 **VextJS** 框架的 Token 验证与 GitHub OAuth 服务  
> 部署目标：`https://auth.devcodex.dev`

## 目录结构（VextJS 约定）

```
auth/
├── src/
│   ├── config/
│   │   └── default.js          # 应用配置（端口/CORS/限流/OpenAPI）
│   ├── routes/                 # 约定式路由（文件名 → URL 前缀）
│   │   ├── auth.js             # → /auth/*（GitHub OAuth）
│   │   ├── validate.js         # → /validate（Token 验证）
│   │   └── webhooks.js         # → /webhooks/*（GitHub Webhook）
│   └── services/               # 业务逻辑层
│       ├── token.js            # Token 签发/验证（HMAC-SHA256）
│       └── github.js           # GitHub API 交互
├── .env.example                # 环境变量模板
├── package.json
└── README.md
```

## 快速开始

```bash
cd auth
npm install
cp .env.example .env  # 编辑填入 GitHub OAuth 凭据和 JWT_SECRET
npm run dev           # http://localhost:3300
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/auth/github` | 发起 GitHub OAuth 授权 |
| GET | `/auth/github/callback` | GitHub OAuth 回调 |
| POST | `/auth/logout` | 吊销 Token |
| POST | `/validate` | 验证 DevCodex Token（plugin.json endpoint） |
| GET | `/validate/health` | 健康检查 |
| POST | `/webhooks/github` | GitHub App Webhook 入口 |

## 部署

详见 [Auth Server 部署指南](../website/docs/deployment/auth-server.md)。
