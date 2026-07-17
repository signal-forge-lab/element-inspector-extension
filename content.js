(() => {
  'use strict';

  const RUN_MESSAGE_TYPE = 'ELEMENT_INSPECTOR_RUN';
  const NOTICE_HOST_ID = 'element-inspector-notice-host';
  const HIGHLIGHT_HOST_ID = 'element-inspector-highlight-host';
  const NOTICE_DURATION_MS = 2600;
  const HIGHLIGHT_DURATION_MS = 3000;

  let lastContextMenuTarget = null;
  let lastContextMenuAt = null;

  function resolveContextMenuTarget(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const pathElement = path.find(item => item instanceof Element);
    if (pathElement) return pathElement;
    if (event.target instanceof Element) return event.target;
    return event.target?.parentElement || null;
  }

  document.addEventListener('contextmenu', event => {
    lastContextMenuTarget = resolveContextMenuTarget(event);
    lastContextMenuAt = Date.now();
  }, true);

  function copyWithTextarea(text) {
    const parent = document.body || document.documentElement;
    if (!parent) return false;

    const previousFocus = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute('aria-hidden', 'true');
    Object.assign(textarea.style, {
      position: 'fixed',
      top: '-10000px',
      left: '-10000px',
      width: '1px',
      height: '1px',
      opacity: '0'
    });

    parent.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();

    let copied = false;
    try {
      copied = Boolean(document.execCommand?.('copy'));
    } finally {
      textarea.remove();
      try {
        if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
      } catch {}
    }
    return copied;
  }

  async function copyText(text) {
    let clipboardError = null;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true, route: 'navigator.clipboard.writeText' };
      }
    } catch (error) {
      clipboardError = error;
    }

    if (copyWithTextarea(text)) {
      return { ok: true, route: 'document.execCommand.copy' };
    }

    const detail = clipboardError instanceof Error ? clipboardError.message : '';
    throw new Error(detail
      ? `クリップボードへのコピーに失敗しました: ${detail}`
      : 'クリップボードへのコピーに失敗しました');
  }

  function showNotice(message, kind = 'success') {
    document.getElementById(NOTICE_HOST_ID)?.remove();
    const parent = document.documentElement || document.body;
    if (!parent) return;

    const host = document.createElement('div');
    host.id = NOTICE_HOST_ID;
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'right: 18px',
      'bottom: 18px',
      'z-index: 2147483647',
      'pointer-events: none'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.textContent = message;
    notice.style.cssText = [
      'box-sizing: border-box',
      'max-width: min(420px, calc(100vw - 36px))',
      'padding: 10px 13px',
      'border-radius: 10px',
      'border: 1px solid rgba(255,255,255,.18)',
      `background: ${kind === 'error' ? 'rgba(130,28,28,.96)' : 'rgba(24,28,34,.96)'}`,
      'color: #fff',
      'box-shadow: 0 8px 28px rgba(0,0,0,.3)',
      'font: 13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'white-space: pre-wrap'
    ].join(';');

    shadow.appendChild(notice);
    parent.appendChild(host);
    setTimeout(() => host.remove(), NOTICE_DURATION_MS);
  }

  function showElementHighlight(element, durationMs = HIGHLIGHT_DURATION_MS) {
    if (!(element instanceof Element) || !element.isConnected) return;

    document.getElementById(HIGHLIGHT_HOST_ID)?.remove();
    const parent = document.documentElement || document.body;
    if (!parent) return;

    const host = document.createElement('div');
    host.id = HIGHLIGHT_HOST_ID;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'inset: 0',
      'z-index: 2147483646',
      'pointer-events: none'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      @keyframes element-inspector-highlight-pulse {
        0%, 40%, 75% {
          opacity: 1;
          filter: brightness(1.15);
        }
        20%, 60% {
          opacity: .28;
          filter: brightness(.55);
        }
        100% {
          opacity: 0;
          filter: brightness(.8);
        }
      }
    `;
    const marker = document.createElement('div');
    marker.style.cssText = [
      'box-sizing: border-box',
      'position: fixed',
      'pointer-events: none',
      'border: 3px solid #fff',
      'box-shadow: 0 0 0 3px #000, 0 0 18px 6px rgba(0,0,0,.45)',
      'border-radius: 4px',
      `animation: element-inspector-highlight-pulse ${durationMs}ms ease-in-out forwards`
    ].join(';');

    shadow.append(style, marker);
    parent.appendChild(host);

    let animationFrameId = null;
    let removed = false;

    function removeHighlight() {
      if (removed) return;
      removed = true;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      host.remove();
    }

    function updatePosition() {
      if (removed) return;
      if (!element.isConnected) {
        removeHighlight();
        return;
      }

      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      marker.style.display = visible ? 'block' : 'none';

      if (visible) {
        marker.style.top = `${rect.top}px`;
        marker.style.left = `${rect.left}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
      }

      animationFrameId = requestAnimationFrame(updatePosition);
    }

    updatePosition();
    marker.addEventListener('animationend', removeHighlight, { once: true });
    setTimeout(removeHighlight, durationMs + 150);
  }

  async function runInspection() {
    if (!(lastContextMenuTarget instanceof Element)) {
      throw new Error('右クリックした要素が見つかりません');
    }
    if (!lastContextMenuTarget.isConnected) {
      throw new Error('右クリックした要素はすでにページから削除されています');
    }
    if (!globalThis.ElementInspector?.inspectElement) {
      throw new Error('要素解析モジュールを利用できません');
    }

    const result = globalThis.ElementInspector.inspectElement(lastContextMenuTarget);
    const json = JSON.stringify(result, null, 2);
    const copy = await copyText(json);

    console.groupCollapsed('[Element Inspector] JSONをクリップボードへコピーしました');
    console.log(result);
    console.log(json);
    console.groupEnd();

    showElementHighlight(lastContextMenuTarget);
    showNotice('Element Inspector\nJSONをクリップボードへコピーしました');
    return {
      ok: true,
      copied: true,
      copyRoute: copy.route,
      selectedTag: result.selectedTag || null,
      controlTag: result.controlTag || null,
      contextMenuAt: lastContextMenuAt
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== RUN_MESSAGE_TYPE) return undefined;

    runInspection()
      .then(sendResponse)
      .catch(error => {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error('[Element Inspector]', error);
        showNotice(`Element Inspector\n${messageText}`, 'error');
        sendResponse({ ok: false, error: messageText });
      });

    return true;
  });
})();
