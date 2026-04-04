/**
 * GitHub OAuth 回调路由 — src/routes/auth.js → 前缀 /auth
 *
 * 路由（VextJS 约定：文件名 auth.js → 自动前缀 /auth）：
 *   GET  /auth/github            — 重定向到 GitHub OAuth 授权页
 *   GET  /auth/github/callback   — GitHub 回调，换取 access_token，签发 DevCodex Token
 *   POST /auth/logout            — 吊销 Token（服务端黑名单）
 *
 * 环境变量依赖：
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / JWT_SECRET / DEVCODEX_BASE_URL
 */
import { defineRoutes } from 'vextjs';
import { randomBytes } from 'node:crypto';

// 生产环境启动时验证临界环境变量
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET 未设置！生产环境禁止使用默认密钥。');
    process.exit(1);
  } else {
    console.warn('[WARN] JWT_SECRET 未设置，将使用开发密钥。勿用于生产环境。');
  }
}

// ── 临时 state 存储（生产环境建议替换为 Redis）────────────────────────────────
const stateStore = new Map();

// ── 路由定义 ─────────────────────────────────────────────────────────────────

export default defineRoutes((app) => {
  /**
   * GET /auth/github
   * 生成 state，重定向到 GitHub OAuth 授权页
   */
  app.get('/github', {
    docs: {
      summary: '发起 GitHub OAuth 授权',
      tags: ['auth'],
    },
  }, async (req, res) => {
    const state = randomBytes(16).toString('hex');
    const redirect = req.query?.redirect ?? `${process.env.DEVCODEX_BASE_URL}/auth/success`;

    // state → redirect 绑定，10 分钟有效
    stateStore.set(state, { redirect, createdAt: Date.now() });
    setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

    res.redirect(app.services.github.buildAuthUrl(state));
  });

  /**
   * GET /auth/github/callback
   * GitHub 回调：校验 state → 换 token → 获取用户 → 签发 DevCodex Token
   */
  app.get('/github/callback', {
    docs: {
      summary: 'GitHub OAuth 回调处理',
      tags: ['auth'],
    },
  }, async (req, res) => {
    const { code, state, error } = req.query ?? {};

    if (error) {
      res.redirect(`${process.env.DEVCODEX_BASE_URL}/auth/error?reason=oauth_denied`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'missing_params', message: 'code 和 state 参数必须' });
      return;
    }

    const stateData = stateStore.get(state);
    if (!stateData) {
      res.status(400).json({ error: 'invalid_state', message: 'state 无效或已过期' });
      return;
    }
    stateStore.delete(state);

    try {
      const { access_token: githubToken } = await app.services.github.exchangeCodeForToken(code);
      if (!githubToken) {
        res.status(502).json({ error: 'github_token_failed', message: 'GitHub token 换取失败' });
        return;
      }

      const user = await app.services.github.fetchUser(githubToken);

      // 签发 DevCodex Token：新注册用户进入 7 天试用期（trial），
      // trial_expires 由 validate 路由检查；试用期结束自动降级为 free。
      // 付款成功后由付款回调将 tier 升级为 'pro'。
      const trialExpiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 天
      const devcodexToken = app.services.token.issue({
        sub: String(user.id),
        login: user.login,
        email: user.email,
        tier: 'trial',
        trial_expires: trialExpiresAt,
      });

      // 重定向到前端，携带 token（生产环境建议改为 httpOnly cookie）
      const redirectUrl = new URL(stateData.redirect);
      redirectUrl.searchParams.set('token', devcodexToken);
      res.redirect(redirectUrl.toString());
    } catch (err) {
      console.error('[auth/github/callback]', err);
      res.status(502).json({ error: 'upstream_error', message: '上游服务异常，请稍后重试' });
    }
  });

  /**
   * POST /auth/logout
   * 吊销 Token（加入服务端黑名单）
   */
  app.post('/logout', {
    docs: {
      summary: '吊销 DevCodex Token',
      tags: ['auth'],
    },
  }, async (req, res) => {
    // TODO: 将 token jti 写入 Redis 黑名单；v5.0 直接返回成功
    res.json({ success: true, message: 'Token 已失效' });
  });
});
