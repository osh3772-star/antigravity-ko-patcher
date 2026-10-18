/**
 * Antigravity 2.0 Korean Localization Runtime Engine (i18n-runtime.js)
 *
 * Injected into BrowserWindow (via Electron dom-ready / preload or live CDP).
 * Features:
 * - O(1) exact string matching + regex pattern matching
 * - Attribute translation (placeholder, title, aria-label)
 * - Code / Editor / Terminal safe-guard exclusion filter
 * - WeakMap original text preservation for zero-reload Ko/En toggle (Alt+Shift+K / Ctrl+Alt+L)
 * - Untranslated UI string collector to clipboard (Ctrl+Alt+Shift+L)
 * - Automatic same-origin <iframe> & open ShadowRoot observation
 */
(function initAntigravityKoreanRuntime(injectedDict) {
  'use strict';

  const EXCLUDED_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'PRE',
    'CODE',
    'TEXTAREA',
    'INPUT',
    'SVG',
    'PATH',
    'MATH',
  ]);

  const EXCLUDED_SELECTOR = [
    'pre',
    'code',
    '.token',
    '.monaco-editor',
    '.cm-editor',
    '.xterm',
    '.line-number',
    '[contenteditable="true"]',
    '[aria-label="File Viewer"] .font-mono',
    '[data-no-i18n]',
  ].join(',');

  const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'aria-label'];

  // If already initialized, just hot-reload the dictionary and re-apply
  if (window.__AGY_KO_I18N__ && injectedDict) {
    window.__AGY_KO_I18N__.updateDictionary(injectedDict);
    return window.__AGY_KO_I18N__.getStats();
  }

  let dict = injectedDict || window.__AGY_KO_DICT__ || { ui_exact: {}, ui_patterns: [] };
  let exactMap = new Map();
  let compiledPatterns = [];
  let enabled = true;

  const origTextMap = new WeakMap();
  const lastTranslatedTextMap = new WeakMap();
  const origAttrMap = new WeakMap();
  const lastTranslatedAttrMap = new WeakMap();
  const observedDocs = new WeakSet();
  const observedRoots = new WeakSet();

  let translatedNodeCount = 0;
  let translatedAttrCount = 0;

  function compileDictionary(newDict) {
    dict = newDict || { ui_exact: {}, ui_patterns: [] };
    exactMap = new Map(Object.entries(dict.ui_exact || {}));
    compiledPatterns = (dict.ui_patterns || []).map((item) => {
      try {
        return {
          regex: new RegExp(item.match),
          replace: item.replace,
        };
      } catch (_e) {
        return null;
      }
    }).filter(Boolean);
  }

  compileDictionary(dict);

  function translateString(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 500) return null;

    // Normalize typographic apostrophes / quotes for lookup
    const normalized = trimmed.replace(/[\u2018\u2019]/g, "'");

    // 1. Exact lookup
    let hit = exactMap.get(trimmed) ?? exactMap.get(normalized);
    if (hit !== undefined) {
      const lead = raw.match(/^\s*/)?.[0] || '';
      const trail = raw.match(/\s*$/)?.[0] || '';
      return lead + hit + trail;
    }

    // 2. Pattern lookup
    for (let i = 0; i < compiledPatterns.length; i++) {
      const { regex, replace } = compiledPatterns[i];
      if (regex.test(trimmed)) {
        const replaced = trimmed.replace(regex, replace);
        // Clean up empty optional capture groups like "5분  동안 작업함" -> "5분 동안 작업함"
        const cleaned = replaced
          .replace(/\s+초 동안/g, ' 동안')
          .replace(/\s{2,}/g, ' ')
          .trim();
        const lead = raw.match(/^\s*/)?.[0] || '';
        const trail = raw.match(/\s*$/)?.[0] || '';
        return lead + cleaned + trail;
      }
    }

    return null;
  }

  function isExcludedElement(el) {
    if (!el || el.nodeType !== 1) return true;
    if (EXCLUDED_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    try {
      if (el.closest(EXCLUDED_SELECTOR)) return true;
    } catch (_e) {
      return true;
    }
    return false;
  }

  function processTextNode(node) {
    if (!node || node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (!parent || isExcludedElement(parent)) return;

    const currentVal = node.nodeValue;
    if (!currentVal || !currentVal.trim()) return;

    const lastTrans = lastTranslatedTextMap.get(node);
    if (currentVal !== lastTrans) {
      // Either never translated or React updated the text node with a fresh English string
      if (!origTextMap.has(node) || enabled) {
        origTextMap.set(node, currentVal);
      }
    }

    const originalVal = origTextMap.get(node) ?? currentVal;

    if (!enabled) {
      if (node.nodeValue !== originalVal) {
        node.nodeValue = originalVal;
      }
      return;
    }

    const translated = translateString(originalVal);
    if (translated && translated !== currentVal) {
      lastTranslatedTextMap.set(node, translated);
      node.nodeValue = translated;
      translatedNodeCount++;
    }
  }

  function processAttributes(el) {
    if (!el || el.nodeType !== 1) return;
    if (EXCLUDED_TAGS.has(el.tagName) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      return;
    }

    let origAttrs = origAttrMap.get(el);
    let lastAttrs = lastTranslatedAttrMap.get(el);

    for (let i = 0; i < TRANSLATABLE_ATTRS.length; i++) {
      const attr = TRANSLATABLE_ATTRS[i];
      if (!el.hasAttribute(attr)) continue;
      const currentVal = el.getAttribute(attr);
      if (!currentVal) continue;

      if (!origAttrs) {
        origAttrs = {};
        origAttrMap.set(el, origAttrs);
      }
      if (!lastAttrs) {
        lastAttrs = {};
        lastTranslatedAttrMap.set(el, lastAttrs);
      }

      if (currentVal !== lastAttrs[attr]) {
        if (!(attr in origAttrs) || enabled) {
          origAttrs[attr] = currentVal;
        }
      }

      const originalVal = origAttrs[attr] ?? currentVal;
      if (!enabled) {
        if (currentVal !== originalVal) {
          el.setAttribute(attr, originalVal);
        }
        continue;
      }

      const translated = translateString(originalVal);
      if (translated && translated !== currentVal) {
        lastAttrs[attr] = translated;
        el.setAttribute(attr, translated);
        translatedAttrCount++;
      }
    }
  }

  function walkRoot(root) {
    if (!root) return;

    // 1. Walk elements and their text children + attributes
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    if (root.nodeType === 1) {
      processAttributes(root);
      for (let i = 0; i < root.childNodes.length; i++) {
        if (root.childNodes[i].nodeType === 3) {
          processTextNode(root.childNodes[i]);
        }
      }
    }

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      processAttributes(el);

      const children = el.childNodes;
      for (let j = 0; j < children.length; j++) {
        if (children[j].nodeType === 3) {
          processTextNode(children[j]);
        }
      }

      if (el.shadowRoot) {
        observeRoot(el.shadowRoot);
      }
      if (el.tagName === 'IFRAME') {
        hookIframe(el);
      }
    }
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);

    walkRoot(root);

    let pendingNodes = new Set();
    let scheduled = false;

    const flush = () => {
      scheduled = false;
      const batch = Array.from(pendingNodes);
      pendingNodes.clear();
      for (let i = 0; i < batch.length; i++) {
        const target = batch[i];
        if (target.nodeType === 3) {
          processTextNode(target);
        } else if (target.nodeType === 1 || target.nodeType === 11) {
          walkRoot(target);
        }
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'characterData') {
          pendingNodes.add(m.target);
        } else if (m.type === 'attributes') {
          pendingNodes.add(m.target);
        } else if (m.type === 'childList') {
          for (let j = 0; j < m.addedNodes.length; j++) {
            pendingNodes.add(m.addedNodes[j]);
          }
        }
      }
      if (pendingNodes.size > 0 && !scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRS,
    });
  }

  function hookIframe(iframe) {
    if (!iframe) return;
    const tryAttach = () => {
      try {
        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;
        if (doc && doc.documentElement) {
          attachToDocument(doc, win);
        }
      } catch (_e) {
        // Cross-origin iframe, ignore safely
      }
    };
    iframe.addEventListener('load', tryAttach);
    tryAttach();
  }

  function showToast(message) {
    try {
      const doc = window.document;
      let toast = doc.getElementById('agy-ko-i18n-toast');
      if (!toast) {
        toast = doc.createElement('div');
        toast.id = 'agy-ko-i18n-toast';
        toast.setAttribute('data-no-i18n', 'true');
        Object.assign(toast.style, {
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: '2147483647',
          background: 'rgba(20, 20, 24, 0.94)',
          color: '#f5f5f7',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: '10px',
          padding: '10px 16px',
          fontSize: '13px',
          fontWeight: '500',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", "Segoe UI", sans-serif',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
          pointerEvents: 'none',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
          opacity: '0',
          transform: 'translateY(8px)',
        });
        doc.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
      clearTimeout(toast.__timer);
      toast.__timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
      }, 2400);
    } catch (_e) {}
  }

  function collectUntranslatedStrings() {
    const untranslated = new Set();
    const elements = document.querySelectorAll('*');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (isExcludedElement(el)) continue;
      for (let j = 0; j < el.childNodes.length; j++) {
        const n = el.childNodes[j];
        if (n.nodeType === 3) {
          const orig = (origTextMap.get(n) ?? n.nodeValue ?? '').trim();
          if (
            orig.length >= 2 &&
            orig.length <= 80 &&
            /[A-Za-z]{2,}/.test(orig) &&
            !/[가-힣]/.test(orig) &&
            !translateString(orig)
          ) {
            untranslated.add(orig);
          }
        }
      }
    }
    const resultObj = {};
    Array.from(untranslated).sort().forEach((k) => {
      resultObj[k] = '';
    });
    const jsonText = JSON.stringify(resultObj, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonText).catch(() => {});
    }
    showToast(`📋 미번역 영문 문구 ${untranslated.size}개를 클립보드에 복사했습니다.`);
    return resultObj;
  }

  function attachToDocument(doc, win) {
    if (!doc || observedDocs.has(doc)) return;
    observedDocs.add(doc);

    if (doc.documentElement) {
      observeRoot(doc.documentElement);
    } else {
      doc.addEventListener('DOMContentLoaded', () => {
        if (doc.documentElement) observeRoot(doc.documentElement);
      });
    }

    const targetWin = win || window;
    targetWin.addEventListener(
      'keydown',
      (e) => {
        // Alt+Shift+K or Ctrl+Alt+L -> Toggle Korean / English
        const isToggle =
          (e.altKey && e.shiftKey && !e.ctrlKey && e.code === 'KeyK') ||
          (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyL');

        // Ctrl+Alt+Shift+L -> Collect untranslated strings
        const isCollect = e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyL';

        if (isToggle) {
          e.preventDefault();
          e.stopPropagation();
          window.__AGY_KO_I18N__.toggle();
        } else if (isCollect) {
          e.preventDefault();
          e.stopPropagation();
          collectUntranslatedStrings();
        }
      },
      true
    );
  }

  // Hook open Shadow DOM creation
  if (typeof Element !== 'undefined' && Element.prototype.attachShadow) {
    const origAttachShadow = Element.prototype.attachShadow;
    if (!origAttachShadow.__agyKoHooked) {
      const wrapped = function (init) {
        const shadowRoot = origAttachShadow.call(this, init);
        observeRoot(shadowRoot);
        return shadowRoot;
      };
      wrapped.__agyKoHooked = true;
      Element.prototype.attachShadow = wrapped;
    }
  }

  window.__AGY_KO_I18N__ = {
    updateDictionary(newDict) {
      compileDictionary(newDict);
      walkRoot(document.documentElement);
      const iframes = document.querySelectorAll('iframe');
      for (let i = 0; i < iframes.length; i++) {
        try {
          if (iframes[i].contentDocument?.documentElement) {
            walkRoot(iframes[i].contentDocument.documentElement);
          }
        } catch (_e) {}
      }
      showToast('🇰🇷 Antigravity 한글화 사전이 적용되었습니다 (Alt+Shift+K: 한/영 전환)');
    },
    toggle(forceState) {
      enabled = typeof forceState === 'boolean' ? forceState : !enabled;
      walkRoot(document.documentElement);
      const iframes = document.querySelectorAll('iframe');
      for (let i = 0; i < iframes.length; i++) {
        try {
          if (iframes[i].contentDocument?.documentElement) {
            walkRoot(iframes[i].contentDocument.documentElement);
          }
        } catch (_e) {}
      }
      showToast(
        enabled
          ? '🇰🇷 한국어 UI 모드 활성화 (Alt+Shift+K)'
          : '🇺🇸 영문(원문) UI 모드 전환 (Alt+Shift+K)'
      );
      return enabled;
    },
    collectUntranslated: collectUntranslatedStrings,
    getStats() {
      return {
        enabled,
        exactEntries: exactMap.size,
        patternEntries: compiledPatterns.length,
        translatedNodeCount,
        translatedAttrCount,
      };
    },
  };

  attachToDocument(document, window);
  return window.__AGY_KO_I18N__.getStats();
})();
