(() => {
  'use strict';

  const EXTENSION_VERSION = '0.6.2';
  const TOGGLE_MESSAGE_TYPE = 'ELEMENT_INSPECTOR_TOGGLE';
  const ROOT_ATTRIBUTE = 'data-element-inspector-ui';
  const DEFAULT_DELAY_SECONDS = 5;

  const state = {
    open: false,
    mode: 'idle',
    hoveredElement: null,
    selectedElement: null,
    highlightedElement: null,
    result: null,
    countdownTimer: null,
    countdownDeadline: 0,
    countdownRemaining: 0,
    animationFrameId: null,
    drag: null
  };

  const ui = {
    host: null,
    shadow: null,
    panel: null,
    header: null,
    marker: null,
    modeBadge: null,
    status: null,
    tag: null,
    identity: null,
    rect: null,
    text: null,
    preview: null,
    selectButton: null,
    parentButton: null,
    childButton: null,
    delayInput: null,
    delayButton: null,
    copyButton: null,
    downloadButton: null
  };

  function isElement(value) {
    return value instanceof Element;
  }

  function isInspectorEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.includes(ui.host) || path.some(item =>
      isElement(item) && item.hasAttribute?.(ROOT_ATTRIBUTE)
    );
  }

  function resolveEventElement(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const pathElement = path.find(item =>
      isElement(item) && item !== ui.host && !item.hasAttribute?.(ROOT_ATTRIBUTE)
    );
    if (pathElement) return pathElement;
    return isElement(event.target) ? event.target : event.target?.parentElement || null;
  }

  function elementName(element) {
    if (!isElement(element)) return 'なし';
    const tag = element.localName || element.tagName?.toLowerCase() || 'element';
    const id = element.id ? `#${element.id}` : '';
    const classes = Array.from(element.classList || []).slice(0, 2);
    const classText = classes.length ? `.${classes.join('.')}` : '';
    return `<${tag}${id}${classText}>`;
  }

  function elementIdentity(element) {
    if (!isElement(element)) return '—';
    const parts = [];
    if (element.id) parts.push(`#${element.id}`);
    const classes = Array.from(element.classList || []).slice(0, 4);
    if (classes.length) parts.push(`.${classes.join('.')}`);
    const testId = element.getAttribute?.('data-testid');
    if (testId) parts.push(`[data-testid="${testId}"]`);
    return parts.join(' ') || '属性なし';
  }

  function normalizedText(element) {
    return String(element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function selectedRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function setStatus(message, kind = 'normal') {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
  }

  function setMode(mode) {
    state.mode = mode;
    if (!ui.modeBadge) return;

    const labels = {
      idle: 'IDLE',
      picking: 'SELECTING',
      fixed: 'FIXED',
      countdown: `DELAY ${state.countdownRemaining}`
    };
    ui.modeBadge.textContent = labels[mode] || mode.toUpperCase();
    ui.modeBadge.dataset.mode = mode;
  }

  function updateControls() {
    const selected = isElement(state.selectedElement) && state.selectedElement.isConnected;
    const hasResult = Boolean(state.result);
    ui.parentButton.disabled = !selected || !state.selectedElement.parentElement;
    ui.childButton.disabled = !selected || !state.selectedElement.firstElementChild;
    ui.copyButton.disabled = !hasResult;
    ui.downloadButton.disabled = !hasResult;
    ui.selectButton.textContent = state.mode === 'picking' ? '選択中…' : '要素を選択';
    ui.delayButton.textContent = state.mode === 'countdown'
      ? `キャンセル (${state.countdownRemaining})`
      : '秒後に固定';
  }

  function updateTargetView() {
    const element = state.selectedElement;
    if (!isElement(element) || !element.isConnected || !state.result) {
      ui.tag.textContent = '未固定';
      ui.identity.textContent = '—';
      ui.rect.textContent = '—';
      ui.text.textContent = '対象をホバーしてクリックしてください。';
      ui.preview.textContent = '固定した要素のJSONがここに表示されます。';
      updateControls();
      return;
    }

    const rect = selectedRect(element);
    ui.tag.textContent = elementName(element);
    ui.identity.textContent = elementIdentity(element);
    ui.rect.textContent = `${rect.width} × ${rect.height}  (${rect.left}, ${rect.top})`;
    ui.text.textContent = normalizedText(element).slice(0, 240) || 'テキストなし';
    ui.preview.textContent = JSON.stringify(state.result, null, 2);
    updateControls();
  }

  function clearCountdownTimer() {
    if (state.countdownTimer !== null) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
    state.countdownDeadline = 0;
    state.countdownRemaining = 0;
  }

  function setHighlightTarget(element) {
    state.highlightedElement = isElement(element) && element.isConnected ? element : null;
    if (!state.highlightedElement && ui.marker) ui.marker.style.display = 'none';
  }

  function startPicking(message = '対象をホバーし、クリックして固定してください。') {
    clearCountdownTimer();
    state.hoveredElement = null;
    state.selectedElement = null;
    state.result = null;
    setHighlightTarget(null);
    setMode('picking');
    setStatus(message);
    updateTargetView();
  }

  function inspectAndFix(element, reason = 'クリック') {
    if (!isElement(element) || !element.isConnected) {
      startPicking('対象要素がページから削除されています。');
      return;
    }
    if (!globalThis.ElementInspector?.inspectElement) {
      setStatus('要素解析モジュールを利用できません。', 'error');
      return;
    }

    clearCountdownTimer();
    state.selectedElement = element;
    state.hoveredElement = element;
    state.result = globalThis.ElementInspector.inspectElement(element);
    setHighlightTarget(element);
    setMode('fixed');
    setStatus(`${reason}で ${elementName(element)} を固定しました。`, 'success');
    updateTargetView();
  }

  function moveToParent() {
    const parent = state.selectedElement?.parentElement;
    if (!parent) {
      setStatus('これ以上親の要素へ移動できません。', 'error');
      return;
    }
    inspectAndFix(parent, '親へ移動');
  }

  function moveToChild() {
    const child = state.selectedElement?.firstElementChild;
    if (!child) {
      setStatus('子要素がありません。', 'error');
      return;
    }
    inspectAndFix(child, '子へ移動');
  }

  function countdownTick() {
    if (state.mode !== 'countdown') return;
    const remainingMs = state.countdownDeadline - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    if (remaining !== state.countdownRemaining) {
      state.countdownRemaining = remaining;
      setMode('countdown');
      updateControls();
    }

    if (remainingMs > 0) return;

    let target = state.hoveredElement;
    const active = document.activeElement;
    if ((!isElement(target) || !target.isConnected) && isElement(active) && !active.hasAttribute?.(ROOT_ATTRIBUTE)) {
      target = active;
    }

    clearCountdownTimer();
    if (isElement(target) && target.isConnected) {
      inspectAndFix(target, '遅延固定');
      return;
    }
    startPicking('カウント終了時に対象要素がありませんでした。もう一度選択してください。');
  }

  function toggleDelayedFix() {
    if (state.mode === 'countdown') {
      startPicking('遅延固定をキャンセルしました。');
      return;
    }

    const seconds = Math.min(60, Math.max(1, Number.parseInt(ui.delayInput.value, 10) || DEFAULT_DELAY_SECONDS));
    ui.delayInput.value = String(seconds);
    state.selectedElement = null;
    state.result = null;
    state.countdownDeadline = Date.now() + seconds * 1000;
    state.countdownRemaining = seconds;
    setMode('countdown');
    setStatus('カウント中はページを通常操作できます。0秒時点でホバーまたはフォーカス中の要素を固定します。');
    updateTargetView();
    state.countdownTimer = setInterval(countdownTick, 100);
    countdownTick();
  }

  function copyWithTextarea(text) {
    const parent = document.body || document.documentElement;
    if (!parent) return false;

    const previousFocus = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.setAttribute(ROOT_ATTRIBUTE, 'clipboard');
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
        return;
      }
    } catch (error) {
      clipboardError = error;
    }

    if (copyWithTextarea(text)) return;

    const detail = clipboardError instanceof Error ? clipboardError.message : '';
    throw new Error(detail
      ? `クリップボードへのコピーに失敗しました: ${detail}`
      : 'クリップボードへのコピーに失敗しました');
  }

  async function copySelectedJson() {
    if (!state.result) return;
    try {
      await copyText(JSON.stringify(state.result, null, 2));
      setStatus('JSONをクリップボードへコピーしました。', 'success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function downloadSelectedJson() {
    if (!state.result) return;
    const tag = state.result.selectedTag || 'element';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `element-inspector-${tag}-${stamp}.json`;
    const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.setAttribute(ROOT_ATTRIBUTE, 'download');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`${filename} を保存しました。`, 'success');
  }

  function onDocumentPointerMove(event) {
    if (!state.open || (state.mode !== 'picking' && state.mode !== 'countdown')) return;
    if (isInspectorEvent(event)) return;
    const element = resolveEventElement(event);
    if (!isElement(element)) return;
    state.hoveredElement = element;
    setHighlightTarget(element);
    if (state.mode === 'picking') {
      setStatus(`${elementName(element)} をクリックすると固定します。`);
    }
  }

  function onDocumentFocusIn(event) {
    if (!state.open || (state.mode !== 'picking' && state.mode !== 'countdown')) return;
    if (isInspectorEvent(event)) return;
    const element = resolveEventElement(event);
    if (!isElement(element)) return;
    state.hoveredElement = element;
    setHighlightTarget(element);
  }

  function onDocumentClick(event) {
    if (!state.open || state.mode !== 'picking' || isInspectorEvent(event)) return;
    const element = resolveEventElement(event);
    if (!isElement(element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    inspectAndFix(element, 'クリック');
  }

  function onDocumentKeyDown(event) {
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      destroyInspector();
      return;
    }
    if (isInspectorEvent(event)) return;
  }

  function updateHighlightPosition() {
    if (!state.open) return;
    const element = state.highlightedElement;
    if (!isElement(element) || !element.isConnected) {
      ui.marker.style.display = 'none';
      if (state.mode === 'fixed' && state.selectedElement && !state.selectedElement.isConnected) {
        startPicking('固定した要素がページから削除されました。');
      }
    } else {
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      ui.marker.style.display = visible ? 'block' : 'none';
      if (visible) {
        ui.marker.style.left = `${rect.left - 4}px`;
        ui.marker.style.top = `${rect.top - 4}px`;
        ui.marker.style.width = `${rect.width + 8}px`;
        ui.marker.style.height = `${rect.height + 8}px`;
      }
    }
    state.animationFrameId = requestAnimationFrame(updateHighlightPosition);
  }

  function clampPanelPosition(left, top) {
    const rect = ui.panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8);
    return {
      left: Math.min(maxLeft, Math.max(8, left)),
      top: Math.min(maxTop, Math.max(8, top))
    };
  }

  function beginPanelDrag(event) {
    if (event.button !== 0 || event.target.closest?.('button')) return;
    const rect = ui.panel.getBoundingClientRect();
    state.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    ui.panel.style.right = 'auto';
    ui.panel.style.left = `${rect.left}px`;
    ui.panel.style.top = `${rect.top}px`;
    ui.header.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePanel(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    const position = clampPanelPosition(
      event.clientX - state.drag.offsetX,
      event.clientY - state.drag.offsetY
    );
    ui.panel.style.left = `${position.left}px`;
    ui.panel.style.top = `${position.top}px`;
  }

  function endPanelDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    try {
      ui.header.releasePointerCapture(event.pointerId);
    } catch {}
    state.drag = null;
  }

  function keepPanelInViewport() {
    if (!ui.panel || ui.panel.style.left === '') return;
    const rect = ui.panel.getBoundingClientRect();
    const position = clampPanelPosition(rect.left, rect.top);
    ui.panel.style.left = `${position.left}px`;
    ui.panel.style.top = `${position.top}px`;
  }

  function createButton(label, handler, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener('click', handler);
    return button;
  }

  function createInfoCell(label) {
    const cell = document.createElement('div');
    cell.className = 'info-cell';
    const labelNode = document.createElement('span');
    labelNode.className = 'info-label';
    labelNode.textContent = label;
    const valueNode = document.createElement('code');
    valueNode.className = 'info-value';
    cell.append(labelNode, valueNode);
    return { cell, valueNode };
  }

  function createInspector() {
    if (state.open) return;
    state.open = true;

    ui.host = document.createElement('div');
    ui.host.setAttribute(ROOT_ATTRIBUTE, 'host');
    Object.assign(ui.host.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none'
    });
    ui.shadow = ui.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      @keyframes ei-rainbow-flow-x {
        to { background-position: -300% 0; }
      }
      @keyframes ei-rainbow-flow-y {
        to { background-position: 0 -300%; }
      }
      * { box-sizing: border-box; }
      .highlight {
        position: fixed;
        display: none;
        z-index: 1;
        pointer-events: none;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 0 0 1px rgba(0,0,0,.82), 0 0 9px rgba(255,255,255,.42);
      }
      .highlight-edge {
        position: absolute;
        display: block;
        pointer-events: none;
      }
      .highlight-edge.top,
      .highlight-edge.bottom {
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, #ff375f, #ff9f0a, #ffd60a, #30d158, #64d2ff, #0a84ff, #bf5af2, #ff375f);
        background-size: 300% 100%;
        animation: ei-rainbow-flow-x 1.5s linear infinite;
      }
      .highlight-edge.top { top: 0; }
      .highlight-edge.bottom { bottom: 0; animation-direction: reverse; }
      .highlight-edge.left,
      .highlight-edge.right {
        top: 3px;
        bottom: 3px;
        width: 3px;
        background: linear-gradient(180deg, #ff375f, #ff9f0a, #ffd60a, #30d158, #64d2ff, #0a84ff, #bf5af2, #ff375f);
        background-size: 100% 300%;
        animation: ei-rainbow-flow-y 1.5s linear infinite;
      }
      .highlight-edge.left { left: 0; animation-direction: reverse; }
      .highlight-edge.right { right: 0; }
      .panel {
        position: fixed;
        top: 14px;
        right: 14px;
        z-index: 2;
        width: 404px;
        max-width: calc(100vw - 28px);
        max-height: calc(100vh - 28px);
        overflow: hidden;
        pointer-events: auto;
        border: 1px solid #3a414a;
        border-radius: 15px;
        background:
          radial-gradient(circle at 15% 0%, rgba(122,162,247,.08), transparent 36%),
          linear-gradient(145deg, rgba(255,255,255,.024), transparent 38%),
          #1e2126;
        color: #e7e9ec;
        box-shadow: 0 24px 74px rgba(0,0,0,.54), 0 0 0 1px rgba(255,255,255,.025) inset;
        font: 12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .panel::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        opacity: .16;
        background-image: repeating-linear-gradient(115deg, rgba(255,255,255,.025) 0 1px, transparent 1px 4px);
        mix-blend-mode: soft-light;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 50px;
        padding: 10px 11px 10px 15px;
        border-bottom: 1px solid #3a414a;
        background: linear-gradient(180deg, #272c33, #23272d);
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .header:active { cursor: grabbing; }
      .title-wrap { min-width: 0; }
      .title-line { display: flex; align-items: center; gap: 8px; }
      .app-mark {
        width: 21px;
        height: 21px;
        border: 1px solid #596471;
        border-radius: 6px;
        background: conic-gradient(from 45deg, #536d9c, #2f3a49, #7a8797, #536d9c);
        box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset;
      }
      .title { color: #f4f5f7; font-size: 13px; font-weight: 680; letter-spacing: .01em; }
      .subtitle { display: block; margin-top: 2px; color: #89929e; font-size: 10px; }
      button, input { font: inherit; }
      button {
        min-height: 31px;
        border: 1px solid #48515d;
        border-radius: 8px;
        padding: 5px 10px;
        background: linear-gradient(180deg, #30363e, #292e35);
        color: #e7e9ec;
        box-shadow: 0 1px 0 rgba(255,255,255,.045) inset;
        cursor: pointer;
      }
      button:hover:not(:disabled) { background: #343b44; border-color: #5d6875; }
      button:active:not(:disabled) { transform: translateY(1px); }
      button:focus-visible, input:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 1px; }
      button:disabled { opacity: .4; cursor: default; }
      button.primary { background: linear-gradient(180deg, #3a4d70, #30415f); border-color: #5a75a7; }
      button.close { min-width: 31px; padding: 3px 8px; font-size: 18px; line-height: 1; }
      .body { max-height: calc(100vh - 78px); overflow: auto; padding: 12px; }
      .status-card {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        margin-bottom: 10px;
        border: 1px solid #343b44;
        border-radius: 11px;
        padding: 9px;
        background: rgba(36,40,46,.84);
      }
      .badge {
        flex: 0 0 auto;
        border: 1px solid #4b5663;
        border-radius: 999px;
        padding: 2px 7px;
        background: #252a31;
        color: #aeb6c0;
        font-size: 9px;
        letter-spacing: .07em;
      }
      .badge[data-mode="picking"] { border-color: #536d9c; color: #a9c2ff; }
      .badge[data-mode="fixed"] { border-color: #48745e; color: #9dd8b6; }
      .badge[data-mode="countdown"] { border-color: #8b7041; color: #ffd38b; }
      .status { min-height: 28px; color: #a9b0ba; }
      .status[data-kind="success"] { color: #9dd8b6; }
      .status[data-kind="error"] { color: #ffaaa1; }
      .section {
        margin-top: 9px;
        border: 1px solid #343b44;
        border-radius: 11px;
        padding: 10px;
        background: rgba(31,35,41,.86);
      }
      .section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
      .section-title { margin: 0; color: #89929e; font-size: 10px; font-weight: 680; letter-spacing: .075em; text-transform: uppercase; }
      .section-hint { color: #697480; font-size: 9px; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .info-cell { min-width: 0; border: 1px solid #303740; border-radius: 9px; padding: 7px 8px; background: #24282e; }
      .info-cell.wide { grid-column: 1 / -1; }
      .info-label { display: block; margin-bottom: 2px; color: #7f8995; font-size: 9px; text-transform: uppercase; }
      .info-value { display: block; overflow: hidden; color: #dfe2e6; text-overflow: ellipsis; white-space: nowrap; font: 11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .target-text { min-height: 34px; max-height: 62px; overflow: auto; white-space: normal; }
      .controls { display: flex; flex-wrap: wrap; gap: 6px; }
      .delay-row { display: grid; grid-template-columns: 72px 1fr; gap: 6px; }
      .delay-row input {
        width: 100%;
        min-height: 31px;
        border: 1px solid #48515d;
        border-radius: 8px;
        padding: 5px 8px;
        background: #171a1f;
        color: #e7e9ec;
      }
      .json {
        width: 100%;
        max-height: 220px;
        margin: 0;
        overflow: auto;
        border: 1px solid #303740;
        border-radius: 9px;
        padding: 9px;
        background: #171a1f;
        color: #cfd4da;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;
      }
      .footnote { margin-top: 9px; color: #6f7884; font-size: 10px; text-align: center; }
    `;

    ui.marker = document.createElement('div');
    ui.marker.className = 'highlight';
    ui.marker.setAttribute('aria-hidden', 'true');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const edge = document.createElement('span');
      edge.className = `highlight-edge ${side}`;
      ui.marker.appendChild(edge);
    }

    ui.panel = document.createElement('section');
    ui.panel.className = 'panel';
    ui.panel.setAttribute('role', 'dialog');
    ui.panel.setAttribute('aria-label', 'Element Inspector');

    ui.header = document.createElement('header');
    ui.header.className = 'header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'title-wrap';
    const titleLine = document.createElement('div');
    titleLine.className = 'title-line';
    const appMark = document.createElement('span');
    appMark.className = 'app-mark';
    const title = document.createElement('strong');
    title.className = 'title';
    title.textContent = 'Element Inspector';
    titleLine.append(appMark, title);
    const subtitle = document.createElement('span');
    subtitle.className = 'subtitle';
    subtitle.textContent = `v${EXTENSION_VERSION} · ヘッダをドラッグして移動`;
    titleWrap.append(titleLine, subtitle);
    const closeButton = createButton('×', destroyInspector, 'close');
    closeButton.setAttribute('aria-label', '閉じる');
    ui.header.append(titleWrap, closeButton);

    const body = document.createElement('div');
    body.className = 'body';

    const statusCard = document.createElement('div');
    statusCard.className = 'status-card';
    ui.modeBadge = document.createElement('span');
    ui.modeBadge.className = 'badge';
    ui.status = document.createElement('div');
    ui.status.className = 'status';
    statusCard.append(ui.modeBadge, ui.status);

    const targetSection = document.createElement('section');
    targetSection.className = 'section';
    const targetHead = document.createElement('div');
    targetHead.className = 'section-head';
    const targetTitle = document.createElement('h2');
    targetTitle.className = 'section-title';
    targetTitle.textContent = 'Target Snapshot';
    const targetHint = document.createElement('span');
    targetHint.className = 'section-hint';
    targetHint.textContent = 'live selection';
    targetHead.append(targetTitle, targetHint);
    const infoGrid = document.createElement('div');
    infoGrid.className = 'info-grid';
    const tagCell = createInfoCell('Element');
    ui.tag = tagCell.valueNode;
    const identityCell = createInfoCell('Identity');
    ui.identity = identityCell.valueNode;
    const rectCell = createInfoCell('Rect');
    ui.rect = rectCell.valueNode;
    const textCell = createInfoCell('Text');
    textCell.cell.classList.add('wide');
    ui.text = textCell.valueNode;
    ui.text.classList.add('target-text');
    infoGrid.append(tagCell.cell, identityCell.cell, rectCell.cell, textCell.cell);
    targetSection.append(targetHead, infoGrid);

    const selectionSection = document.createElement('section');
    selectionSection.className = 'section';
    const selectionHead = document.createElement('div');
    selectionHead.className = 'section-head';
    const selectionTitle = document.createElement('h2');
    selectionTitle.className = 'section-title';
    selectionTitle.textContent = 'Selection';
    const selectionHint = document.createElement('span');
    selectionHint.className = 'section-hint';
    selectionHint.textContent = 'hierarchy navigation';
    selectionHead.append(selectionTitle, selectionHint);
    const selectionControls = document.createElement('div');
    selectionControls.className = 'controls';
    ui.selectButton = createButton('要素を選択', () => startPicking(), 'primary');
    ui.parentButton = createButton('親へ', moveToParent);
    ui.childButton = createButton('子へ', moveToChild);
    selectionControls.append(ui.selectButton, ui.parentButton, ui.childButton);
    selectionSection.append(selectionHead, selectionControls);

    const delaySection = document.createElement('section');
    delaySection.className = 'section';
    const delayHead = document.createElement('div');
    delayHead.className = 'section-head';
    const delayTitle = document.createElement('h2');
    delayTitle.className = 'section-title';
    delayTitle.textContent = 'Delayed Fix';
    const delayHint = document.createElement('span');
    delayHint.className = 'section-hint';
    delayHint.textContent = '1–60 sec';
    delayHead.append(delayTitle, delayHint);
    const delayRow = document.createElement('div');
    delayRow.className = 'delay-row';
    ui.delayInput = document.createElement('input');
    ui.delayInput.type = 'number';
    ui.delayInput.min = '1';
    ui.delayInput.max = '60';
    ui.delayInput.value = String(DEFAULT_DELAY_SECONDS);
    ui.delayInput.setAttribute('aria-label', '固定までの秒数');
    ui.delayButton = createButton('秒後に固定', toggleDelayedFix);
    delayRow.append(ui.delayInput, ui.delayButton);
    delaySection.append(delayHead, delayRow);

    const exportSection = document.createElement('section');
    exportSection.className = 'section';
    const exportHead = document.createElement('div');
    exportHead.className = 'section-head';
    const exportTitle = document.createElement('h2');
    exportTitle.className = 'section-title';
    exportTitle.textContent = 'Export';
    const exportHint = document.createElement('span');
    exportHint.className = 'section-hint';
    exportHint.textContent = 'local only';
    exportHead.append(exportTitle, exportHint);
    const exportControls = document.createElement('div');
    exportControls.className = 'controls';
    ui.copyButton = createButton('JSONをコピー', copySelectedJson, 'primary');
    ui.downloadButton = createButton('JSONを保存', downloadSelectedJson);
    exportControls.append(ui.copyButton, ui.downloadButton);
    exportSection.append(exportHead, exportControls);

    const jsonSection = document.createElement('section');
    jsonSection.className = 'section';
    const jsonHead = document.createElement('div');
    jsonHead.className = 'section-head';
    const jsonTitle = document.createElement('h2');
    jsonTitle.className = 'section-title';
    jsonTitle.textContent = 'JSON Preview';
    const jsonHint = document.createElement('span');
    jsonHint.className = 'section-hint';
    jsonHint.textContent = 'formatted';
    jsonHead.append(jsonTitle, jsonHint);
    ui.preview = document.createElement('pre');
    ui.preview.className = 'json';
    jsonSection.append(jsonHead, ui.preview);

    const footnote = document.createElement('div');
    footnote.className = 'footnote';
    footnote.textContent = '通常選択はクリックを抑止 · 遅延固定中はページ操作を許可 · Escで終了';

    body.append(statusCard, targetSection, selectionSection, delaySection, exportSection, jsonSection, footnote);
    ui.panel.append(ui.header, body);
    ui.shadow.append(style, ui.marker, ui.panel);
    document.documentElement.appendChild(ui.host);

    ui.header.addEventListener('pointerdown', beginPanelDrag);
    ui.header.addEventListener('pointermove', movePanel);
    ui.header.addEventListener('pointerup', endPanelDrag);
    ui.header.addEventListener('pointercancel', endPanelDrag);
    ui.panel.addEventListener('pointerdown', event => event.stopPropagation());
    ui.panel.addEventListener('click', event => event.stopPropagation());
    ui.panel.addEventListener('wheel', event => event.stopPropagation());

    document.addEventListener('pointermove', onDocumentPointerMove, true);
    document.addEventListener('focusin', onDocumentFocusIn, true);
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('resize', keepPanelInViewport);

    state.animationFrameId = requestAnimationFrame(updateHighlightPosition);
    startPicking();
  }

  function destroyInspector() {
    if (!state.open) return;
    clearCountdownTimer();
    if (state.animationFrameId !== null) {
      cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
    }
    document.removeEventListener('pointermove', onDocumentPointerMove, true);
    document.removeEventListener('focusin', onDocumentFocusIn, true);
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('resize', keepPanelInViewport);
    ui.host?.remove();

    state.open = false;
    state.mode = 'idle';
    state.hoveredElement = null;
    state.selectedElement = null;
    state.highlightedElement = null;
    state.result = null;
    state.drag = null;
    for (const key of Object.keys(ui)) ui[key] = null;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== TOGGLE_MESSAGE_TYPE) return undefined;
    try {
      if (state.open) destroyInspector();
      else createInspector();
      sendResponse({ ok: true, open: state.open });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      console.error('[Element Inspector]', error);
      if (state.open) destroyInspector();
      sendResponse({ ok: false, error: messageText });
    }
    return false;
  });
})();
