#!/usr/bin/env node
/**
 * Antigravity 2.0 Korean Localization Patcher (src/patcher.js)
 *
 * Zero-dependency ASAR unpacker/patcher/repacker + Live CDP Injector.
 * Commands:
 *   node src/patcher.js apply    - Backup app.asar, apply Korean patch, and live-inject into running window
 *   node src/patcher.js live     - Hot-reload ko-KR.json & i18n-runtime.js into running window via CDP
 *   node src/patcher.js restore  - Restore original app.asar.bak and revert live window to English
 *   node src/patcher.js status   - Show installation, backup, and dictionary status
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PATCHER_ROOT = path.resolve(__dirname, '..');
const DICT_PATH = path.join(PATCHER_ROOT, 'locales', 'ko-KR.json');
const RUNTIME_PATH = path.join(__dirname, 'i18n-runtime.js');

const DEFAULT_APP_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Programs',
  'antigravity'
);
const RESOURCES_DIR = path.join(DEFAULT_APP_DIR, 'resources');
const ASAR_PATH = path.join(RESOURCES_DIR, 'app.asar');
const ASAR_BACKUP_PATH = path.join(RESOURCES_DIR, 'app.asar.bak');
const LS_LOG_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Antigravity',
  'logs',
  'language_server.log'
);

const BLOCK_SIZE = 4 * 1024 * 1024; // 4MB ASAR integrity block size

function computeIntegrity(buffer) {
  const fullHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const blocks = [];
  if (buffer.length === 0) {
    blocks.push(fullHash);
  } else {
    for (let offset = 0; offset < buffer.length; offset += BLOCK_SIZE) {
      const slice = buffer.subarray(offset, Math.min(offset + BLOCK_SIZE, buffer.length));
      blocks.push(crypto.createHash('sha256').update(slice).digest('hex'));
    }
  }
  return {
    algorithm: 'SHA256',
    hash: fullHash,
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

/**
 * Parses an Electron .asar archive into an in-memory file tree with Buffers.
 */
function parseAsar(asarBuffer) {
  const u2 = asarBuffer.readUInt32LE(4);
  const strSize = asarBuffer.readUInt32LE(12);
  const dataStart = 8 + u2;
  const headerJsonStr = asarBuffer.subarray(16, 16 + strSize).toString('utf8');
  const header = JSON.parse(headerJsonStr);

  function attachBuffers(node) {
    if (!node || !node.files) return;
    for (const [, child] of Object.entries(node.files)) {
      if (child.files) {
        attachBuffers(child);
      } else if (!child.unpacked && child.offset !== undefined && child.size !== undefined) {
        const start = dataStart + Number(child.offset);
        const end = start + Number(child.size);
        child.__buffer = Buffer.from(asarBuffer.subarray(start, end));
      }
    }
  }

  attachBuffers(header);
  return header;
}

/**
 * Serializes an in-memory ASAR tree back into a valid Electron .asar Buffer.
 */
function buildAsar(header) {
  const payloadChunks = [];
  let currentOffset = 0;

  function assignOffsets(node) {
    if (!node || !node.files) return;
    for (const [, child] of Object.entries(node.files)) {
      if (child.files) {
        assignOffsets(child);
      } else if (!child.unpacked && child.__buffer) {
        const buf = child.__buffer;
        child.size = buf.length;
        child.offset = String(currentOffset);
        child.integrity = computeIntegrity(buf);
        payloadChunks.push(buf);
        currentOffset += buf.length;
        delete child.__buffer;
      }
    }
  }

  // Deep clone header structure while preserving __buffer references first
  function cloneTree(node) {
    if (node.files) {
      const out = { files: {} };
      for (const [k, v] of Object.entries(node.files)) {
        out.files[k] = cloneTree(v);
      }
      return out;
    }
    const copy = { ...node };
    return copy;
  }

  const treeCopy = cloneTree(header);
  assignOffsets(treeCopy);

  const jsonBuffer = Buffer.from(JSON.stringify(treeCopy), 'utf8');
  const strSize = jsonBuffer.length;
  const alignedSize = Math.ceil(strSize / 4) * 4;
  const u1 = 4;
  const u2 = 8 + alignedSize;
  const u3 = 4 + alignedSize;

  const headerBuf = Buffer.alloc(16 + alignedSize, 0);
  headerBuf.writeUInt32LE(u1, 0);
  headerBuf.writeUInt32LE(u2, 4);
  headerBuf.writeUInt32LE(u3, 8);
  headerBuf.writeUInt32LE(strSize, 12);
  jsonBuffer.copy(headerBuf, 16);

  return Buffer.concat([headerBuf, ...payloadChunks]);
}

