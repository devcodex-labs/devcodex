/**
 * GitHub OAuth 服务 — 与 GitHub API 交互的业务逻辑
 *
 * 负责 OAuth code→token 交换、用户信息获取。
 * 路由层通过 app.services.github 调用。
 */
export default class GitHubService {
  constructor(app) {
    this.app = app;
  }

  /**
   * 生成带 state 参数的 GitHub OAuth URL（防 CSRF）
   */
  buildAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID ?? '',
      redirect_uri: `${process.env.DEVCODEX_BASE_URL}/auth/github/callback`,
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  /**
   * 用 GitHub code 换取 access_token
   */
  async exchangeCodeForToken(code) {
    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    if (!resp.ok) throw new Error(`GitHub token exchange failed: ${resp.status}`);
    return resp.json();
  }

  /**
   * 用 GitHub access_token 获取用户信息
   */
  async fetchUser(accessToken) {
    const resp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!resp.ok) throw new Error(`GitHub user fetch failed: ${resp.status}`);
    return resp.json();
  }
}
