/**
 * DevCodex Auth Server — 应用配置
 *
 * 环境变量（在 .env 中配置，切勿硬编码）：
 *   GITHUB_CLIENT_ID      — GitHub OAuth App Client ID
 *   GITHUB_CLIENT_SECRET  — GitHub OAuth App Client Secret
 *   GITHUB_WEBHOOK_SECRET — GitHub App Webhook Secret
 *   JWT_SECRET            — DevCodex Token 签发密钥
 *   DEVCODEX_BASE_URL     — 服务公网地址（e.g. https://auth.devcodex.dev）
 *   PORT                  — 监听端口（默认 3300）
 */
import { nativeAdapter } from 'vextjs/adapters/native';

export default {
  adapter: nativeAdapter(),
  port: parseInt(process.env.PORT ?? '3300', 10),
  host: '0.0.0.0',

  cors: {
    enabled: true,
    origins: [
      'https://devcodex.dev',
      'https://github.com',
      ...(process.env.NODE_ENV === 'development' ? ['http://localhost:*'] : []),
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  },

  rateLimit: {
    enabled: true,
    max: 60,
    window: 60 * 1000, // 60 req / min
  },

  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },

  openapi: {
    enabled: process.env.NODE_ENV !== 'production',
    title: 'DevCodex Auth API',
    version: '0.0.1',
    description: 'DevCodex Token 验证与 GitHub OAuth 服务',
  },
};