function patchMainJs(source, nativeDict) {
  let out = source;
  const replacements = [
    ["label: 'New Window'", `label: '${nativeDict['New Window'] || '새 창'}'`],
    ["label: 'No agents running'", `label: '${nativeDict['No agents running'] || '실행 중인 에이전트 없음'}'`],
    ["label: 'Quit'", `label: '${nativeDict['Quit'] || '종료'}'`],
    ["buttons: ['Cancel', 'Quit']", `buttons: ['${nativeDict['Cancel'] || '취소'}', '${nativeDict['Quit'] || '종료'}']`],
    ["title: 'Confirm Quit'", `title: '${nativeDict['Confirm Quit'] || '종료 확인'}'`],
    [
      "message: 'Are you sure you want to quit?'",
      `message: '${nativeDict['Are you sure you want to quit?'] || 'Antigravity를 종료하시겠습니까?'}'`,
    ],
    [
      "detail: 'There may be agents or background tasks running.'",
      `detail: '${nativeDict['There may be agents or background tasks running.'] || '실행 중인 에이전트나 백그라운드 작업이 있을 수 있습니다.'}'`,
    ],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchMenuJs(source, nativeDict) {
  let out = source;
  const replacements = [
    ["label: 'New Window'", `label: '${nativeDict['New Window'] || '새 창'}'`],
    ["label: 'Docs'", `label: '${nativeDict['Docs'] || '공식 문서'}'`],
    ["label: 'Connect to WSL'", `label: '${nativeDict['Connect to WSL'] || 'WSL에 연결'}'`],
    ["label: 'Reopen Locally'", `label: '${nativeDict['Reopen Locally'] || '로컬 환경으로 다시 열기'}'`],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchTrayJs(source, nativeDict) {
  let out = source;
  out = out.replace(
    /countItem\.label\s*=\s*\(count\s*>\s*0\s*\?\s*`\$\{count\}`\s*:\s*'No'\)\s*\+\s*' agent'\s*\+\s*\(count\s*===\s*1\s*\?\s*''\s*:\s*'s'\)\s*\+\s*' running';/,
    `countItem.label = count > 0 ? \`\${count}개의 에이전트 실행 중\` : '${nativeDict['No agents running'] || '실행 중인 에이전트 없음'}';`
  );
  return out;
}

function patchWizardHtmlJs(source, uiExact) {
  let out = source;
  const replacements = [
    ['Welcome to Antigravity', uiExact['Welcome to Antigravity'] || 'Antigravity에 오신 것을 환영합니다'],
    ['Welcome to the new Antigravity!', uiExact['Welcome to the new Antigravity!'] || '새로운 Antigravity에 오신 것을 환영합니다!'],
    ['Download the Antigravity IDE', uiExact['Download the Antigravity IDE'] || 'Antigravity IDE 함께 다운로드'],
    ['Explore the new Antigravity', uiExact['Explore the new Antigravity'] || '새로운 Antigravity 시작하기'],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchUtilsJs(source, externalDictPath) {
  const marker = '/* __AGY_KO_I18N_HOOK__ */';
  if (source.includes(marker)) {
    return source;
  }

  const escapedExternalDictPath = externalDictPath.replace(/\\/g, '\\\\');
  const injectionHook = `
    ${marker}
    win.webContents.on('dom-ready', () => {
        try {
            const extDictPath = '${escapedExternalDictPath}';
            const bundledDictPath = path_1.default.join(__dirname, 'ko-KR.json');
            const runtimePath = path_1.default.join(__dirname, 'i18n-runtime.js');
            const dictRaw = fs.existsSync(extDictPath)
                ? fs.readFileSync(extDictPath, 'utf-8')
                : fs.readFileSync(bundledDictPath, 'utf-8');
            const runtimeCode = fs.readFileSync(runtimePath, 'utf-8');
            const scriptToRun = \`window.__AGY_KO_DICT__ = \${dictRaw};\\n\${runtimeCode}\`;
            void win.webContents.executeJavaScript(scriptToRun).catch(() => {});
        } catch (err) {
            console.error('[AGY-KO] Failed to inject Korean i18n runtime:', err);
        }
    });
`;

  const targetAnchor = 'void win.loadURL(url);';
  if (!source.includes(targetAnchor)) {
    throw new Error('Could not find target anchor "void win.loadURL(url);" in dist/utils.js');
  }

  return source.replace(targetAnchor, `${injectionHook}\n    ${targetAnchor}`);
}

/**
 * Discovers active CDP port from Antigravity logs and injects i18n runtime into live windows.
 */
async function injectIntoLiveWindow(mode = 'apply') {
  try {
    let cdpPort = null;
    if (fs.existsSync(LS_LOG_PATH)) {
      const logContent = fs.readFileSync(LS_LOG_PATH, 'utf8');
      const matches = [...logContent.matchAll(/ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//g)];
      if (matches.length > 0) {
        cdpPort = matches[matches.length - 1][1];
      }
    }

    if (!cdpPort) {
      return { injected: false, reason: '활성 CDP 포트를 찾을 수 없습니다 (앱 재시작 시 자동 적용됩니다).' };
    }

    const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
    const targets = await res.json();
    const pageTargets = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);

    if (pageTargets.length === 0) {
      return { injected: false, reason: '열려 있는 Antigravity 창이 없습니다.' };
    }

    const dictRaw = fs.readFileSync(DICT_PATH, 'utf8');
    const runtimeCode = fs.readFileSync(RUNTIME_PATH, 'utf8');

    const results = [];
    for (const page of pageTargets) {
      const stats = await new Promise((resolve, reject) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('CDP WebSocket timeout'));
        }, 4000);

        ws.onopen = () => {
          const expression =
            mode === 'restore'
              ? `window.__AGY_KO_I18N__ ? window.__AGY_KO_I18N__.toggle(false) : false`
              : `window.__AGY_KO_DICT__ = ${dictRaw};\n${runtimeCode}`;

          ws.send(
            JSON.stringify({
              id: 1,
              method: 'Runtime.evaluate',
              params: {
                expression,
                returnByValue: true,
              },
            })
          );
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === 1) {
            clearTimeout(timer);
            ws.close();
            resolve(msg.result?.result?.value);
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(err);
        };
      });
      results.push({ title: page.title, stats });
    }

    return { injected: true, cdpPort, pages: results };
  } catch (err) {
    return { injected: false, reason: err.message };
  }
}

async function applyPatch() {
  console.log('============================================================');
  console.log('  Antigravity 2.0 한국어 패치 적용 (Korean Localization)');
  console.log('============================================================');

  if (!fs.existsSync(ASAR_PATH)) {
    console.error(`[오류] Antigravity 설치 경로를 찾을 수 없습니다: ${ASAR_PATH}`);
    process.exit(1);
  }

  const dictRaw = fs.readFileSync(DICT_PATH, 'utf8');
  const dict = JSON.parse(dictRaw);
  const runtimeRaw = fs.readFileSync(RUNTIME_PATH, 'utf8');

  // 1. Create backup if not already backed up
  if (!fs.existsSync(ASAR_BACKUP_PATH)) {
    console.log(`[1/4] 원본 백업 생성 중 -> ${ASAR_BACKUP_PATH}`);
    fs.copyFileSync(ASAR_PATH, ASAR_BACKUP_PATH);
  } else {
    console.log(`[1/4] 기존 원본 백업 확인됨 -> ${ASAR_BACKUP_PATH}`);
  }

  // 2. Parse clean original from backup so repeated runs are idempotent
  console.log('[2/4] 원본 app.asar.bak 로드 및 메모리 트리 파싱 중...');
  const baseAsarBuf = fs.readFileSync(ASAR_BACKUP_PATH);
  const header = parseAsar(baseAsarBuf);
  const distFiles = header.files.dist.files;

  // 3. Patch Native Electron JS files + inject preload/dom-ready runtime
  console.log('[3/4] 네이티브 메뉴 및 DOM 번역 런타임 주입 중...');
  distFiles['main.js'].__buffer = Buffer.from(
    patchMainJs(distFiles['main.js'].__buffer.toString('utf8'), dict.native || {}),
    'utf8'
  );
  distFiles['menu.js'].__buffer = Buffer.from(
    patchMenuJs(distFiles['menu.js'].__buffer.toString('utf8'), dict.native || {}),
    'utf8'
  );
  distFiles['tray.js'].__buffer = Buffer.from(
    patchTrayJs(distFiles['tray.js'].__buffer.toString('utf8'), dict.native || {}),
    'utf8'
  );
  if (distFiles.ideInstall?.files?.['wizardHtml.js']) {
    distFiles.ideInstall.files['wizardHtml.js'].__buffer = Buffer.from(
      patchWizardHtmlJs(
        distFiles.ideInstall.files['wizardHtml.js'].__buffer.toString('utf8'),
        dict.ui_exact || {}
      ),
      'utf8'
    );
  }
  distFiles['utils.js'].__buffer = Buffer.from(
    patchUtilsJs(distFiles['utils.js'].__buffer.toString('utf8'), DICT_PATH),
    'utf8'
  );

  // Embed ko-KR.json and i18n-runtime.js inside dist/
  distFiles['ko-KR.json'] = {
    __buffer: Buffer.from(dictRaw, 'utf8'),
  };
  distFiles['i18n-runtime.js'] = {
    __buffer: Buffer.from(runtimeRaw, 'utf8'),
  };

  const newAsarBuf = buildAsar(header);
  fs.writeFileSync(ASAR_PATH, newAsarBuf);
  console.log(`      -> app.asar 패치 완료 (${(newAsarBuf.length / 1024 / 1024).toFixed(2)} MB)`);

  // 4. Live inject into currently running window via CDP
  console.log('[4/4] 현재 실행 중인 Antigravity 창에 실시간 한글화 주입 중...');
  const liveResult = await injectIntoLiveWindow('apply');
  if (liveResult.injected) {
    console.log(`      -> 실시간 주입 완료! (CDP 포트: ${liveResult.cdpPort})`);
    for (const p of liveResult.pages) {
      console.log(`      -> 적용된 창: "${p.title}"`, JSON.stringify(p.stats));
    }
  } else {
    console.log(`      -> 안내: ${liveResult.reason}`);
  }

  console.log('\n[완료] Antigravity 2.0 한글화가 성공적으로 적용되었습니다!');
  console.log('  - 한/영 즉시 전환 단축키 : Alt + Shift + K (또는 Ctrl + Alt + L)');
  console.log('  - 미번역 문구 수집 단축키: Ctrl + Alt + Shift + L');
}

async function restorePatch() {
  console.log('============================================================');
  console.log('  Antigravity 2.0 원본 복원 (Restore Original English)');
  console.log('============================================================');

  if (fs.existsSync(ASAR_BACKUP_PATH)) {
    fs.copyFileSync(ASAR_BACKUP_PATH, ASAR_PATH);
    console.log(`[복원 완료] ${ASAR_BACKUP_PATH} -> ${ASAR_PATH}`);
  } else {
    console.log('[안내] 백업 파일(app.asar.bak)이 존재하지 않습니다.');
  }

  const liveResult = await injectIntoLiveWindow('restore');
  if (liveResult.injected) {
    console.log('[실시간 복원] 현재 열린 창의 UI를 영문(원문)으로 전환했습니다.');
  }
}

function showStatus() {
  const hasAsar = fs.existsSync(ASAR_PATH);
  const hasBackup = fs.existsSync(ASAR_BACKUP_PATH);
  let isPatched = false;
  if (hasAsar) {
    const buf = fs.readFileSync(ASAR_PATH);
    const strSize = buf.readUInt32LE(12);
    const headerStr = buf.subarray(16, 16 + strSize).toString('utf8');
    isPatched = headerStr.includes('"i18n-runtime.js"');
  }
  const dict = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  console.log('============================================================');
  console.log('  Antigravity 2.0 한글화 패치 상태 (Status)');
  console.log('============================================================');
  console.log(`  - 설치 경로      : ${DEFAULT_APP_DIR}`);
  console.log(`  - 패치 적용 여부 : ${isPatched ? '적용됨 (Patched)' : '미적용 (Original)'}`);
  console.log(`  - 원본 백업 존재 : ${hasBackup ? '있음 (app.asar.bak)' : '없음'}`);
  console.log(`  - 사전 버전      : v${dict.meta?.version} (${dict.meta?.updatedAt})`);
  console.log(`  - 등록된 번역 수 : 네이티브 ${Object.keys(dict.native || {}).length}개 / 정적 UI ${Object.keys(dict.ui_exact || {}).length}개 / 동적 패턴 ${(dict.ui_patterns || []).length}개`);
}

async function main() {
  const cmd = (process.argv[2] || 'apply').toLowerCase();
  if (cmd === 'apply') {
    await applyPatch();
  } else if (cmd === 'live') {
    const res = await injectIntoLiveWindow('apply');
    console.log('[Live Injection]', JSON.stringify(res, null, 2));
  } else if (cmd === 'restore') {
    await restorePatch();
  } else if (cmd === 'status') {
    showStatus();
  } else {
    console.log('Usage: node src/patcher.js [apply|live|restore|status]');
  }
}

main().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
