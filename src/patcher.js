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

// Disable Electron's asar interception so we can read/write app.asar directly as a raw file
process.noAsar = true;

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

function isAsarPatched(targetPath = ASAR_PATH) {
  if (!fs.existsSync(targetPath)) return false;
  try {
    const buf = fs.readFileSync(targetPath);
    if (buf.length < 16) return false;
    const strSize = buf.readUInt32LE(12);
    const headerStr = buf.subarray(16, 16 + strSize).toString('utf8');
    return headerStr.includes('"i18n-runtime.js"');
  } catch (_e) {
    return false;
  }
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
    ['label: `Open ${electron_1.app.getName()}`', 'label: `${electron_1.app.getName()} 열기`'],
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
    ["showErrorBox('Binary not found'", `showErrorBox('${nativeDict['Binary not found'] || '바이너리를 찾을 수 없음'}'`],
    ["title: 'WSL distro not found'", `title: '${nativeDict['WSL distro not found'] || 'WSL 배포판을 찾을 수 없음'}'`],
    [
      'message: `The WSL distro "${WSL_DISTRO}" is no longer installed.`',
      'message: `WSL 배포판 "${WSL_DISTRO}"이(가) 더 이상 설치되어 있지 않습니다.`',
    ],
    [
      "detail: 'Antigravity opened on Windows instead.'",
      `detail: '${nativeDict['Antigravity opened on Windows instead.'] || '대신 Windows 환경에서 Antigravity를 열었습니다.'}'`,
    ],
    ["showErrorBox('WSL setup failed'", `showErrorBox('${nativeDict['WSL setup failed'] || 'WSL 설정 실패'}'`],
    ["showErrorBox('Startup failed'", `showErrorBox('${nativeDict['Startup failed'] || '시작 실패'}'`],
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
    ["label: item.label || 'Actual Size'", `label: '${nativeDict['Actual Size'] || '실제 크기'}'`],
    ["label: item.label || 'Zoom In'", `label: '${nativeDict['Zoom In'] || '확대'}'`],
    ["label: 'Zoom In'", `label: '${nativeDict['Zoom In'] || '확대'}'`],
    ["label: item.label || 'Zoom Out'", `label: '${nativeDict['Zoom Out'] || '축소'}'`],
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

function patchUpdaterJs(source, nativeDict) {
  let out = source;
  const replacements = [
    ['MenuUpdateStep["CheckForUpdates"] = "Check for Updates";', `MenuUpdateStep["CheckForUpdates"] = "${nativeDict['Check for Updates'] || '업데이트 확인'}";`],
    ['MenuUpdateStep["CheckingForUpdates"] = "Checking for Updates...";', `MenuUpdateStep["CheckingForUpdates"] = "${nativeDict['Checking for Updates...'] || '업데이트 확인 중...'}";`],
    ['MenuUpdateStep["DownloadingUpdate"] = "Downloading Update...";', `MenuUpdateStep["DownloadingUpdate"] = "${nativeDict['Downloading Update...'] || '업데이트 다운로드 중...'}";`],
    ['MenuUpdateStep["RestartToUpdate"] = "Restart to Update";', `MenuUpdateStep["RestartToUpdate"] = "${nativeDict['Restart to Update'] || '재시작하여 업데이트'}";`],
    ["title: 'Check for Updates'", `title: '${nativeDict['Check for Updates'] || '업데이트 확인'}'`],
    ["message: 'No updates available'", `message: '${nativeDict['No updates available'] || '사용 가능한 업데이트가 없습니다'}'`],
    ["buttons: ['OK']", `buttons: ['${nativeDict['OK'] || '확인'}']`],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchIpcHandlersJs(source, nativeDict) {
  let out = source;
  const replacements = [
    ["showErrorBox('Cannot open folder'", `showErrorBox('${nativeDict['Cannot open folder'] || '폴더를 열 수 없음'}'`],
    ["message: 'Folder is on the Windows filesystem'", `message: '${nativeDict['Folder is on the Windows filesystem'] || '폴더가 Windows 파일 시스템에 있습니다'}'`],
    ["title: 'Open workspace'", `title: '${nativeDict['Open workspace'] || '작업 공간 열기'}'`],
    ["title: 'Open workspaces'", `title: '${nativeDict['Open workspaces'] || '작업 공간 열기'}'`],
    ["title: 'Select Download Folder'", `title: '${nativeDict['Select Download Folder'] || '다운로드 폴더 선택'}'`],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchWizardHtmlJs(source, uiExact, nativeDict = {}) {
  let out = source;
  const replacements = [
    ['Welcome to Antigravity', uiExact['Welcome to Antigravity'] || 'Antigravity에 오신 것을 환영합니다'],
    ['Welcome to the new Antigravity!', uiExact['Welcome to the new Antigravity!'] || '새로운 Antigravity에 오신 것을 환영합니다!'],
    ['Download the Antigravity IDE', uiExact['Download the Antigravity IDE'] || 'Antigravity IDE 함께 다운로드'],
    ['Explore the new Antigravity', uiExact['Explore the new Antigravity'] || '새로운 Antigravity 시작하기'],
    ['>Setting up…<', `>${nativeDict['Setting up…'] || '설정 중…'}<`],
    [
      "Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named <b>Antigravity IDE</b>.",
      'Antigravity가 새로운 기능과 함께 에이전트 중심 환경으로 새롭게 설계되었습니다. 코드 에디터가 필요하신 경우 별도 앱인 <b>Antigravity IDE</b>로 함께 다운로드하실 수 있습니다.',
    ],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchProvisionSplashJs(source, nativeDict = {}) {
  return source.split('<div>Setting up WSL: ').join(`<div>${nativeDict['Setting up WSL: '] || 'WSL 설정 중: '}`);
}

function patchDeviceChooserJs(source, nativeDict = {}) {
  let out = source;
  const replacements = [
    ["hid: 'HID device'", `hid: '${nativeDict['HID device'] || 'HID 기기'}'`],
    ["usb: 'USB device'", `usb: '${nativeDict['USB device'] || 'USB 기기'}'`],
    ["serial: 'serial port'", `serial: '${nativeDict['serial port'] || '직렬 포트'}'`],
    ["'Unknown device'", `'${nativeDict['Unknown device'] || '알 수 없는 기기'}'`],
    ["title: 'Connect a device'", `title: '${nativeDict['Connect a device'] || '기기 연결'}'`],
    ['message: `${origin} wants to connect to a ${KIND_NOUNS[kind]}`', 'message: `${origin}에서 ${KIND_NOUNS[kind]} 연결을 요청합니다`'],
    ["? 'Select a device:'", `? '${nativeDict['Select a device:'] || '기기를 선택하세요:'}'`],
    [": 'No compatible devices found.'", `: '${nativeDict['No compatible devices found.'] || '호환되는 기기를 찾을 수 없습니다.'}'`],
    ["buttons: [...snapshot.map(({ label }) => label), 'Cancel']", `buttons: [...snapshot.map(({ label }) => label), '${nativeDict['Cancel'] || '취소'}']`],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchWebauthnAndCableJs(source, nativeDict = {}) {
  let out = source;
  const replacements = [
    ["title: 'Choose a Passkey'", `title: '${nativeDict['Choose a Passkey'] || '패스키 선택'}'`],
    ['message: `Sign in to ${rpLabel}`', 'message: `${rpLabel}에 로그인`'],
    ["detail: 'Select a passkey account to continue:'", `detail: '${nativeDict['Select a passkey account to continue:'] || '계속하려면 패스키 계정을 선택하세요:'}'`],
    ["buttons: [...accountLabels, 'Cancel']", `buttons: [...accountLabels, '${nativeDict['Cancel'] || '취소'}']`],
    ['<title>Passkeys</title>', `<title>${nativeDict['Passkeys'] || '패스키'}</title>`],
    ['<h1 class="sheet-title">Passkeys</h1>', `<h1 class="sheet-title">${nativeDict['Passkeys'] || '패스키'}</h1>`],
    ['<p class="mechanism-header">Use your phone or tablet</p>', `<p class="mechanism-header">${nativeDict['Use your phone or tablet'] || '휴대폰 또는 태블릿 사용'}</p>`],
    [
      'Scan this QR code with the camera on the device that has your passkey for ${safeRpId}',
      '${safeRpId} 패스키가 저장된 기기의 카메라로 이 QR 코드를 스캔하세요',
    ],
    ['onclick="window.close()">Cancel</button>', `onclick="window.close()">${nativeDict['Cancel'] || '취소'}</button>`],
    ["title: 'Passkeys'", `title: '${nativeDict['Passkeys'] || '패스키'}'`],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function patchWebviewPopupSecurityJs(source, nativeDict = {}) {
  let out = source;
  const replacements = [
    ["insecure: 'Not secure'", `insecure: '${nativeDict['Not secure'] || '보안 연결 아님'}'`],
    ["dangerous: '⚠ Not secure'", `dangerous: '${nativeDict['⚠ Not secure'] || '⚠ 보안 연결 아님'}'`],
    ["'Your connection to this site is not secure'", `'${nativeDict['Your connection to this site is not secure'] || '이 사이트와의 연결이 안전하지 않습니다'}'`],
    ["'Connection is secure'", `'${nativeDict['Connection is secure'] || '보안 연결됨'}'`],
    [
      "'Connection security information is not available for this page'",
      `'${nativeDict['Connection security information is not available for this page'] || '이 페이지의 연결 보안 정보를 확인할 수 없습니다'}'`,
    ],
    ["'Certificate is valid'", `'${nativeDict['Certificate is valid'] || '유효한 인증서'}'`],
    ["'Certificate details'", `'${nativeDict['Certificate details'] || '인증서 세부 정보'}'`],
    ["label: 'Connection info…'", `label: '${nativeDict['Connection info…'] || '연결 정보…'}'`],
    ["title: 'Connection info'", `title: '${nativeDict['Connection info'] || '연결 정보'}'`],
    ["buttons: ['OK']", `buttons: ['${nativeDict['OK'] || '확인'}']`],
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
    const __buildAgyKoScript = () => {
        const extDictPath = '${escapedExternalDictPath}';
        const bundledDictPath = path_1.default.join(__dirname, 'ko-KR.json');
        const runtimePath = path_1.default.join(__dirname, 'i18n-runtime.js');
        const dictRaw = fs.existsSync(extDictPath)
            ? fs.readFileSync(extDictPath, 'utf-8')
            : fs.readFileSync(bundledDictPath, 'utf-8');
        const runtimeCode = fs.readFileSync(runtimePath, 'utf-8');
        return \`window.__AGY_KO_DICT__ = \${dictRaw};\\n\${runtimeCode}\`;
    };
    win.webContents.on('dom-ready', () => {
        try {
            void win.webContents.executeJavaScript(__buildAgyKoScript()).catch(() => {});
        } catch (err) {
            console.error('[AGY-KO] Failed to inject Korean i18n runtime:', err);
        }
    });
    win.webContents.on('did-frame-finish-load', (_ev, isMainFrame, frameProcessId, frameRoutingId) => {
        if (isMainFrame) return;
        try {
            const frame = electron_1.webFrameMain?.fromId?.(frameProcessId, frameRoutingId);
            const fUrl = frame?.url || '';
            if (frame && (fUrl.startsWith('plugin://') || fUrl.startsWith('https://127.0.0.1') || fUrl.startsWith('http://127.0.0.1'))) {
                void frame.executeJavaScript(__buildAgyKoScript()).catch(() => {});
            }
        } catch (_err) {}
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
    const pageTargets = targets.filter(
      (t) =>
        (t.type === 'page' || (t.type === 'iframe' && typeof t.url === 'string' && t.url.startsWith('plugin://'))) &&
        t.webSocketDebuggerUrl
    );

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

  // 1. Create backup if not already backed up, or refresh backup if app.asar is a fresh unpatched update
  const isCurrentPatched = isAsarPatched(ASAR_PATH);
  if (!isCurrentPatched) {
    console.log(`[1/4] 신규 버전(순정) 감지 -> 원본 백업 갱신: ${ASAR_BACKUP_PATH}`);
    fs.copyFileSync(ASAR_PATH, ASAR_BACKUP_PATH);
  } else if (!fs.existsSync(ASAR_BACKUP_PATH)) {
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
  const nativeDict = dict.native || {};
  distFiles['main.js'].__buffer = Buffer.from(
    patchMainJs(distFiles['main.js'].__buffer.toString('utf8'), nativeDict),
    'utf8'
  );
  distFiles['menu.js'].__buffer = Buffer.from(
    patchMenuJs(distFiles['menu.js'].__buffer.toString('utf8'), nativeDict),
    'utf8'
  );
  distFiles['tray.js'].__buffer = Buffer.from(
    patchTrayJs(distFiles['tray.js'].__buffer.toString('utf8'), nativeDict),
    'utf8'
  );
  if (distFiles['updater.js']) {
    distFiles['updater.js'].__buffer = Buffer.from(
      patchUpdaterJs(distFiles['updater.js'].__buffer.toString('utf8'), nativeDict),
      'utf8'
    );
  }
  if (distFiles['ipcHandlers.js']) {
    distFiles['ipcHandlers.js'].__buffer = Buffer.from(
      patchIpcHandlersJs(distFiles['ipcHandlers.js'].__buffer.toString('utf8'), nativeDict),
      'utf8'
    );
  }
  if (distFiles.ideInstall?.files?.['wizardHtml.js']) {
    distFiles.ideInstall.files['wizardHtml.js'].__buffer = Buffer.from(
      patchWizardHtmlJs(
        distFiles.ideInstall.files['wizardHtml.js'].__buffer.toString('utf8'),
        dict.ui_exact || {},
        nativeDict
      ),
      'utf8'
    );
  }
  if (distFiles['provisionSplash.js']) {
    distFiles['provisionSplash.js'].__buffer = Buffer.from(
      patchProvisionSplashJs(distFiles['provisionSplash.js'].__buffer.toString('utf8'), nativeDict),
      'utf8'
    );
  }
  if (distFiles['deviceChooser.js']) {
    distFiles['deviceChooser.js'].__buffer = Buffer.from(
      patchDeviceChooserJs(distFiles['deviceChooser.js'].__buffer.toString('utf8'), nativeDict),
      'utf8'
    );
  }
  for (const webauthnFile of ['webauthn.js', 'cablev2.js']) {
    if (distFiles[webauthnFile]) {
      distFiles[webauthnFile].__buffer = Buffer.from(
        patchWebauthnAndCableJs(distFiles[webauthnFile].__buffer.toString('utf8'), nativeDict),
        'utf8'
      );
    }
  }
  if (distFiles['webviewPopupSecurity.js']) {
    distFiles['webviewPopupSecurity.js'].__buffer = Buffer.from(
      patchWebviewPopupSecurityJs(distFiles['webviewPopupSecurity.js'].__buffer.toString('utf8'), nativeDict),
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


async function waitForFileReady(filePath, maxRetries = 15, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (!fs.existsSync(filePath)) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      const fd = fs.openSync(filePath, 'r');
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
  return false;
}

function showWindowsNotification(title, message) {
  try {
    const psCmd = `
      [reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null
      $n = New-Object System.Windows.Forms.NotifyIcon
      $n.Icon = [System.Drawing.SystemIcons]::Information
      $n.Visible = $true
      $n.ShowBalloonTip(5000, '${title.replace(/'/g, "''")}', '${message.replace(/'/g, "''")}', [System.Windows.Forms.ToolTipIcon]::Info)
      Start-Sleep -Milliseconds 1500
      $n.Dispose()
    `;
    const cp = require('child_process');
    cp.spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch (_e) {}
}

let isHealing = false;
async function checkAndAutoHeal() {
  if (isHealing) return;
  if (!fs.existsSync(ASAR_PATH)) return;

  const patched = isAsarPatched(ASAR_PATH);
  if (!patched) {
    isHealing = true;
    const timeStr = new Date().toLocaleTimeString();
    console.log(`[${timeStr}] [Auto-Heal] Antigravity 새 버전(순정 상태) 감지! 자동으로 한글 패치를 재적용합니다...`);

    const ready = await waitForFileReady(ASAR_PATH, 15, 1000);
    if (!ready) {
      console.warn(`[Auto-Heal] app.asar 파일 준비 대기 시간 초과. 다음 주기에 재시도합니다.`);
      isHealing = false;
      return;
    }

    try {
      await applyPatch();
      console.log(`[${timeStr}] [Auto-Heal] 한글 패치가 자동으로 성공적으로 재적용되었습니다!`);
      showWindowsNotification(
        'Antigravity 한글 패치',
        '앱 업데이트가 감지되어 한글 패치가 자동으로 재적용되었습니다.'
      );
    } catch (err) {
      console.error(`[Auto-Heal 오류] 패치 재적용 실패:`, err.message);
    } finally {
      isHealing = false;
    }
  }
}

async function watchMode() {
  console.log('============================================================');
  console.log('  Antigravity 2.0 한글 패치 자동 유지 (Auto-Heal Watcher)');
  console.log('============================================================');
  console.log(`  - 감시 대상      : ${RESOURCES_DIR}`);
  console.log('  - 동작 모드      : 업데이트 감지 시 자동 재적용 (백그라운드 상주)');
  console.log('  - 종료 방법      : Ctrl + C\n');

  // 1. Initial check
  await checkAndAutoHeal();

  // 2. Directory watcher with debouncing
  let debounceTimer = null;
  if (fs.existsSync(RESOURCES_DIR)) {
    try {
      fs.watch(RESOURCES_DIR, (eventType, filename) => {
        if (!filename || filename.toLowerCase().includes('asar')) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            checkAndAutoHeal();
          }, 3000);
        }
      });
      console.log('[Auto-Heal] 실시간 디렉터리 감시가 활성화되었습니다.');
    } catch (e) {
      console.warn('[Auto-Heal] fs.watch 초기화 실패 (주기적 폴링으로 대체):', e.message);
    }
  }

  // 3. Fallback polling every 30 seconds
  setInterval(() => {
    checkAndAutoHeal();
  }, 30000);

  // Keep process alive indefinitely
  await new Promise(() => {});
}

function showStatus() {
  const hasAsar = fs.existsSync(ASAR_PATH);
  const hasBackup = fs.existsSync(ASAR_BACKUP_PATH);
  const isPatched = isAsarPatched(ASAR_PATH);
  const dict = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));

  const STARTUP_DIR = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
  const STARTUP_LNK = path.join(STARTUP_DIR, 'AntigravityKoreanAutoHeal.lnk');
  const hasAutoHeal = fs.existsSync(STARTUP_LNK);

  console.log('============================================================');
  console.log('  Antigravity 2.0 한글화 패치 상태 (Status)');
  console.log('============================================================');
  console.log(`  - 설치 경로            : ${DEFAULT_APP_DIR}`);
  console.log(`  - 패치 적용 여부       : ${isPatched ? '적용됨 (Patched)' : '미적용 (Original)'}`);
  console.log(`  - 원본 백업 존재       : ${hasBackup ? '있음 (app.asar.bak)' : '없음'}`);
  console.log(`  - 자동 유지(Auto-Heal) : ${hasAutoHeal ? '활성화됨 (부팅 시 자동 상주)' : '비활성화됨 (enable-autoheal 로 활성화)'}`);
  console.log(`  - 사전 버전            : v${dict.meta?.version} (${dict.meta?.updatedAt})`);
  console.log(`  - 등록된 번역 수       : 네이티브 ${Object.keys(dict.native || {}).length}개 / 정적 UI ${Object.keys(dict.ui_exact || {}).length}개 / 동적 패턴 ${(dict.ui_patterns || []).length}개`);
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
  } else if (cmd === 'watch') {
    await watchMode();
  } else {
    console.log('Usage: node src/patcher.js [apply|live|restore|status|watch]');
  }
}

main().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
