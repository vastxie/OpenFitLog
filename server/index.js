#!/usr/bin/env node
/**
 * FitLog 极简本地媒体静态服务 + 云同步后端（零第三方依赖，Node.js >= 18 直接运行）
 *
 * 功能：
 *   1. 静态媒体托管（当存在 media/ 目录时自动启用，支持 HTTP Range 206 视频流）：
 *      GET /exercise-posters/{male|female}/{slug}.jpg
 *      GET /exercise-videos/{male|female}/{slug}.mp4
 *   2. 云同步接口（对应小程序 utils/storage.js）：
 *      POST /api/auth/wx-login   code 换 openid，签发 Bearer Token 并返回当前云端快照
 *      GET  /api/sync/pull       按 sinceRev 增量检查并拉取云端快照
 *      POST /api/sync/push       上传最新合并快照并递增版本号 rev（含 wiped 清空处理）
 *
 * 启动方式：
 *   本地开箱预览（跨平台支持 macOS / Windows / Linux）：
 *     npm start                  # 等价于 node server/index.js --dev
 *
 *   生产环境部署：
 *     TOKEN_SECRET=your-32-char-secret WX_APP_ID=wx... WX_APP_SECRET=... node server/index.js
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IS_DEV_FLAG = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const WX_APP_ID = (process.env.WX_APP_ID || '').trim();
const WX_APP_SECRET = (process.env.WX_APP_SECRET || '').trim();
const DEV_MOCK_OPENID =
  (process.env.DEV_MOCK_OPENID || '').trim() || (IS_DEV_FLAG ? 'local-dev-user' : '');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, '..', 'media'));
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 单次同步快照上限 5MB
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天

const TOKEN_SECRET =
  (process.env.TOKEN_SECRET || '').trim() ||
  (DEV_MOCK_OPENID ? 'fitlog-local-dev-secret-do-not-use-in-prod' : '');

if (!TOKEN_SECRET) {
  console.error('[fitlog-server] 缺少环境变量 TOKEN_SECRET（至少 32 位随机字符串）。');
  console.error('[fitlog-server] 若仅在本机预览调试，请执行: npm start（或 node server/index.js --dev）');
  process.exit(1);
}

if (!WX_APP_ID || !WX_APP_SECRET) {
  if (!DEV_MOCK_OPENID) {
    console.error('[fitlog-server] 缺少 WX_APP_ID / WX_APP_SECRET，且未开启 --dev / DEV_MOCK_OPENID。');
    process.exit(1);
  }
  console.warn(`[fitlog-server] 本地开发模式：wx-login 固定映射为 openid="${DEV_MOCK_OPENID}"（请勿直接用于公网生产环境）`);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

// ---------- Token 签发与校验（HMAC-SHA256） ----------

function signToken(openid) {
  const payload = Buffer.from(
    JSON.stringify({ sub: openid, exp: Date.now() + TOKEN_TTL_MS }),
    'utf8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const raw = authHeader.slice(7).trim();
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.sub !== 'string' || !data.sub) return null;
    if (typeof data.exp !== 'number' || Date.now() > data.exp) return null;
    return data.sub;
  } catch {
    return null;
  }
}

// ---------- 本地原子文件存储（生产环境可按同样结构替换为 SQLite / PostgreSQL） ----------

function userFilePath(openid) {
  const hash = crypto.createHash('sha256').update(openid).digest('hex');
  return path.join(DATA_DIR, `${hash}.json`);
}

function readUserRecord(openid) {
  const fp = userFilePath(openid);
  try {
    const txt = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(txt);
    return {
      rev: Number(parsed.rev) || 0,
      updatedAt: Number(parsed.updatedAt) || 0,
      snapshot: parsed.snapshot || null,
    };
  } catch {
    return { rev: 0, updatedAt: 0, snapshot: null };
  }
}

function writeUserRecord(openid, record) {
  const fp = userFilePath(openid);
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), 'utf8');
  fs.renameSync(tmp, fp);
}

// ---------- 静态媒体文件流式响应（支持 iOS/微信 video 组件必需的 HTTP Range） ----------

function serveMediaFile(req, res, pathname) {
  let relPath = '';
  try {
    relPath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad_path' });
  }
  const fullPath = path.resolve(MEDIA_DIR, relPath);
  if (!fullPath.startsWith(MEDIA_DIR + path.sep)) {
    return sendJson(res, 403, { ok: false, error: 'forbidden' });
  }

  let stat;
  try {
    stat = fs.statSync(fullPath);
    if (!stat.isFile()) return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch {
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
    if (start >= total || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'public, max-age=86400',
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(fullPath, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': total,
    'Cache-Control': 'public, max-age=86400',
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(fullPath).pipe(res);
}

// ---------- 微信登录凭证校验 ----------

async function resolveOpenId(code) {
  if (!code || typeof code !== 'string') {
    throw new Error('invalid_code');
  }
  if (!WX_APP_ID || !WX_APP_SECRET) {
    if (DEV_MOCK_OPENID) return DEV_MOCK_OPENID;
    throw new Error('wx_credentials_missing');
  }
  const qs = new URLSearchParams({
    appid: WX_APP_ID,
    secret: WX_APP_SECRET,
    js_code: code,
    grant_type: 'authorization_code',
  });
  const res = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${qs.toString()}`);
  if (!res.ok) throw new Error(`wx_http_${res.status}`);
  const data = await res.json();
  if (data.errcode || !data.openid) {
    throw new Error(`wx_err_${data.errcode || 'no_openid'}`);
  }
  return data.openid;
}

// ---------- HTTP 工具 ----------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- 路由分发 ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, mediaDir: fs.existsSync(MEDIA_DIR) });
    }

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      (url.pathname.startsWith('/exercise-posters/') || url.pathname.startsWith('/exercise-videos/'))
    ) {
      return serveMediaFile(req, res, url.pathname);
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/wx-login') {
      const body = await readJsonBody(req);
      const openid = await resolveOpenId(body.code);
      const token = signToken(openid);
      const rec = readUserRecord(openid);
      return sendJson(res, 200, {
        ok: true,
        token,
        rev: rec.rev,
        snapshot: rec.snapshot,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/sync/pull') {
      const openid = verifyToken(req.headers.authorization);
      if (!openid) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

      const sinceRev = Number(url.searchParams.get('sinceRev') || 0);
      const rec = readUserRecord(openid);
      if (!rec.snapshot || rec.rev <= sinceRev) {
        return sendJson(res, 200, { ok: true, upToDate: true, rev: rec.rev });
      }
      return sendJson(res, 200, {
        ok: true,
        upToDate: false,
        rev: rec.rev,
        snapshot: rec.snapshot,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/sync/push') {
      const openid = verifyToken(req.headers.authorization);
      if (!openid) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

      const body = await readJsonBody(req);
      if (!body || !body.snapshot || typeof body.snapshot !== 'object') {
        return sendJson(res, 400, { ok: false, error: 'invalid_snapshot' });
      }

      const rec = readUserRecord(openid);
      const nextRev = rec.rev + 1;
      // 用户点击「关闭并删除云端数据」时，仅保留 wiped 空标记，彻底清除云端个人记录
      const cleanSnapshot = body.snapshot.wiped
        ? { schema: 1, wiped: true, clientUpdatedAt: Date.now() }
        : body.snapshot;

      writeUserRecord(openid, {
        rev: nextRev,
        updatedAt: Date.now(),
        snapshot: cleanSnapshot,
      });
      return sendJson(res, 200, { ok: true, rev: nextRev });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    const msg = (err && err.message) || 'internal_error';
    if (msg === 'payload_too_large') return sendJson(res, 413, { ok: false, error: msg });
    if (msg === 'invalid_json' || msg === 'invalid_code') {
      return sendJson(res, 400, { ok: false, error: msg });
    }
    console.error('[fitlog-server] request error:', msg);
    return sendJson(res, 500, { ok: false, error: 'server_error' });
  }
});

server.listen(PORT, HOST, () => {
  const hasMedia = fs.existsSync(path.join(MEDIA_DIR, 'exercise-posters'));
  console.log(`[fitlog-server] 已启动: http://${HOST}:${PORT}`);
  if (hasMedia) {
    console.log(`[fitlog-server] 动作媒体目录已挂载: ${MEDIA_DIR}`);
  }
});
