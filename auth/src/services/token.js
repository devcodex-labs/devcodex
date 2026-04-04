/**
 * Token 服务 — DevCodex Token 签发与验证
 *
 * 负责 JWT-like Token 的 HMAC-SHA256 签发和验证逻辑。
 * 路由层通过 app.services.token 调用。
 */
import { createHmac } from 'node:crypto';

export default class TokenService {
  constructor(app) {
    this.app = app;
  }

  /**
   * 签发 DevCodex Token（JWT-like 简化版）
   * 生产环境建议替换为标准 jsonwebtoken 或 jose 库
   */
  issue(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 天
    })).toString('base64url');
    const sig = createHmac('sha256', process.env.JWT_SECRET ?? 'dev-secret')
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  /**
   * 验证 DevCodex Token
   * @returns {object|null} payload 或 null（无效时）
   */
  verify(token) {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;

    // A1：验证 header 中的算法字段，防止算法混淆攻击
    try {
      const headerPayload = JSON.parse(Buffer.from(header, 'base64url').toString());
      if (headerPayload.alg !== 'HS256') return null;
    } catch {
      return null;
    }

    const expected = createHmac('sha256', process.env.JWT_SECRET ?? 'dev-secret')
      .update(`${header}.${body}`)
      .digest('base64url');

    // 安全比较（防时序攻击）
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return null;

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }
}
