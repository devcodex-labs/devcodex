/**
 * Token 验证路由 — src/routes/validate.js → 前缀 /validate
 *
 * POST /validate — plugin.json 中 authentication.endpoint 指向此接口
 *
 * 请求体：{ token: string }
 * 响应：  { valid: boolean, tier: 'free' | 'trial' | 'pro' | 'enterprise', sub: string }
 */
import { defineRoutes } from 'vextjs';

// 生产环境启动时验证临界环境变量
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET 未设置！生产环境禁止使用默认密钥。');
    process.exit(1);
  } else {
    console.warn('[WARN] JWT_SECRET 未设置，将使用开发密钥。勿用于生产环境。');
  }
}

// ── 路由定义 ─────────────────────────────────────────────────────────────────

export default defineRoutes((app) => {
  /**
   * POST /validate
   * DevCodex Plugin 调用此接口验证 Token 有效性与授权层级
   */
  app.post('/', {
    validate: {
      body: {
        token: 'string!',
      },
    },
    docs: {
      summary: '验证 DevCodex Token',
      tags: ['token'],
    },
  }, async (req, res) => {
    const { token } = req.body ?? {};

    if (!token) {
      res.status(400).json({ valid: false, error: 'missing_token' });
      return;
    }

    const payload = app.services.token.verify(token);

    if (!payload) {
      res.status(401).json({ valid: false, error: 'invalid_token' });
      return;
    }

    // 试用期检查：tier='trial' 且 trial_expires 已过期，降级为 'free'
    let effectiveTier = payload.tier ?? 'free';
    const now = Math.floor(Date.now() / 1000);
    if (effectiveTier === 'trial' && payload.trial_expires && payload.trial_expires < now) {
      effectiveTier = 'free';
    }

    res.json({
      valid: true,
      tier: effectiveTier,
      sub: payload.sub,
      login: payload.login,
      exp: payload.exp,
      ...(effectiveTier === 'trial' && { trial_expires: payload.trial_expires }),
    });
  });

  /**
   * GET /validate/health
   * 健康检查（负载均衡 / 容器探针使用）
   */
  app.get('/health', {
    docs: {
      summary: '健康检查',
      tags: ['system'],
    },
  }, async (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
  });
});
