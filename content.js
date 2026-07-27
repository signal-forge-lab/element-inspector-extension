(() => {
  'use strict';

  const EXTENSION_VERSION = '0.8.1';
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
    selectionRegistry: new Map(),
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
    backButton: null,
    forwardButton: null,
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
    activeTab: 'overview',
    history: [],
    historyIndex: -1,
    pendingHistoryIndex: null
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

  function rememberSelection(selectionId, element) {
    frameState.selectionRegistry.set(selectionId, element);
    while (frameState.selectionRegistry.size > 100) {
      const oldestKey = frameState.selectionRegistry.keys().next().value;
      frameState.selectionRegistry.delete(oldestKey);
    }
  }

  function inspectAndSelect(element, reason = 'クリック', options = {}) {
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

    const selectionId = options.selectionId || createToken();
    rememberSelection(selectionId, element);

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
      selectionId,
      historyMode: options.historyMode || 'push',
      result
    });
  }

  function restoreSelection(selectionId) {
    const element = frameState.selectionRegistry.get(selectionId);
    if (!isElement(element) || !element.isConnected) {
      frameState.selectionRegistry.delete(selectionId);
      emitFrameEvent({
        kind: 'status',
        status: 'error',
        historyRestoreFailed: true,
        message: '履歴の対象要素はページから削除されています。'
      });
      return;
    }
    inspectAndSelect(element, '履歴', {
      selectionId,
      historyMode: 'restore'
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

  function locatorBadge(locator, frameRelative) {
    if (!locator?.value) return 'UNAVAILABLE';
    const scope = frameRelative ? 'FRAME' : 'DOCUMENT';
    if (locator.unique) return `UNIQUE · ${scope}`;
    if (Number.isInteger(locator.matchCount)) return `${locator.matchCount} MATCHES · ${scope}`;
    return `${locator.scope?.toUpperCase() || 'READY'} · ${scope}`;
  }

  function setLocatorView(valueNode, badgeNode, locator, frameRelative) {
    valueNode.textContent = locator?.value || '生成できません';
    badgeNode.textContent = locatorBadge(locator, frameRelative);
    badgeNode.dataset.unique = locator?.unique ? 'true' : 'false';
  }

  function renderUI() {
    if (!ui.panel) return;
    const result = ui.result;
    const hasResult = Boolean(result);

    ui.backButton.disabled = ui.historyIndex <= 0 || ui.pendingHistoryIndex !== null;
    ui.forwardButton.disabled = ui.historyIndex < 0 || ui.historyIndex >= ui.history.length - 1 || ui.pendingHistoryIndex !== null;

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
      setLocatorView(ui.cssValue, ui.cssBadge, null, false);
      setLocatorView(ui.xpathValue, ui.xpathBadge, null, false);
      setLocatorView(ui.jsPathValue, ui.jsPathBadge, null, false);
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
    const frameRelative = Boolean(result.locators?.context?.frameRelative);
    setLocatorView(ui.cssValue, ui.cssBadge, result.locators?.css, frameRelative);
    setLocatorView(ui.xpathValue, ui.xpathBadge, result.locators?.xpath, frameRelative);
    setLocatorView(ui.jsPathValue, ui.jsPathBadge, result.locators?.jsPath, frameRelative);
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

  function pushSelectionHistory(event) {
    if (!event.selectionId || !Number.isInteger(event.frameId) || !event.result) return;
    if (ui.historyIndex < ui.history.length - 1) {
      ui.history.splice(ui.historyIndex + 1);
    }
    ui.history.push({
      selectionId: event.selectionId,
      frameId: event.frameId,
      result: event.result
    });
    if (ui.history.length > 100) ui.history.shift();
    ui.historyIndex = ui.history.length - 1;
  }

  function navigateHistory(delta) {
    if (ui.pendingHistoryIndex !== null) return;
    const targetIndex = ui.historyIndex + delta;
    const entry = ui.history[targetIndex];
    if (!entry) return;
    ui.pendingHistoryIndex = targetIndex;
    renderUI();
    sendTopCommand('RESTORE_SELECTION', {
      targetFrameId: entry.frameId,
      selectionId: entry.selectionId
    });
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
      if (event.historyMode === 'restore' && ui.pendingHistoryIndex !== null) {
        ui.historyIndex = ui.pendingHistoryIndex;
      } else {
        pushSelectionHistory(event);
      }
      ui.pendingHistoryIndex = null;
      ui.result = event.result;
      ui.selectedFrameId = event.frameId;
      setUIMode('fixed');
      setUIStatus(`${event.reason || '選択'}で対象を固定しました。`, 'success');
      renderUI();
      return;
    }

    if (event.kind === 'status') {
      if (event.historyRestoreFailed) ui.pendingHistoryIndex = null;
      setUIStatus(event.message || '状態を更新しました。', event.status || 'normal');
      renderUI();
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
        from { opacity: 0; transform: scale(.99) translateY(-3px); }
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
        top: 14px;
        right: 14px;
        z-index: 2;
        width: 468px;
        max-width: calc(100vw - 28px);
        max-height: calc(100vh - 28px);
        overflow: hidden;
        pointer-events: auto;
        color: #eef1f4;
        border: 1px solid rgba(255,255,255,.105);
        border-radius: 16px;
        background:
          radial-gradient(circle at 10% -10%, rgba(113,142,194,.12), transparent 36%),
          rgba(25,28,33,.92);
        backdrop-filter: blur(24px) saturate(135%);
        -webkit-backdrop-filter: blur(24px) saturate(135%);
        box-shadow: 0 26px 72px rgba(0,0,0,.48), 0 1px 0 rgba(255,255,255,.065) inset;
        font: 12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        font-optical-sizing: auto;
        animation: ei-panel-arrive 160ms cubic-bezier(.2,.8,.2,1) both;
      }
      .titlebar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 52px;
        padding: 9px 10px 9px 13px;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .titlebar::after {
        content: '';
        position: absolute;
        left: 12px; right: 12px; bottom: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.09) 12%, rgba(255,255,255,.09) 88%, transparent);
      }
      .titlebar:active { cursor: grabbing; }
      .brand-mark {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 8px;
        background: linear-gradient(145deg, rgba(126,157,213,.24), rgba(61,70,84,.3));
        box-shadow: 0 1px 0 rgba(255,255,255,.1) inset;
      }
      .brand-mark::before {
        content: '';
        width: 13px;
        height: 13px;
        border: 1.5px solid #dbe4f5;
        border-radius: 3px;
        box-shadow: 5px 5px 0 -3px #8ba7d9;
      }
      .brand-copy { min-width: 0; flex: 1; }
      .brand-title { display: block; font-size: 12.5px; font-weight: 690; letter-spacing: -.012em; }
      .brand-subtitle { display: block; margin-top: 1px; color: #8b949f; font-size: 9.5px; letter-spacing: .012em; }
      .title-actions { display: flex; align-items: center; gap: 6px; }
      .mode-pill, .frame-pill, .locator-badge {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 999px;
        padding: 2px 7px;
        background: rgba(255,255,255,.038);
        color: #aab2bd;
        font-size: 8.5px;
        font-weight: 650;
        letter-spacing: .065em;
        white-space: nowrap;
      }
      .mode-pill[data-mode="picking"] { color: #b9cdf4; border-color: rgba(122,162,247,.38); }
      .mode-pill[data-mode="fixed"] { color: #a8dfbf; border-color: rgba(75,180,123,.34); }
      .mode-pill[data-mode="countdown"] { color: #ffd58d; border-color: rgba(226,169,69,.38); }
      button, input, select { font: inherit; }
      button {
        min-height: 31px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 8px;
        padding: 5px 9px;
        background: rgba(255,255,255,.052);
        color: #e9ecef;
        box-shadow: 0 1px 0 rgba(255,255,255,.04) inset;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 90ms ease;
      }
      button:hover:not(:disabled) { background: rgba(255,255,255,.085); border-color: rgba(255,255,255,.18); }
      button:active:not(:disabled) { transform: scale(.97); }
      button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #8fb4f7; outline-offset: 2px; }
      button:disabled { opacity: .34; cursor: default; }
      button.primary { background: rgba(76,108,166,.74); border-color: rgba(137,176,241,.44); }
      button.primary[data-active="true"] { box-shadow: 0 0 0 2px rgba(122,162,247,.18), 0 1px 0 rgba(255,255,255,.09) inset; }
      button.icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 29px;
        min-width: 29px;
        height: 29px;
        min-height: 29px;
        padding: 0;
      }
      button.icon-button svg { display: block; width: 14px; height: 14px; stroke: currentColor; }
      button.close-button { border-radius: 8px; color: #cbd1d8; }
      .workspace {
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 80px);
        overflow: hidden;
        padding: 10px 12px 0;
      }
      .fixed-stack {
        flex: 0 0 auto;
        border: 1px solid rgba(255,255,255,.095);
        border-radius: 14px;
        overflow: hidden;
        background: rgba(255,255,255,.025);
        box-shadow: 0 1px 0 rgba(255,255,255,.025) inset;
      }
      .command-surface { padding: 10px 11px 11px; }
      .target-row { display: flex; align-items: center; gap: 10px; }
      .eyebrow { color: #7f8996; font-size: 9px; font-weight: 650; letter-spacing: .09em; text-transform: uppercase; }
      .target-name { display: block; margin-top: 2px; overflow: hidden; color: #f4f6f8; font: 600 13px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace; text-overflow: ellipsis; white-space: nowrap; }
      .status { min-height: 20px; margin-top: 6px; color: #a7afb9; font-size: 10.5px; }
      .status[data-kind="success"] { color: #a5dcbc; }
      .status[data-kind="error"] { color: #ffb0a8; }
      .command-row { display: grid; grid-template-columns: minmax(0,1fr) 142px auto; gap: 7px; margin-top: 8px; }
      .delay-control { display: grid; grid-template-columns: 43px 1fr; gap: 5px; }
      .history-controls { display: grid; grid-template-columns: repeat(2, 29px); gap: 5px; }
      input, select {
        width: 100%;
        min-height: 31px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 8px;
        padding: 5px 8px;
        background: rgba(8,10,13,.46);
        color: #edf0f3;
      }
      .hierarchy-surface {
        padding: 9px 10px 10px;
        border-top: 1px solid rgba(255,255,255,.075);
        background: rgba(7,9,12,.14);
      }
      .surface-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
      .surface-title { color: #939ca7; font-size: 9px; font-weight: 700; letter-spacing: .085em; text-transform: uppercase; }
      .metrics { display: flex; gap: 8px; color: #707a86; font-size: 8.5px; }
      .metrics b { color: #bcc3cb; font-weight: 650; }
      .nav-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
      .nav-grid button { min-width: 0; min-height: 29px; padding-inline: 4px; font-size: 9.5px; }
      .child-select { margin-top: 6px; }
      .tabs {
        display: flex;
        flex: 0 0 auto;
        gap: 20px;
        margin-top: 10px;
        padding: 0 4px;
        border-bottom: 1px solid rgba(255,255,255,.075);
      }
      .tabs button {
        position: relative;
        min-height: 34px;
        border: 0;
        border-radius: 0;
        padding: 0 1px;
        background: transparent;
        color: #818b97;
        box-shadow: none;
        font-size: 10.5px;
      }
      .tabs button::after {
        content: '';
        position: absolute;
        left: 0; right: 0; bottom: -1px;
        height: 2px;
        border-radius: 2px 2px 0 0;
        background: #8fb4f7;
        transform: scaleX(0);
        transition: transform 140ms ease;
      }
      .tabs button[data-active="true"] { color: #edf1f5; }
      .tabs button[data-active="true"]::after { transform: scaleX(1); }
      .view-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 1px 8px; }
      .tab-panel { margin: 0; }
      .tab-panel[hidden] { display: none; }
      .section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
      .section-title { margin: 0; color: #9099a5; font-size: 9px; font-weight: 700; letter-spacing: .085em; text-transform: uppercase; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
      .info-cell { min-width: 0; border-bottom: 1px solid rgba(255,255,255,.065); padding: 7px 2px 8px; }
      .info-cell.wide { grid-column: 1 / -1; }
      .info-label { display: block; color: #707a86; font-size: 8.5px; letter-spacing: .055em; text-transform: uppercase; }
      .info-value { display: block; margin-top: 3px; overflow: hidden; color: #dbe0e6; text-overflow: ellipsis; white-space: nowrap; font: 10.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .info-value.wrap { max-height: 68px; overflow: auto; white-space: normal; overflow-wrap: anywhere; }
      .locator-card { padding: 9px 0 10px; border-bottom: 1px solid rgba(255,255,255,.065); }
      .locator-card:first-child { padding-top: 0; }
      .locator-card:last-child { border-bottom: 0; }
      .locator-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .locator-name { color: #c9cfd7; font-size: 10px; font-weight: 650; }
      .locator-badge[data-unique="true"] { color: #a7debe; border-color: rgba(75,180,123,.32); }
      .locator-body { display: grid; grid-template-columns: minmax(0,1fr) 54px; gap: 7px; align-items: start; }
      .code-box {
        min-height: 44px;
        max-height: 108px;
        margin: 0;
        overflow: auto;
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 8px;
        padding: 8px;
        background: rgba(5,7,9,.4);
        color: #d7dce3;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;
      }
      .json-toolbar { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 8px; }
      .json-preview { max-height: 380px; }
      .footer {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0 -12px;
        padding: 8px 12px 9px;
        border-top: 1px solid rgba(255,255,255,.065);
        color: #6f7884;
        font-size: 8.5px;
      }
      .local-state { display: inline-flex; align-items: center; gap: 6px; }
      .local-state::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #6f9f82; box-shadow: 0 0 0 2px rgba(111,159,130,.12); }
      .keycap { border: 1px solid rgba(255,255,255,.11); border-radius: 5px; padding: 1px 5px; background: rgba(255,255,255,.035); color: #949da8; font-size: 8px; }
      @media (max-width: 540px) {
        .panel { width: calc(100vw - 20px); top: 10px; right: 10px; max-width: none; }
        .command-row { grid-template-columns: 1fr 142px auto; }
        .nav-grid { grid-template-columns: repeat(3, 1fr); }
        .frame-pill { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel { animation: none; }
        button { transition: none; }
        .tabs button::after { transition: none; }
        .highlight-edge { animation-duration: 4s !important; }
      }
      @media (prefers-reduced-transparency: reduce) {
        .panel { background: #1b1e23; backdrop-filter: none; -webkit-backdrop-filter: none; }
      }
      @media (prefers-contrast: more) {
        .panel { background: #111317; border-color: rgba(255,255,255,.38); }
        .fixed-stack { border-color: rgba(255,255,255,.24); }
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
          <span class="frame-pill">TOP FRAME</span>
          <span class="mode-pill" data-mode="picking">SELECTING</span>
          <button class="icon-button close-button" type="button" data-action="close" aria-label="閉じる">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>
      </header>
      <div class="workspace">
        <div class="fixed-stack">
          <section class="command-surface">
            <div class="target-row">
              <div style="min-width:0;flex:1">
                <span class="eyebrow">Current target</span>
                <code class="target-name">Select an element</code>
              </div>
            </div>
            <div class="status" role="status">対象をホバーし、クリックして固定してください。</div>
            <div class="command-row">
              <button class="primary" type="button" data-action="pick" data-active="true">要素を選択</button>
              <div class="delay-control">
                <input type="number" min="1" max="60" value="${DEFAULT_DELAY_SECONDS}" aria-label="固定までの秒数">
                <button type="button" data-action="delay">秒後に固定</button>
              </div>
              <div class="history-controls" aria-label="選択履歴">
                <button class="icon-button" type="button" data-action="history-back" aria-label="前の選択へ戻る" title="前の選択へ戻る">
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.75 3.5L5.25 8l4.5 4.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <button class="icon-button" type="button" data-action="history-forward" aria-label="次の選択へ進む" title="次の選択へ進む">
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.25 3.5L10.75 8l-4.5 4.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </div>
          </section>

          <section class="hierarchy-surface">
            <div class="surface-head">
              <span class="surface-title">Hierarchy</span>
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
        </div>

        <nav class="tabs" role="tablist" aria-label="Inspector views">
          <button type="button" role="tab" data-tab="overview" data-active="true">Overview</button>
          <button type="button" role="tab" data-tab="locators" data-active="false">Locators</button>
          <button type="button" role="tab" data-tab="json" data-active="false">JSON</button>
        </nav>

        <div class="view-scroll">
          <div class="tab-panel" data-panel="overview">
            <section>
              <div class="section-head"><h2 class="section-title">Snapshot</h2></div>
              <div class="info-grid">
                <div class="info-cell"><span class="info-label">Tag</span><code class="info-value" data-value="tag">未固定</code></div>
                <div class="info-cell"><span class="info-label">Identity</span><code class="info-value" data-value="identity">—</code></div>
                <div class="info-cell wide"><span class="info-label">Rect</span><code class="info-value" data-value="rect">—</code></div>
                <div class="info-cell wide"><span class="info-label">Text</span><code class="info-value wrap" data-value="text">ページ上の要素へポインターを移動してください。</code></div>
              </div>
            </section>
          </div>

          <div class="tab-panel" data-panel="locators" hidden>
            <section class="locator-card" data-locator="css">
              <div class="locator-head"><span class="locator-name">CSS Selector</span><span class="locator-badge">UNAVAILABLE</span></div>
              <div class="locator-body"><pre class="code-box">生成できません</pre><button type="button" data-copy="css">Copy</button></div>
            </section>
            <section class="locator-card" data-locator="xpath">
              <div class="locator-head"><span class="locator-name">XPath</span><span class="locator-badge">UNAVAILABLE</span></div>
              <div class="locator-body"><pre class="code-box">生成できません</pre><button type="button" data-copy="xpath">Copy</button></div>
            </section>
            <section class="locator-card" data-locator="jsPath">
              <div class="locator-head"><span class="locator-name">JS Path</span><span class="locator-badge">UNAVAILABLE</span></div>
              <div class="locator-body"><pre class="code-box">生成できません</pre><button type="button" data-copy="jsPath">Copy</button></div>
            </section>
          </div>

          <div class="tab-panel" data-panel="json" hidden>
            <section>
              <div class="json-toolbar">
                <button type="button" data-action="copy-json">JSONをコピー</button>
                <button type="button" data-action="save-json">JSONを保存</button>
              </div>
              <pre class="code-box json-preview">固定した要素のJSONがここに表示されます。</pre>
            </section>
          </div>
        </div>

        <footer class="footer">
          <span class="local-state">Local only · no storage</span>
          <span><span class="keycap">Esc</span> close</span>
        </footer>
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
    ui.backButton = panel.querySelector('[data-action="history-back"]');
    ui.forwardButton = panel.querySelector('[data-action="history-forward"]');
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
    ui.backButton.addEventListener('click', () => navigateHistory(-1));
    ui.forwardButton.addEventListener('click', () => navigateHistory(1));
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
    frameState.selectionRegistry.clear();
    clearUICountdown();
    for (const key of Object.keys(ui)) {
      if (['activeTab'].includes(key)) continue;
      if (key === 'tabButtons' || key === 'tabPanels' || key === 'history') ui[key] = [];
      else if (key === 'countdownTimer') ui[key] = null;
      else if (key === 'countdownDeadline' || key === 'countdownRemaining') ui[key] = 0;
      else if (key === 'historyIndex') ui[key] = -1;
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
      return;
    }
    if (command === 'RESTORE_SELECTION') {
      restoreSelection(message.selectionId);
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
