(() => {
  'use strict';

  const EXTENSION_VERSION = '0.8.0';
  const ROOT_ATTRIBUTE = 'data-element-inspector-ui';
  const FRAME_CHANNEL = '__element_inspector_frame_context_v1__';
  const DEFAULT_DELAY_SECONDS = 5;

  const MESSAGE = Object.freeze({
    SET_ACTIVE: 'ELEMENT_INSPECTOR_SET_ACTIVE',
    QUERY_STATE: 'ELEMENT_INSPECTOR_QUERY_STATE',
    FRAME_READY: 'ELEMENT_INSPECTOR_FRAME_READY',
    FRAME_EVENT: 'ELEMENT_INSPECTOR_FRAME_EVENT',
    FRAME_COMMAND: 'ELEMENT_INSPECTOR_FRAME_COMMAND',
    TOP_EVENT: 'ELEMENT_INSPECTOR_TOP_EVENT',
    TOP_COMMAND: 'ELEMENT_INSPECTOR_TOP_COMMAND'
  });

  const frameState = {
    active: false,
    frameId: 0,
    isTopFrame: window.top === window,
    mode: 'idle',
    hoveredElement: null,
    selectedElement: null,
    highlightedElement: null,
    animationFrameId: null,
    host: null,
    shadow: null,
    marker: null,
    frameToken: createToken(),
    childFrameRequests: new Map(),
    frameContext: {
      depth: 0,
      path: []
    }
  };

  const ui = {
    panel: null,
    header: null,
    modeBadge: null,
    targetName: null,
    frameBadge: null,
    status: null,
    pickButton: null,
    delayInput: null,
    delayButton: null,
    tabButtons: [],
    tabPanels: [],
    parentButton: null,
    previousButton: null,
    nextButton: null,
    firstChildButton: null,
    lastChildButton: null,
    childSelect: null,
    siblingMetric: null,
    childMetric: null,
    tagValue: null,
    identityValue: null,
    rectValue: null,
    textValue: null,
    cssValue: null,
    cssBadge: null,
    xpathValue: null,
    xpathBadge: null,
    jsPathValue: null,
    jsPathBadge: null,
    jsonPreview: null,
    result: null,
    selectedFrameId: null,
    countdownTimer: null,
    countdownDeadline: 0,
    countdownRemaining: 0,
    drag: null,
    activeTab: 'overview'
  };

  function createToken() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function isElement(value) {
    return value instanceof Element;
  }

  function elementName(element) {
    if (!isElement(element)) return '要素なし';
    const summary = globalThis.ElementInspector?.summarizeElement?.(element);
    return summary?.label || `<${element.localName || element.tagName?.toLowerCase() || 'element'}>`;
  }

  function identityFromAttributes(attributes = {}) {
    const parts = [];
    if (attributes.id) parts.push(`#${attributes.id}`);
    if (attributes.class) {
      const classText = String(attributes.class).trim().split(/\s+/).slice(0, 4).join('.');
      if (classText) parts.push(`.${classText}`);
    }
    if (attributes['data-testid']) parts.push(`[data-testid="${attributes['data-testid']}"]`);
    if (attributes['aria-label']) parts.push(`[aria-label="${attributes['aria-label']}"]`);
    return parts.join(' ') || '識別属性なし';
  }

  function isInspectorEvent(event) {
    if (!frameState.host) return false;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.includes(frameState.host) || path.some(item =>
      isElement(item) && item.hasAttribute?.(ROOT_ATTRIBUTE)
    );
  }

  function resolveEventElement(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const pathElement = path.find(item =>
      isElement(item) && item !== frameState.host && !item.hasAttribute?.(ROOT_ATTRIBUTE)
    );
    if (pathElement) return pathElement;
    return isElement(event.target) ? event.target : event.target?.parentElement || null;
  }

  function emitFrameEvent(event) {
    chrome.runtime.sendMessage({ type: MESSAGE.FRAME_EVENT, event }, () => {
      void chrome.runtime.lastError;
    });
  }

  function sendTopCommand(command, payload = {}) {
    chrome.runtime.sendMessage({ type: MESSAGE.TOP_COMMAND, command, ...payload }, () => {
      void chrome.runtime.lastError;
    });
  }

  function findFrameElement(sourceWindow) {
    for (const frameElement of document.querySelectorAll('iframe, frame')) {
      try {
        if (frameElement.contentWindow === sourceWindow) return frameElement;
      } catch {}
    }
    return null;
  }

  function buildFramePathItem(frameElement) {
    const css = globalThis.ElementInspector?.generateCssLocator?.(frameElement);
    return {
      tagName: frameElement.localName || 'iframe',
      css: css?.value || null,
      name: frameElement.getAttribute('name') || null,
      title: frameElement.getAttribute('title') || null,
      src: frameElement.getAttribute('src') || null
    };
  }

  function respondWithFrameContext(sourceWindow, token) {
    const frameElement = findFrameElement(sourceWindow);
    if (!frameElement) return;
    const context = {
      depth: frameState.frameContext.depth + 1,
      path: [
        ...frameState.frameContext.path,
        buildFramePathItem(frameElement)
      ]
    };
    sourceWindow.postMessage({
      channel: FRAME_CHANNEL,
      type: 'CONTEXT',
      token,
      context
    }, '*');
  }

  function refreshChildFrameContexts() {
    for (const [sourceWindow, token] of frameState.childFrameRequests) {
      respondWithFrameContext(sourceWindow, token);
    }
  }

  function onFrameContextMessage(event) {
    const data = event.data;
    if (!data || data.channel !== FRAME_CHANNEL) return;

    if (data.type === 'HELLO' && data.token && event.source) {
      frameState.childFrameRequests.set(event.source, data.token);
      respondWithFrameContext(event.source, data.token);
      return;
    }

    if (
      data.type === 'CONTEXT' &&
      event.source === window.parent &&
      data.token === frameState.frameToken &&
      data.context
    ) {
      frameState.frameContext = {
        depth: Number.isInteger(data.context.depth) ? data.context.depth : 0,
        path: Array.isArray(data.context.path) ? data.context.path : []
      };
      refreshChildFrameContexts();
    }
  }

  function requestFrameContext() {
    if (frameState.isTopFrame) return;
    window.parent.postMessage({
      channel: FRAME_CHANNEL,
      type: 'HELLO',
      token: frameState.frameToken
    }, '*');
  }

  function buildFrameInfo() {
    return {
      frameId: frameState.frameId,
      isTopFrame: frameState.isTopFrame,
      url: location.href,
      title: document.title || '',
      depth: frameState.frameContext.depth,
      path: frameState.frameContext.path
    };
  }

  function setHighlightTarget(element) {
    frameState.highlightedElement = isElement(element) && element.isConnected ? element : null;
    if (!frameState.highlightedElement && frameState.marker) {
      frameState.marker.style.display = 'none';
    }
  }

  function clearFrameSelection() {
    frameState.hoveredElement = null;
    frameState.selectedElement = null;
    setHighlightTarget(null);
  }

  function startFramePicking(mode = 'picking') {
    frameState.mode = mode;
    clearFrameSelection();
  }

  function inspectAndSelect(element, reason = 'クリック') {
    if (!isElement(element) || !element.isConnected) {
      emitFrameEvent({
        kind: 'status',
        status: 'error',
        message: '対象要素がページから削除されています。'
      });
      startFramePicking('picking');
      return;
    }
    if (!globalThis.ElementInspector?.inspectElement) {
      emitFrameEvent({
        kind: 'status',
        status: 'error',
        message: '要素解析モジュールを利用できません。'
      });
      return;
    }

    frameState.mode = 'fixed';
    frameState.hoveredElement = element;
    frameState.selectedElement = element;
    setHighlightTarget(element);

    const result = globalThis.ElementInspector.inspectElement(element);
    result.frame = buildFrameInfo();
    result.locators.context = {
      frameRelative: !frameState.isTopFrame,
      frameId: frameState.frameId,
      framePath: frameState.frameContext.path
    };
    emitFrameEvent({
      kind: 'selected',
      reason,
      result
    });
  }

  function navigateSelection(direction) {
    const selected = frameState.selectedElement;
    if (!isElement(selected) || !selected.isConnected) {
      emitFrameEvent({
        kind: 'status',
        status: 'error',
        message: '固定中の対象要素がありません。'
      });
      return;
    }

    const targetByDirection = {
      parent: selected.parentElement,
      previous: selected.previousElementSibling,
      next: selected.nextElementSibling,
      firstChild: selected.firstElementChild,
      lastChild: selected.lastElementChild
    };
    const target = targetByDirection[direction] || null;
    if (!target) {
      emitFrameEvent({
        kind: 'status',
        status: 'error',
        message: 'その方向へ移動できる要素がありません。'
      });
      return;
    }
    inspectAndSelect(target, '階層移動');
  }

  function selectChildByIndex(index) {
    const selected = frameState.selectedElement;
    const child = selected?.children?.[index];
    if (!isElement(child)) {
      emitFrameEvent({
        kind: 'status',
        status: 'error',
        message: '指定された子要素が見つかりません。'
      });
      return;
    }
    inspectAndSelect(child, '子要素選択');
  }

  function onDocumentPointerMove(event) {
    if (!frameState.active || (frameState.mode !== 'picking' && frameState.mode !== 'countdown')) return;
    if (isInspectorEvent(event)) return;
    const element = resolveEventElement(event);
    if (!isElement(element) || element === frameState.hoveredElement) return;
    frameState.hoveredElement = element;
    setHighlightTarget(element);
    emitFrameEvent({
      kind: 'hover',
      summary: globalThis.ElementInspector?.summarizeElement?.(element) || { label: elementName(element) },
      frame: buildFrameInfo()
    });
  }

  function onDocumentFocusIn(event) {
    if (!frameState.active || (frameState.mode !== 'picking' && frameState.mode !== 'countdown')) return;
    if (isInspectorEvent(event)) return;
    const element = resolveEventElement(event);
    if (!isElement(element)) return;
    frameState.hoveredElement = element;
    setHighlightTarget(element);
    emitFrameEvent({
      kind: 'hover',
      summary: globalThis.ElementInspector?.summarizeElement?.(element) || { label: elementName(element) },
      frame: buildFrameInfo()
    });
  }

  function onDocumentClick(event) {
    if (!frameState.active || frameState.mode !== 'picking' || isInspectorEvent(event)) return;
    const element = resolveEventElement(event);
    if (!isElement(element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    inspectAndSelect(element, 'クリック');
  }

  function onDocumentKeyDown(event) {
    if (!frameState.active || !frameState.isTopFrame) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    sendTopCommand('DEACTIVATE');
  }

  function updateHighlightPosition() {
    if (!frameState.active || !frameState.marker) return;
    const element = frameState.highlightedElement;
    if (!isElement(element) || !element.isConnected) {
      frameState.marker.style.display = 'none';
      if (frameState.mode === 'fixed' && frameState.selectedElement && !frameState.selectedElement.isConnected) {
        startFramePicking('picking');
        emitFrameEvent({
          kind: 'status',
          status: 'error',
          message: '固定した要素がページから削除されました。'
        });
      }
    } else {
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      frameState.marker.style.display = visible ? 'block' : 'none';
      if (visible) {
        frameState.marker.style.left = `${rect.left - 4}px`;
        frameState.marker.style.top = `${rect.top - 4}px`;
        frameState.marker.style.width = `${rect.width + 8}px`;
        frameState.marker.style.height = `${rect.height + 8}px`;
      }
    }
    frameState.animationFrameId = requestAnimationFrame(updateHighlightPosition);
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

  function setUIStatus(message, kind = 'normal') {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
  }

  function clearUICountdown() {
    if (ui.countdownTimer !== null) {
      clearInterval(ui.countdownTimer);
      ui.countdownTimer = null;
    }
    ui.countdownDeadline = 0;
    ui.countdownRemaining = 0;
  }

  function setUIMode(mode) {
    if (!ui.modeBadge) return;
    const labels = {
      picking: 'SELECTING',
      fixed: 'FIXED',
      countdown: `DELAY ${ui.countdownRemaining}`,
      idle: 'IDLE'
    };
    ui.modeBadge.dataset.mode = mode;
    ui.modeBadge.textContent = labels[mode] || mode.toUpperCase();
    if (ui.pickButton) ui.pickButton.dataset.active = mode === 'picking' ? 'true' : 'false';
    if (ui.delayButton) {
      ui.delayButton.textContent = mode === 'countdown'
        ? `キャンセル ${ui.countdownRemaining}`
        : '秒後に固定';
    }
  }

  function frameBadgeText(frame) {
    if (!frame || frame.isTopFrame) return 'TOP FRAME';
    return `FRAME ${frame.frameId} · DEPTH ${frame.depth}`;
  }

  function locatorBadge(locator) {
    if (!locator?.value) return 'UNAVAILABLE';
    if (locator.unique) return 'UNIQUE';
    if (Number.isInteger(locator.matchCount)) return `${locator.matchCount} MATCHES`;
    return locator.scope?.toUpperCase() || 'READY';
  }

  function setLocatorView(valueNode, badgeNode, locator) {
    valueNode.textContent = locator?.value || '生成できません';
    badgeNode.textContent = locatorBadge(locator);
    badgeNode.dataset.unique = locator?.unique ? 'true' : 'false';
  }

  function renderUI() {
    if (!ui.panel) return;
    const result = ui.result;
    const hasResult = Boolean(result);

    ui.parentButton.disabled = !result?.navigation?.hasParent;
    ui.previousButton.disabled = !result?.navigation?.hasPreviousSibling;
    ui.nextButton.disabled = !result?.navigation?.hasNextSibling;
    ui.firstChildButton.disabled = !result?.navigation?.childCount;
    ui.lastChildButton.disabled = !result?.navigation?.childCount;

    ui.childSelect.disabled = !result?.navigation?.childCount;
    ui.childSelect.replaceChildren(new Option('子要素を選択…', ''));
    for (const child of result?.navigation?.children || []) {
      ui.childSelect.appendChild(new Option(`${child.index + 1}. ${child.label}`, String(child.index)));
    }

    ui.siblingMetric.textContent = hasResult
      ? `${result.navigation.siblingIndex + 1} / ${result.navigation.siblingCount}`
      : '—';
    ui.childMetric.textContent = hasResult
      ? `${result.navigation.childCount}${result.navigation.childrenTruncated ? '+' : ''}`
      : '—';

    if (!hasResult) {
      ui.tagValue.textContent = '未固定';
      ui.identityValue.textContent = '—';
      ui.rectValue.textContent = '—';
      ui.textValue.textContent = 'ページ上の要素へポインターを移動してください。';
      ui.frameBadge.textContent = 'TOP FRAME';
      setLocatorView(ui.cssValue, ui.cssBadge, null);
      setLocatorView(ui.xpathValue, ui.xpathBadge, null);
      setLocatorView(ui.jsPathValue, ui.jsPathBadge, null);
      ui.jsonPreview.textContent = '固定した要素のJSONがここに表示されます。';
      return;
    }

    const rect = result.selectedRect;
    ui.targetName.textContent = `<${result.selectedTag}>`;
    ui.frameBadge.textContent = frameBadgeText(result.frame);
    ui.tagValue.textContent = result.selectedTag || '—';
    ui.identityValue.textContent = identityFromAttributes(result.selectedAttributes);
    ui.rectValue.textContent = rect
      ? `${rect.width} × ${rect.height} · ${rect.left}, ${rect.top}`
      : '—';
    ui.textValue.textContent = result.selectedText || 'テキストなし';
    setLocatorView(ui.cssValue, ui.cssBadge, result.locators?.css);
    setLocatorView(ui.xpathValue, ui.xpathBadge, result.locators?.xpath);
    setLocatorView(ui.jsPathValue, ui.jsPathBadge, result.locators?.jsPath);
    ui.jsonPreview.textContent = JSON.stringify(result, null, 2);
  }

  function setActiveTab(tabName) {
    ui.activeTab = tabName;
    for (const button of ui.tabButtons) {
      button.dataset.active = button.dataset.tab === tabName ? 'true' : 'false';
      button.setAttribute('aria-selected', button.dataset.active);
    }
    for (const panel of ui.tabPanels) {
      panel.hidden = panel.dataset.panel !== tabName;
    }
  }

  function beginPicking() {
    clearUICountdown();
    ui.result = null;
    ui.selectedFrameId = null;
    ui.targetName.textContent = 'Select an element';
    setUIMode('picking');
    setUIStatus('対象をホバーし、クリックして固定してください。');
    renderUI();
    sendTopCommand('START_PICKING');
  }

  function countdownTick() {
    const remainingMs = ui.countdownDeadline - Date.now();
    ui.countdownRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
    setUIMode('countdown');
    if (remainingMs > 0) return;
    clearUICountdown();
    sendTopCommand('FIX_ACTIVE_HOVER');
  }

  function toggleCountdown() {
    if (ui.countdownTimer !== null) {
      beginPicking();
      setUIStatus('遅延固定をキャンセルしました。');
      return;
    }
    const seconds = Math.min(60, Math.max(1, Number.parseInt(ui.delayInput.value, 10) || DEFAULT_DELAY_SECONDS));
    ui.delayInput.value = String(seconds);
    ui.result = null;
    ui.selectedFrameId = null;
    ui.countdownRemaining = seconds;
    ui.countdownDeadline = Date.now() + seconds * 1000;
    setUIMode('countdown');
    setUIStatus('ページを通常操作できます。0秒時点の要素を固定します。');
    renderUI();
    sendTopCommand('START_COUNTDOWN');
    ui.countdownTimer = setInterval(countdownTick, 100);
    countdownTick();
  }

  async function copyLocator(kind) {
    const locator = ui.result?.locators?.[kind];
    if (!locator?.value) {
      setUIStatus('コピーできるLocatorがありません。', 'error');
      return;
    }
    try {
      await copyText(locator.value);
      setUIStatus(`${kind === 'jsPath' ? 'JS Path' : kind.toUpperCase()}をコピーしました。`, 'success');
    } catch (error) {
      setUIStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function copyJson() {
    if (!ui.result) return;
    try {
      await copyText(JSON.stringify(ui.result, null, 2));
      setUIStatus('JSONをクリップボードへコピーしました。', 'success');
    } catch (error) {
      setUIStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function downloadJson() {
    if (!ui.result) return;
    const tag = ui.result.selectedTag || 'element';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `element-inspector-${tag}-${stamp}.json`;
    const blob = new Blob([JSON.stringify(ui.result, null, 2)], { type: 'application/json' });
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
    setUIStatus(`${filename}を保存しました。`, 'success');
  }

  function handleTopEvent(event) {
    if (!ui.panel || !event) return;

    if (event.kind === 'hover') {
      ui.targetName.textContent = event.summary?.label || 'Hovered element';
      ui.frameBadge.textContent = frameBadgeText({ ...event.frame, frameId: event.frameId });
      setUIStatus(ui.countdownTimer !== null
        ? 'カウント終了時にこの要素を固定します。'
        : 'クリックするとこの要素を固定します。');
      return;
    }

    if (event.kind === 'selected' && event.result) {
      clearUICountdown();
      ui.result = event.result;
      ui.selectedFrameId = event.frameId;
      setUIMode('fixed');
      setUIStatus(`${event.reason || '選択'}で対象を固定しました。`, 'success');
      renderUI();
      return;
    }

    if (event.kind === 'status') {
      setUIStatus(event.message || '状態を更新しました。', event.status || 'normal');
    }
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
    if (event.button !== 0 || event.target.closest?.('button, input, select')) return;
    const rect = ui.panel.getBoundingClientRect();
    ui.drag = {
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
    if (!ui.drag || event.pointerId !== ui.drag.pointerId) return;
    const position = clampPanelPosition(
      event.clientX - ui.drag.offsetX,
      event.clientY - ui.drag.offsetY
    );
    ui.panel.style.left = `${position.left}px`;
    ui.panel.style.top = `${position.top}px`;
  }

  function endPanelDrag(event) {
    if (!ui.drag || event.pointerId !== ui.drag.pointerId) return;
    try {
      ui.header.releasePointerCapture(event.pointerId);
    } catch {}
    ui.drag = null;
  }

  function keepPanelInViewport() {
    if (!ui.panel || ui.panel.style.left === '') return;
    const rect = ui.panel.getBoundingClientRect();
    const position = clampPanelPosition(rect.left, rect.top);
    ui.panel.style.left = `${position.left}px`;
    ui.panel.style.top = `${position.top}px`;
  }

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes ei-rainbow-flow-x { to { background-position: -300% 0; } }
      @keyframes ei-rainbow-flow-y { to { background-position: 0 -300%; } }
      @keyframes ei-panel-arrive {
        from { opacity: 0; transform: scale(.985) translateY(-4px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      * { box-sizing: border-box; }
      .highlight {
        position: fixed;
        display: none;
        z-index: 1;
        pointer-events: none;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 0 0 1px rgba(0,0,0,.86), 0 0 10px rgba(255,255,255,.38);
      }
      .highlight-edge { position: absolute; display: block; pointer-events: none; }
      .highlight-edge.top, .highlight-edge.bottom {
        left: 0; right: 0; height: 3px;
        background: linear-gradient(90deg, #ff375f, #ff9f0a, #ffd60a, #30d158, #64d2ff, #0a84ff, #bf5af2, #ff375f);
        background-size: 300% 100%;
        animation: ei-rainbow-flow-x 1.5s linear infinite;
      }
      .highlight-edge.top { top: 0; }
      .highlight-edge.bottom { bottom: 0; animation-direction: reverse; }
      .highlight-edge.left, .highlight-edge.right {
        top: 3px; bottom: 3px; width: 3px;
        background: linear-gradient(180deg, #ff375f, #ff9f0a, #ffd60a, #30d158, #64d2ff, #0a84ff, #bf5af2, #ff375f);
        background-size: 100% 300%;
        animation: ei-rainbow-flow-y 1.5s linear infinite;
      }
      .highlight-edge.left { left: 0; animation-direction: reverse; }
      .highlight-edge.right { right: 0; }
      .panel {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2;
        width: 456px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        overflow: hidden;
        pointer-events: auto;
        color: #f1f3f5;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 18px;
        background:
          radial-gradient(circle at 18% 0%, rgba(120,150,205,.12), transparent 34%),
          rgba(24,27,32,.9);
        backdrop-filter: blur(26px) saturate(145%);
        -webkit-backdrop-filter: blur(26px) saturate(145%);
        box-shadow: 0 28px 80px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.08) inset;
        font: 12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        font-optical-sizing: auto;
        animation: ei-panel-arrive 180ms cubic-bezier(.2,.8,.2,1) both;
      }
      .titlebar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 60px;
        padding: 11px 12px 11px 15px;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .titlebar::after {
        content: '';
        position: absolute;
        left: 14px; right: 14px; bottom: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.12) 14%, rgba(255,255,255,.12) 86%, transparent);
      }
      .titlebar:active { cursor: grabbing; }
      .brand-mark {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 10px;
        background: linear-gradient(145deg, rgba(126,157,213,.28), rgba(61,70,84,.34));
        box-shadow: 0 1px 0 rgba(255,255,255,.12) inset, 0 8px 20px rgba(0,0,0,.22);
      }
      .brand-mark::before {
        content: '';
        width: 15px;
        height: 15px;
        border: 1.5px solid #dbe4f5;
        border-radius: 4px;
        box-shadow: 5px 5px 0 -3px #8ba7d9;
      }
      .brand-copy { min-width: 0; flex: 1; }
      .brand-title { display: block; font-size: 13px; font-weight: 680; letter-spacing: -.012em; }
      .brand-subtitle { display: block; margin-top: 2px; color: #929ba7; font-size: 10px; letter-spacing: .018em; }
      .title-actions { display: flex; align-items: center; gap: 8px; }
      .mode-pill, .frame-pill, .locator-badge {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 999px;
        padding: 3px 8px;
        background: rgba(255,255,255,.045);
        color: #aab2bd;
        font-size: 9px;
        font-weight: 650;
        letter-spacing: .075em;
        white-space: nowrap;
      }
      .mode-pill[data-mode="picking"] { color: #b9cdf4; border-color: rgba(122,162,247,.38); }
      .mode-pill[data-mode="fixed"] { color: #a8dfbf; border-color: rgba(75,180,123,.34); }
      .mode-pill[data-mode="countdown"] { color: #ffd58d; border-color: rgba(226,169,69,.38); }
      button, input, select { font: inherit; }
      button {
        min-height: 32px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 9px;
        padding: 6px 10px;
        background: rgba(255,255,255,.06);
        color: #e9ecef;
        box-shadow: 0 1px 0 rgba(255,255,255,.055) inset;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 90ms ease;
      }
      button:hover:not(:disabled) { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.19); }
      button:active:not(:disabled) { transform: scale(.97); }
      button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #8fb4f7; outline-offset: 2px; }
      button:disabled { opacity: .34; cursor: default; }
      button.primary { background: linear-gradient(180deg, rgba(91,126,187,.72), rgba(65,91,139,.72)); border-color: rgba(137,176,241,.52); }
      button.primary[data-active="true"] { box-shadow: 0 0 0 2px rgba(122,162,247,.18), 0 1px 0 rgba(255,255,255,.09) inset; }
      button.icon { width: 32px; min-width: 32px; padding: 0; font-size: 17px; line-height: 1; }
      .workspace { max-height: calc(100vh - 92px); overflow: auto; padding: 12px 14px 14px; }
      .target-card {
        border: 1px solid rgba(255,255,255,.095);
        border-radius: 14px;
        padding: 12px;
        background: rgba(255,255,255,.035);
        box-shadow: 0 1px 0 rgba(255,255,255,.035) inset;
      }
      .target-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .eyebrow { color: #7f8996; font-size: 9px; font-weight: 650; letter-spacing: .09em; text-transform: uppercase; }
      .target-name { display: block; margin-top: 4px; overflow: hidden; color: #f7f8fa; font: 600 14px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace; text-overflow: ellipsis; white-space: nowrap; }
      .status { min-height: 34px; margin-top: 9px; color: #aab1bb; }
      .status[data-kind="success"] { color: #a5dcbc; }
      .status[data-kind="error"] { color: #ffb0a8; }
      .command-row { display: grid; grid-template-columns: minmax(0,1fr) 150px; gap: 8px; margin-top: 10px; }
      .delay-control { display: grid; grid-template-columns: 48px 1fr; gap: 6px; }
      input, select {
        width: 100%;
        min-height: 32px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 9px;
        padding: 6px 8px;
        background: rgba(8,10,13,.46);
        color: #edf0f3;
      }
      .tabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 3px;
        margin-top: 12px;
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 11px;
        padding: 3px;
        background: rgba(7,9,12,.3);
      }
      .tabs button { min-height: 30px; border: 0; background: transparent; color: #8f98a4; box-shadow: none; }
      .tabs button[data-active="true"] { background: rgba(255,255,255,.085); color: #f1f3f5; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
      .tab-panel { margin-top: 10px; }
      .tab-panel[hidden] { display: none; }
      .card {
        margin-top: 8px;
        border: 1px solid rgba(255,255,255,.085);
        border-radius: 13px;
        padding: 11px;
        background: rgba(9,11,14,.26);
      }
      .card:first-child { margin-top: 0; }
      .card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      .card-title { margin: 0; color: #9aa3ae; font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
      .metrics { display: flex; gap: 6px; color: #7f8995; font-size: 9px; }
      .metrics b { color: #c8ced6; font-weight: 650; }
      .nav-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
      .nav-grid button { min-width: 0; padding-inline: 4px; font-size: 10px; }
      .child-select { margin-top: 7px; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
      .info-cell { min-width: 0; border: 1px solid rgba(255,255,255,.065); border-radius: 10px; padding: 8px; background: rgba(255,255,255,.025); }
      .info-cell.wide { grid-column: 1 / -1; }
      .info-label { display: block; color: #747e8a; font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }
      .info-value { display: block; margin-top: 3px; overflow: hidden; color: #dde1e6; text-overflow: ellipsis; white-space: nowrap; font: 11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .info-value.wrap { max-height: 68px; overflow: auto; white-space: normal; overflow-wrap: anywhere; }
      .locator-card { margin-top: 8px; }
      .locator-card:first-child { margin-top: 0; }
      .locator-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .locator-name { color: #c9cfd7; font-size: 10px; font-weight: 650; }
      .locator-badge[data-unique="true"] { color: #a7debe; border-color: rgba(75,180,123,.32); }
      .locator-body { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px; align-items: start; }
      .code-box {
        min-height: 44px;
        max-height: 108px;
        margin: 0;
        overflow: auto;
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 9px;
        padding: 8px;
        background: rgba(5,7,9,.46);
        color: #d7dce3;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;
      }
      .json-toolbar { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 7px; }
      .json-preview { max-height: 380px; }
      .footnote { margin-top: 10px; color: #6f7884; font-size: 9px; text-align: center; }
      @media (max-width: 540px) {
        .panel { width: calc(100vw - 20px); top: 10px; right: 10px; max-width: none; }
        .command-row { grid-template-columns: 1fr; }
        .nav-grid { grid-template-columns: repeat(3, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel { animation: none; }
        button { transition: none; }
        .highlight-edge { animation-duration: 4s !important; }
      }
      @media (prefers-reduced-transparency: reduce) {
        .panel { background: #1b1e23; backdrop-filter: none; -webkit-backdrop-filter: none; }
      }
      @media (prefers-contrast: more) {
        .panel { background: #111317; border-color: rgba(255,255,255,.38); }
        .card, .target-card { border-color: rgba(255,255,255,.24); }
      }
    `;
    return style;
  }

  function createMarker() {
    const marker = document.createElement('div');
    marker.className = 'highlight';
    marker.setAttribute('aria-hidden', 'true');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const edge = document.createElement('span');
      edge.className = `highlight-edge ${side}`;
      marker.appendChild(edge);
    }
    return marker;
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Element Inspector');
    panel.innerHTML = `
      <header class="titlebar">
        <span class="brand-mark" aria-hidden="true"></span>
        <div class="brand-copy">
          <strong class="brand-title">Element Inspector</strong>
          <span class="brand-subtitle">v${EXTENSION_VERSION} · drag the header to move</span>
        </div>
        <div class="title-actions">
          <span class="mode-pill" data-mode="picking">SELECTING</span>
          <button class="icon" type="button" data-action="close" aria-label="閉じる">×</button>
        </div>
      </header>
      <div class="workspace">
        <section class="target-card">
          <div class="target-row">
            <div style="min-width:0;flex:1">
              <span class="eyebrow">Current target</span>
              <code class="target-name">Select an element</code>
            </div>
            <span class="frame-pill">TOP FRAME</span>
          </div>
          <div class="status" role="status">対象をホバーし、クリックして固定してください。</div>
          <div class="command-row">
            <button class="primary" type="button" data-action="pick" data-active="true">要素を選択</button>
            <div class="delay-control">
              <input type="number" min="1" max="60" value="${DEFAULT_DELAY_SECONDS}" aria-label="固定までの秒数">
              <button type="button" data-action="delay">秒後に固定</button>
            </div>
          </div>
        </section>

        <nav class="tabs" role="tablist" aria-label="Inspector views">
          <button type="button" role="tab" data-tab="overview" data-active="true">Overview</button>
          <button type="button" role="tab" data-tab="locators" data-active="false">Locators</button>
          <button type="button" role="tab" data-tab="json" data-active="false">JSON</button>
        </nav>

        <div class="tab-panel" data-panel="overview">
          <section class="card">
            <div class="card-head">
              <h2 class="card-title">Hierarchy</h2>
              <div class="metrics"><span>Sibling <b data-value="sibling">—</b></span><span>Children <b data-value="children">—</b></span></div>
            </div>
            <div class="nav-grid">
              <button type="button" data-nav="parent">親</button>
              <button type="button" data-nav="previous">前の兄弟</button>
              <button type="button" data-nav="next">次の兄弟</button>
              <button type="button" data-nav="firstChild">最初の子</button>
              <button type="button" data-nav="lastChild">最後の子</button>
            </div>
            <select class="child-select" aria-label="子要素を選択"></select>
          </section>
          <section class="card">
            <div class="card-head"><h2 class="card-title">Snapshot</h2></div>
            <div class="info-grid">
              <div class="info-cell"><span class="info-label">Tag</span><code class="info-value" data-value="tag">未固定</code></div>
              <div class="info-cell"><span class="info-label">Identity</span><code class="info-value" data-value="identity">—</code></div>
              <div class="info-cell wide"><span class="info-label">Rect</span><code class="info-value" data-value="rect">—</code></div>
              <div class="info-cell wide"><span class="info-label">Text</span><code class="info-value wrap" data-value="text">ページ上の要素へポインターを移動してください。</code></div>
            </div>
          </section>
        </div>

        <div class="tab-panel" data-panel="locators" hidden>
          <section class="card locator-card" data-locator="css">
            <div class="locator-head"><span class="locator-name">CSS Selector</span><span class="locator-badge">UNAVAILABLE</span></div>
            <div class="locator-body"><pre class="code-box">生成できません</pre><button type="button" data-copy="css">コピー</button></div>
          </section>
          <section class="card locator-card" data-locator="xpath">
            <div class="locator-head"><span class="locator-name">XPath</span><span class="locator-badge">UNAVAILABLE</span></div>
            <div class="locator-body"><pre class="code-box">生成できません</pre><button type="button" data-copy="xpath">コピー</button></div>
          </section>
          <section class="card locator-card" data-locator="jsPath">
            <div class="locator-head"><span class="locator-name">JS Path</span><span class="locator-badge">UNAVAILABLE</span></div>
            <div class="locator-body"><pre class="code-box">生成できません</pre><button type="button" data-copy="jsPath">コピー</button></div>
          </section>
        </div>

        <div class="tab-panel" data-panel="json" hidden>
          <section class="card">
            <div class="json-toolbar">
              <button type="button" data-action="copy-json">JSONをコピー</button>
              <button type="button" data-action="save-json">JSONを保存</button>
            </div>
            <pre class="code-box json-preview">固定した要素のJSONがここに表示されます。</pre>
          </section>
        </div>

        <div class="footnote">local only · no storage · Esc to close</div>
      </div>
    `;

    ui.panel = panel;
    ui.header = panel.querySelector('.titlebar');
    ui.modeBadge = panel.querySelector('.mode-pill');
    ui.targetName = panel.querySelector('.target-name');
    ui.frameBadge = panel.querySelector('.frame-pill');
    ui.status = panel.querySelector('.status');
    ui.pickButton = panel.querySelector('[data-action="pick"]');
    ui.delayInput = panel.querySelector('input[type="number"]');
    ui.delayButton = panel.querySelector('[data-action="delay"]');
    ui.tabButtons = Array.from(panel.querySelectorAll('[data-tab]'));
    ui.tabPanels = Array.from(panel.querySelectorAll('[data-panel]'));
    ui.parentButton = panel.querySelector('[data-nav="parent"]');
    ui.previousButton = panel.querySelector('[data-nav="previous"]');
    ui.nextButton = panel.querySelector('[data-nav="next"]');
    ui.firstChildButton = panel.querySelector('[data-nav="firstChild"]');
    ui.lastChildButton = panel.querySelector('[data-nav="lastChild"]');
    ui.childSelect = panel.querySelector('.child-select');
    ui.siblingMetric = panel.querySelector('[data-value="sibling"]');
    ui.childMetric = panel.querySelector('[data-value="children"]');
    ui.tagValue = panel.querySelector('[data-value="tag"]');
    ui.identityValue = panel.querySelector('[data-value="identity"]');
    ui.rectValue = panel.querySelector('[data-value="rect"]');
    ui.textValue = panel.querySelector('[data-value="text"]');
    ui.cssValue = panel.querySelector('[data-locator="css"] .code-box');
    ui.cssBadge = panel.querySelector('[data-locator="css"] .locator-badge');
    ui.xpathValue = panel.querySelector('[data-locator="xpath"] .code-box');
    ui.xpathBadge = panel.querySelector('[data-locator="xpath"] .locator-badge');
    ui.jsPathValue = panel.querySelector('[data-locator="jsPath"] .code-box');
    ui.jsPathBadge = panel.querySelector('[data-locator="jsPath"] .locator-badge');
    ui.jsonPreview = panel.querySelector('.json-preview');

    ui.header.addEventListener('pointerdown', beginPanelDrag);
    ui.header.addEventListener('pointermove', movePanel);
    ui.header.addEventListener('pointerup', endPanelDrag);
    ui.header.addEventListener('pointercancel', endPanelDrag);
    panel.addEventListener('pointerdown', event => event.stopPropagation());
    panel.addEventListener('click', event => event.stopPropagation());
    panel.addEventListener('wheel', event => event.stopPropagation());

    panel.querySelector('[data-action="close"]').addEventListener('click', () => sendTopCommand('DEACTIVATE'));
    ui.pickButton.addEventListener('click', beginPicking);
    ui.delayButton.addEventListener('click', toggleCountdown);
    panel.querySelector('[data-action="copy-json"]').addEventListener('click', copyJson);
    panel.querySelector('[data-action="save-json"]').addEventListener('click', downloadJson);
    for (const button of ui.tabButtons) {
      button.addEventListener('click', () => setActiveTab(button.dataset.tab));
    }
    for (const button of panel.querySelectorAll('[data-nav]')) {
      button.addEventListener('click', () => sendTopCommand('NAVIGATE', { direction: button.dataset.nav }));
    }
    ui.childSelect.addEventListener('change', () => {
      if (ui.childSelect.value === '') return;
      sendTopCommand('SELECT_CHILD', { childIndex: Number.parseInt(ui.childSelect.value, 10) });
      ui.childSelect.value = '';
    });
    for (const button of panel.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', () => copyLocator(button.dataset.copy));
    }

    renderUI();
    return panel;
  }

  function createFrameRoot() {
    if (frameState.host) return;
    if (!document.documentElement) return;
    frameState.host = document.createElement('div');
    frameState.host.setAttribute(ROOT_ATTRIBUTE, 'host');
    Object.assign(frameState.host.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none'
    });
    frameState.shadow = frameState.host.attachShadow({ mode: 'closed' });
    frameState.shadow.appendChild(createStyles());
    frameState.marker = createMarker();
    frameState.shadow.appendChild(frameState.marker);
    if (frameState.isTopFrame) frameState.shadow.appendChild(createPanel());
    document.documentElement.appendChild(frameState.host);
  }

  function mountFrameRootWhenReady() {
    if (!frameState.active || frameState.host) return;
    if (!document.documentElement) {
      document.addEventListener('readystatechange', mountFrameRootWhenReady, { once: true });
      return;
    }
    createFrameRoot();
    if (frameState.animationFrameId === null) {
      frameState.animationFrameId = requestAnimationFrame(updateHighlightPosition);
    }
  }

  function destroyFrameRoot() {
    if (frameState.animationFrameId !== null) {
      cancelAnimationFrame(frameState.animationFrameId);
      frameState.animationFrameId = null;
    }
    frameState.host?.remove();
    frameState.host = null;
    frameState.shadow = null;
    frameState.marker = null;
    frameState.childFrameRequests.clear();
    clearUICountdown();
    for (const key of Object.keys(ui)) {
      if (['activeTab'].includes(key)) continue;
      if (key === 'tabButtons' || key === 'tabPanels') ui[key] = [];
      else if (key === 'countdownTimer') ui[key] = null;
      else if (key === 'countdownDeadline' || key === 'countdownRemaining') ui[key] = 0;
      else ui[key] = null;
    }
    ui.activeTab = 'overview';
  }

  function setActive(active) {
    if (frameState.active === active) return;
    frameState.active = active;
    if (!active) {
      frameState.mode = 'idle';
      clearFrameSelection();
      destroyFrameRoot();
      document.removeEventListener('pointermove', onDocumentPointerMove, true);
      document.removeEventListener('focusin', onDocumentFocusIn, true);
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      document.removeEventListener('readystatechange', mountFrameRootWhenReady);
      window.removeEventListener('resize', keepPanelInViewport);
      return;
    }

    startFramePicking('picking');
    requestFrameContext();
    document.addEventListener('pointermove', onDocumentPointerMove, true);
    document.addEventListener('focusin', onDocumentFocusIn, true);
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    if (frameState.isTopFrame) window.addEventListener('resize', keepPanelInViewport);
    mountFrameRootWhenReady();
  }

  function handleFrameCommand(message) {
    if (!frameState.active) return;
    const command = message.command;
    if (command === 'START_PICKING') {
      startFramePicking('picking');
      return;
    }
    if (command === 'START_COUNTDOWN') {
      startFramePicking('countdown');
      return;
    }
    if (command === 'CLEAR_HOVER') {
      if (frameState.mode === 'picking' || frameState.mode === 'countdown') {
        frameState.hoveredElement = null;
        setHighlightTarget(null);
      }
      return;
    }
    if (command === 'SYNC_SELECTED') {
      if (frameState.frameId !== message.selectedFrameId) {
        frameState.mode = 'idle';
        clearFrameSelection();
      } else {
        frameState.mode = 'fixed';
      }
      return;
    }
    if (command === 'FIX_HOVER') {
      if (isElement(frameState.hoveredElement) && frameState.hoveredElement.isConnected) {
        inspectAndSelect(frameState.hoveredElement, '遅延固定');
      } else {
        emitFrameEvent({
          kind: 'status',
          status: 'error',
          message: 'カウント終了時に対象要素が見つかりませんでした。'
        });
      }
      return;
    }
    if (command === 'NAVIGATE') {
      navigateSelection(message.direction);
      return;
    }
    if (command === 'SELECT_CHILD') {
      selectChildByIndex(message.childIndex);
    }
  }

  window.addEventListener('message', onFrameContextMessage);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE.QUERY_STATE) {
      sendResponse({ ok: true, active: frameState.active });
      return false;
    }
    if (message?.type === MESSAGE.SET_ACTIVE) {
      setActive(Boolean(message.active));
      sendResponse({ ok: true, active: frameState.active });
      return false;
    }
    if (message?.type === MESSAGE.FRAME_COMMAND) {
      handleFrameCommand(message);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === MESSAGE.TOP_EVENT && frameState.isTopFrame) {
      handleTopEvent(message.event);
      sendResponse({ ok: true });
      return false;
    }
    return undefined;
  });

  chrome.runtime.sendMessage({ type: MESSAGE.FRAME_READY }, response => {
    if (chrome.runtime.lastError || !response?.ok) return;
    frameState.frameId = response.frameId;
    frameState.isTopFrame = Boolean(response.isTopFrame);
    if (response.active) setActive(true);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', requestFrameContext, { once: true });
  }
})();
