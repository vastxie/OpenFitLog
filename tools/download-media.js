#!/usr/bin/env node
/**
 * 一键拉取全套 314 个动作的男女 3D 演示视频与高清封面到本地 media/ 目录
 * 用法：npm run download:media
 *
 * 适合场景：
 *   1. 想在纯离线环境下通过 npm start 本地托管全部动作视频；
 *   2. 二次开发正式上线前，先拉取全套素材到本地，再上传至你自己的备案域名 OSS / COS / R2。
 *
 * 也支持直接用浏览器或 curl 下载整包压缩文件解压到 media/ 目录：
 *   https://fit-media.lightai.io/fit-log-media.zip
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'media');
const { EXERCISES } = require(path.join(ROOT, 'data/exercises.js'));
const SOURCE_BASE = (process.env.MEDIA_SOURCE_URL || 'https://fit-media.lightai.io').replace(/\/+$/, '');

const tasks = [];
const seen = new Set();

function add(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  tasks.push(rel);
}

for (const ex of EXERCISES) {
  if (ex.m) {
    add(`exercise-posters/male/${ex.m}.jpg`);
    add(`exercise-videos/male/${ex.m}.mp4`);
  }
  if (ex.f) {
    add(`exercise-posters/female/${ex.f}.jpg`);
    add(`exercise-videos/female/${ex.f}.mp4`);
  }
}

async function fetchOne(rel) {
  const dest = path.join(MEDIA_DIR, rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return fs.statSync(dest).size;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = `${SOURCE_BASE}/${rel}`;

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty_body');
      const tmp = `${dest}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      return buf.length;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
  throw new Error(`${rel}: ${lastErr.message}`);
}

(async () => {
  console.log(`准备从 ${SOURCE_BASE} 拉取 ${tasks.length} 个媒体文件至 ${MEDIA_DIR} ...`);
  console.log(`（支持断点续传；也可直接下载整包：${SOURCE_BASE}/fit-log-media.zip）\n`);

  let cursor = 0;
  let done = 0;
  let bytes = 0;
  const failures = [];
  const t0 = Date.now();

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) break;
      try {
        bytes += await fetchOne(tasks[idx]);
      } catch (e) {
        failures.push(e.message);
      }
      done++;
      if (done % 100 === 0 || done === tasks.length) {
        const mb = (bytes / 1048576).toFixed(1);
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`进度: ${done}/${tasks.length} (${mb} MB, ${sec}s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, () => worker()));

  if (failures.length > 0) {
    console.error(`\n有 ${failures.length} 个文件拉取失败，重新执行 npm run download:media 即可断点续传：`);
    failures.slice(0, 10).forEach((m) => console.error(`  - ${m}`));
    process.exit(1);
  }
  console.log(`\n全部 ${tasks.length} 个媒体文件已就绪！目录：${MEDIA_DIR}`);
})();
