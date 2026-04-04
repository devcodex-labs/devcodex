/**
 * GitHub App Webhook 路由 — src/routes/webhooks.js → 前缀 /webhooks
 *
 * POST /webhooks/github — 接收 GitHub App 事件推送
 *
 * 当前处理的事件：
 *   - ping          — 验证 Webhook 连通性
 *   - installation  — GitHub App 安装/卸载事件（用于企业版授权联动）
 *   - marketplace_purchase — GitHub Marketplace 购买事件（Pro 层级激活）
 *
 * 安全：所有请求通过 HMAC-SHA256 签名验证（X-Hub-Signature-256）
 */
import { defineRoutes } from 'vextjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── 签名验证 ──────────────────────────────────────────────────────────────────

/**
 * 验证 GitHub Webhook 签名
 * 参考：https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
function verifyWebhookSignature(payload, signature) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET 未配置，跳过签名验证（仅开发环境允许）');
    return process.env.NODE_ENV !== 'production';
  }

  if (!signature?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const expectedBuf = Buffer.from(`sha256=${expected}`, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

// ── 事件处理器 ────────────────────────────────────────────────────────────────

async function handlePing(payload, deliveryId) {
  console.info(`[webhook:ping] zen="${payload.zen}" delivery=${deliveryId}`);
}

async function handleInstallation(payload) {
  const { action, installation, sender } = payload;
  console.info(`[webhook:installation] action=${action} account=${installation?.account?.login} sender=${sender?.login}`);
  // TODO: 联动企业版授权数据库（installation.id → org/user 映射）
}

async function handleMarketplacePurchase(payload) {
  const { action, marketplace_purchase, sender } = payload;
  const { plan, account } = marketplace_purchase ?? {};
  console.info(`[webhook:marketplace_purchase] action=${action} plan=${plan?.name} account=${account?.login}`);

  if (action === 'purchased' || action === 'changed') {
    // TODO: 根据 plan.name 映射到 DevCodex 层级，更新用户 tier
    // pro → tier = 'pro', enterprise → tier = 'enterprise'
  } else if (action === 'cancelled') {
    // TODO: 降级到 free
  }
}

// ── 路由定义 ─────────────────────────────────────────────────────────────────

export default defineRoutes((app) => {
  /**
   * POST /webhooks/github
   * GitHub App Webhook 统一入口
   */
  app.post('/github', {
    docs: {
      summary: 'GitHub App Webhook 入口',
      tags: ['webhook'],
    },
  }, async (req, res) => {
    const signature = req.headers?.['x-hub-signature-256'];
    const event = req.headers?.['x-github-event'];
    const deliveryId = req.headers?.['x-github-delivery'];

    // 获取原始请求体（签名验证需要原始字节）
    const rawBody = req.rawBody ?? JSON.stringify(req.body);

    if (!verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    try {
      switch (event) {
        case 'ping':
          await handlePing(payload, deliveryId);
          break;
        case 'installation':
        case 'installation_repositories':
          await handleInstallation(payload);
          break;
        case 'marketplace_purchase':
          await handleMarketplacePurchase(payload);
          break;
        default:
          console.debug(`[webhook] unhandled event: ${event}`);
      }

      res.status(200).json({ received: true, event, delivery: deliveryId });
    } catch (err) {
      console.error(`[webhook:${event}] handler error:`, err);
      res.status(500).json({ error: 'handler_error' });
    }
  });
});
