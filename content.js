(() => {
  'use strict';

  const EXTENSION_VERSION = '0.13.0';
  const ROOT_ATTRIBUTE = 'data-element-inspector-ui';
  const FRAME_CHANNEL = '__element_inspector_frame_context_v1__';
  const DEFAULT_DELAY_SECONDS = 5;
  const MAX_HISTORY_ENTRIES = 100;
  const MAX_PINNED_ENTRIES = 4;
  const MIN_PANEL_WIDTH = 360;
  const MIN_PANEL_HEIGHT = 440;
  const DEFAULT_PANEL_WIDTH = 468;
  const EDIT_STYLE_MARKER = 'data-element-inspector-edit-style';
  const EDITABLE_PROPERTIES = Object.freeze([
    ['width', 'Width'], ['height', 'Height'],
    ['min-width', 'Min width'], ['max-width', 'Max width'],
    ['min-height', 'Min height'], ['max-height', 'Max height'],
    ['margin', 'Margin'], ['margin-top', 'Margin top'], ['margin-right', 'Margin right'],
    ['margin-bottom', 'Margin bottom'], ['margin-left', 'Margin left'],
    ['padding', 'Padding'], ['padding-top', 'Padding top'], ['padding-right', 'Padding right'],
    ['padding-bottom', 'Padding bottom'], ['padding-left', 'Padding left'],
    ['display', 'Display'], ['position', 'Position'],
    ['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left'],
    ['gap', 'Gap'], ['row-gap', 'Row gap'], ['column-gap', 'Column gap'],
    ['flex-direction', 'Flex direction'], ['justify-content', 'Justify content'], ['align-items', 'Align items'],
    ['grid-template-columns', 'Grid columns'],
    ['color', 'Color'], ['background-color', 'Background'],
    ['font-size', 'Font size'], ['line-height', 'Line height'],
    ['border-radius', 'Border radius'],
    ['overflow', 'Overflow'], ['overflow-x', 'Overflow X'], ['overflow-y', 'Overflow Y'],
    ['z-index', 'Z-index']
  ]);
  const EDITABLE_PROPERTY_SET = new Set(EDITABLE_PROPERTIES.map(([property]) => property));

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
    currentSelectionId: null,
    highlightedElement: null,
    animationFrameId: null,
    host: null,
    shadow: null,
    marker: null,
    selectionRegistry: new Map(),
    pinnedSelectionIds: new Set(),
    frameToken: createToken(),
    editAttributeName: null,
    editRecords: new Map(),
    editElementIds: new WeakMap(),
    editUndoStack: [],
    editStyleResources: new Map(),
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
    densityButtons: [],
    backButton: null,
    historySelect: null,
    historyPosition: null,
    forwardButton: null,
    pinButton: null,
    pinCount: null,
    tabButtons: [],
    tabPanels: [],
    compareTabButton: null,
    compareGrid: null,
    clearPinsButton: null,
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
    geometrySizeValue: null,
    geometryPositionValue: null,
    frameTypeValue: null,
    frameUrlValue: null,
    frameDepthValue: null,
    shadowDepthValue: null,
    shadowHostsValue: null,
    boxMarginValue: null,
    boxBorderValue: null,
    boxPaddingValue: null,
    boxContentValue: null,
    boxBorderBoxValue: null,
    boxScrollValue: null,
    layoutStylesGrid: null,
    flexGridStylesGrid: null,
    typographyStylesGrid: null,
    editPropertySelect: null,
    editValueInput: null,
    editApplyButton: null,
    editUndoButton: null,
    editResetCurrentButton: null,
    editResetAllButton: null,
    editCopyCssButton: null,
    editCurrentValue: null,
    editSummary: null,
    editList: null,
    a11yRoleValue: null,
    a11yRoleSourceValue: null,
    a11yNameValue: null,
    a11yNameSourceValue: null,
    a11yDescriptionValue: null,
    a11yLabelsValue: null,
    a11yFocusValue: null,
    a11yTabIndexValue: null,
    a11yHeadingValue: null,
    a11yStatesGrid: null,
    a11yAriaGrid: null,
    eventSummaryValue: null,
    eventList: null,
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
    resize: null,
    activeTab: 'overview',
    density: 'compact',
    history: [],
    historyIndex: -1,
    pendingHistoryIndex: null,
    currentSelectionId: null,
    pins: []
  };

  function createToken() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  frameState.editAttributeName = `data-ei-edit-${createToken().replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;

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
    frameState.currentSelectionId = null;
    setHighlightTarget(null);
  }

  function startFramePicking(mode = 'picking') {
    frameState.mode = mode;
    clearFrameSelection();
  }

  function rememberSelection(selectionId, element) {
    frameState.selectionRegistry.set(selectionId, element);
    while (frameState.selectionRegistry.size > MAX_HISTORY_ENTRIES + MAX_PINNED_ENTRIES) {
      let removed = false;
      for (const key of frameState.selectionRegistry.keys()) {
        if (frameState.pinnedSelectionIds.has(key)) continue;
        frameState.selectionRegistry.delete(key);
        removed = true;
        break;
      }
      if (!removed) break;
    }
  }

  function escapeCssAttributeValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function getComputedPropertyValue(element, property) {
    const view = element?.ownerDocument?.defaultView || window;
    const style = view?.getComputedStyle?.(element);
    const value = style?.getPropertyValue?.(property);
    return typeof value === 'string' && value.trim() ? value.trim() : '—';
  }

  function createEditStyleResource(root) {
    if (!root) return null;
    try {
      if (typeof CSSStyleSheet === 'function' && Array.isArray(root.adoptedStyleSheets)) {
        const sheet = new CSSStyleSheet();
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return { root, sheet, style: null };
      }
    } catch {}

    const style = document.createElement('style');
    style.setAttribute(EDIT_STYLE_MARKER, 'true');
    style.setAttribute(ROOT_ATTRIBUTE, 'temporary-edit-style');
    if (root.nodeType === 9) {
      (root.head || root.documentElement)?.appendChild(style);
    } else if (typeof root.appendChild === 'function') {
      root.appendChild(style);
    }
    return style.isConnected || root.nodeType === 11 ? { root, sheet: null, style } : null;
  }

  function setEditStyleResourceText(resource, cssText) {
    if (!resource) return;
    if (resource.sheet) {
      try {
        resource.sheet.replaceSync(cssText);
        return;
      } catch {}
    }
    if (resource.style) resource.style.textContent = cssText;
  }

  function disposeEditStyleResource(resource) {
    if (!resource) return;
    if (resource.sheet) {
      try {
        resource.root.adoptedStyleSheets = Array.from(resource.root.adoptedStyleSheets || [])
          .filter(sheet => sheet !== resource.sheet);
      } catch {}
    }
    resource.style?.remove();
  }

  function restoreEditAttribute(record) {
    const element = record?.element;
    if (!isElement(element)) return;
    if (record.hadOriginalAttribute) {
      element.setAttribute(frameState.editAttributeName, record.originalAttributeValue || '');
    } else {
      element.removeAttribute(frameState.editAttributeName);
    }
  }

  function removeEditRecord(record) {
    if (!record) return;
    restoreEditAttribute(record);
    frameState.editRecords.delete(record.editId);
    if (isElement(record.element)) frameState.editElementIds.delete(record.element);
  }

  function ensureEditRecord(element) {
    const existingId = frameState.editElementIds.get(element);
    const existing = existingId ? frameState.editRecords.get(existingId) : null;
    if (existing) return existing;

    const editId = createToken();
    const attributeName = frameState.editAttributeName;
    const locator = globalThis.ElementInspector?.generateCssLocator?.(element);
    const jsPath = globalThis.ElementInspector?.generateJsPath?.(element, locator);
    const shadow = globalThis.ElementInspector?.collectShadowContext?.(element);
    const record = {
      editId,
      element,
      root: element.getRootNode?.() || document,
      hadOriginalAttribute: element.hasAttribute(attributeName),
      originalAttributeValue: element.getAttribute(attributeName),
      selector: locator?.value || null,
      selectorScope: locator?.scope || 'document',
      jsPath: jsPath?.value || null,
      shadowDepth: shadow?.depth || 0,
      declarations: new Map()
    };
    element.setAttribute(attributeName, editId);
    frameState.editElementIds.set(element, editId);
    frameState.editRecords.set(editId, record);
    return record;
  }

  function declarationBlock(record) {
    return Array.from(record.declarations.values())
      .map(item => `  ${item.property}: ${item.value} !important;`)
      .join('\n');
  }

  function appliedRuleText(record) {
    const selector = `[${frameState.editAttributeName}="${escapeCssAttributeValue(record.editId)}"]`;
    return `${selector} {\n${declarationBlock(record)}\n}`;
  }

  function copiedRuleText(record) {
    const selector = record.selector || `[${frameState.editAttributeName}="${escapeCssAttributeValue(record.editId)}"]`;
    const prefix = record.shadowDepth > 0
      ? `/* Apply inside open Shadow Root depth ${record.shadowDepth}${record.jsPath ? `\nTarget: ${record.jsPath}` : ''} */\n`
      : '';
    return `${prefix}${selector} {\n${declarationBlock(record)}\n}`;
  }

  function renderTemporaryEditStyles() {
    const byRoot = new Map();
    for (const record of Array.from(frameState.editRecords.values())) {
      if (!isElement(record.element) || !record.element.isConnected || !record.declarations.size) {
        if (!record.declarations.size || !record.element?.isConnected) removeEditRecord(record);
        continue;
      }
      const root = record.element.getRootNode?.() || document;
      record.root = root;
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(appliedRuleText(record));
    }

    for (const [root, resource] of Array.from(frameState.editStyleResources.entries())) {
      if (byRoot.has(root)) continue;
      disposeEditStyleResource(resource);
      frameState.editStyleResources.delete(root);
    }

    for (const [root, rules] of byRoot) {
      let resource = frameState.editStyleResources.get(root);
      if (!resource) {
        resource = createEditStyleResource(root);
        if (resource) frameState.editStyleResources.set(root, resource);
      }
      setEditStyleResourceText(resource, rules.join('\n\n'));
    }
  }

  function sanitizeTemporaryEditArtifacts(result) {
    if (!result) return result;
    const attributeName = frameState.editAttributeName;
    const removeAttribute = attributes => {
      if (attributes && Object.prototype.hasOwnProperty.call(attributes, attributeName)) {
        delete attributes[attributeName];
      }
    };
    removeAttribute(result.selectedAttributes);
    removeAttribute(result.controlAttributes);
    for (const ancestor of result.ancestors || []) removeAttribute(ancestor.attributes);
    for (const host of result.shadow?.hosts || []) removeAttribute(host.attributes);
    const pattern = new RegExp(`\\s${attributeName}="[^"]*"`, 'g');
    result.selectedOuterHTML = String(result.selectedOuterHTML || '').replace(pattern, '');
    result.outerHTML = String(result.outerHTML || '').replace(pattern, '');
    return result;
  }

  function buildTemporaryEditSnapshot(element) {
    const editId = frameState.editElementIds.get(element);
    const record = editId ? frameState.editRecords.get(editId) : null;
    const declarations = record
      ? Array.from(record.declarations.values()).map(item => ({
          property: item.property,
          before: item.before,
          value: item.value,
          after: getComputedPropertyValue(element, item.property)
        }))
      : [];
    const currentValues = Object.fromEntries(
      EDITABLE_PROPERTIES.map(([property]) => [property, getComputedPropertyValue(element, property)])
    );
    const activeRecords = Array.from(frameState.editRecords.values()).filter(item => item.declarations.size > 0);
    return {
      active: declarations.length > 0,
      targetId: record?.editId || null,
      frameEditCount: activeRecords.length,
      undoAvailable: frameState.editUndoStack.length > 0,
      declarations,
      currentValues,
      cssText: record?.declarations.size ? copiedRuleText(record) : '',
      allCssText: activeRecords.map(copiedRuleText).join('\n\n')
    };
  }

  function refreshSelectedAfterEdit(reason, statusMessage) {
    const selected = frameState.selectedElement;
    if (!isElement(selected) || !selected.isConnected) {
      emitFrameEvent({ kind: 'status', status: 'error', message: '編集対象がページから削除されています。' });
      return;
    }
    inspectAndSelect(selected, reason, {
      selectionId: frameState.currentSelectionId || createToken(),
      historyMode: 'refresh',
      statusMessage
    });
  }

  function applyTemporaryEdit(property, value) {
    const selected = frameState.selectedElement;
    const normalizedProperty = String(property || '').trim().toLowerCase();
    const normalizedValue = String(value || '').trim();
    if (!isElement(selected) || !selected.isConnected) {
      emitFrameEvent({ kind: 'status', status: 'error', message: '固定中の編集対象がありません。' });
      return;
    }
    if (!EDITABLE_PROPERTY_SET.has(normalizedProperty)) {
      emitFrameEvent({ kind: 'status', status: 'error', message: 'このCSSプロパティは一時編集の対象外です。' });
      return;
    }
    if (!normalizedValue || /!important/i.test(normalizedValue)) {
      emitFrameEvent({ kind: 'status', status: 'error', message: 'CSS値を入力してください。!importantは自動付与されます。' });
      return;
    }
    if (globalThis.CSS?.supports && !globalThis.CSS.supports(normalizedProperty, normalizedValue)) {
      emitFrameEvent({ kind: 'status', status: 'error', message: `${normalizedProperty}: ${normalizedValue} は有効なCSS値ではありません。` });
      return;
    }

    const record = ensureEditRecord(selected);
    const previous = record.declarations.get(normalizedProperty) || null;
    if (previous?.value === normalizedValue) {
      emitFrameEvent({ kind: 'status', status: 'normal', message: '同じ編集値がすでに適用されています。' });
      return;
    }
    const before = previous?.before || getComputedPropertyValue(selected, normalizedProperty);
    frameState.editUndoStack.push({
      editId: record.editId,
      property: normalizedProperty,
      previous: previous ? { ...previous } : null
    });
    record.declarations.set(normalizedProperty, {
      property: normalizedProperty,
      before,
      value: normalizedValue
    });
    renderTemporaryEditStyles();
    refreshSelectedAfterEdit('一時編集', `${normalizedProperty}: ${normalizedValue} を一時適用しました。`);
  }

  function undoTemporaryEdit() {
    while (frameState.editUndoStack.length) {
      const operation = frameState.editUndoStack.pop();
      const record = frameState.editRecords.get(operation.editId);
      if (!record) continue;
      if (operation.previous) record.declarations.set(operation.property, operation.previous);
      else record.declarations.delete(operation.property);
      if (!record.declarations.size) removeEditRecord(record);
      renderTemporaryEditStyles();
      refreshSelectedAfterEdit('編集Undo', '直前の一時編集を元に戻しました。');
      return;
    }
    emitFrameEvent({ kind: 'status', status: 'normal', message: '元に戻せる一時編集がありません。' });
  }

  function resetCurrentTemporaryEdits() {
    const selected = frameState.selectedElement;
    const editId = isElement(selected) ? frameState.editElementIds.get(selected) : null;
    const record = editId ? frameState.editRecords.get(editId) : null;
    if (!record) {
      emitFrameEvent({ kind: 'status', status: 'normal', message: '現在の対象には一時編集がありません。' });
      return;
    }
    removeEditRecord(record);
    frameState.editUndoStack = frameState.editUndoStack.filter(operation => operation.editId !== editId);
    renderTemporaryEditStyles();
    refreshSelectedAfterEdit('編集Reset', '現在の対象の一時編集をすべて解除しました。');
  }

  function resetAllTemporaryEdits(options = {}) {
    const hadEdits = frameState.editRecords.size > 0;
    for (const record of Array.from(frameState.editRecords.values())) removeEditRecord(record);
    frameState.editUndoStack = [];
    for (const resource of frameState.editStyleResources.values()) disposeEditStyleResource(resource);
    frameState.editStyleResources.clear();
    if (options.refresh !== false && isElement(frameState.selectedElement) && frameState.selectedElement.isConnected) {
      refreshSelectedAfterEdit('全編集Reset', hadEdits ? 'すべての一時編集を解除しました。' : '一時編集はありません。');
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
    frameState.currentSelectionId = selectionId;
    rememberSelection(selectionId, element);

    const result = sanitizeTemporaryEditArtifacts(globalThis.ElementInspector.inspectElement(element));
    result.frame = buildFrameInfo();
    result.locators.context = {
      frameRelative: !frameState.isTopFrame,
      frameId: frameState.frameId,
      framePath: frameState.frameContext.path,
      shadowDepth: result.shadow?.depth || 0
    };
    result.temporaryEdits = buildTemporaryEditSnapshot(element);
    emitFrameEvent({
      kind: 'selected',
      reason,
      selectionId,
      historyMode: options.historyMode || 'push',
      statusMessage: options.statusMessage || null,
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
        message: '保存した選択対象はページから削除されています。'
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

    const siblings = globalThis.ElementInspector?.getSiblingElements?.(selected) || [];
    const siblingIndex = siblings.indexOf(selected);
    const children = globalThis.ElementInspector?.getNavigableChildren?.(selected) || [];
    const targetByDirection = {
      parent: globalThis.ElementInspector?.getComposedParent?.(selected) || selected.parentElement,
      previous: siblingIndex > 0 ? siblings[siblingIndex - 1] : null,
      next: siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null,
      firstChild: children[0]?.element || selected.firstElementChild,
      lastChild: children[children.length - 1]?.element || selected.lastElementChild
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
    const children = globalThis.ElementInspector?.getNavigableChildren?.(selected) || [];
    const child = children[index]?.element || selected?.children?.[index];
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

  function renderHeaderFrameBadge(frame) {
    if (!ui.frameBadge) return;
    const isIframe = Boolean(frame && !frame.isTopFrame);
    ui.frameBadge.hidden = !isIframe;
    ui.frameBadge.textContent = isIframe ? `IFRAME · DEPTH ${frame.depth ?? 0}` : '';
  }

  function locatorBadge(locator, frameRelative) {
    const scopes = [frameRelative ? 'FRAME' : 'DOCUMENT'];
    if (locator?.scope === 'shadow-root' || locator?.scope === 'shadow-chain') {
      scopes.push(locator.shadowDepth ? `SHADOW ${locator.shadowDepth}` : 'SHADOW');
    }
    const scope = scopes.join(' · ');
    if (!locator?.value) return locator?.unsupported ? `UNSUPPORTED · ${scope}` : `UNAVAILABLE · ${scope}`;
    if (locator.unique) return `UNIQUE · ${scope}`;
    if (Number.isInteger(locator.matchCount)) return `${locator.matchCount} MATCHES · ${scope}`;
    return `${locator.scope?.toUpperCase() || 'READY'} · ${scope}`;
  }

  function setLocatorView(valueNode, badgeNode, locator, frameRelative) {
    valueNode.textContent = locator?.value || '生成できません';
    badgeNode.textContent = locatorBadge(locator, frameRelative);
    badgeNode.dataset.unique = locator?.unique ? 'true' : 'false';
  }

  function truncateLabel(value, maxLength = 48) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function historyEntryLabel(entry, index) {
    const result = entry.result || {};
    const identity = identityFromAttributes(result.selectedAttributes);
    const frame = frameBadgeText(result.frame);
    return `${index + 1}. <${result.selectedTag || 'element'}> ${truncateLabel(identity, 28)} · ${frame} · ${entry.reason || '選択'}`;
  }

  function renderHistoryMenu() {
    if (!ui.historySelect) return;
    if (ui.historyPosition) {
      const currentPosition = ui.historyIndex >= 0 ? ui.historyIndex + 1 : 0;
      ui.historyPosition.textContent = `${currentPosition} / ${ui.history.length}`;
    }
    ui.historySelect.replaceChildren();
    if (!ui.history.length) {
      ui.historySelect.appendChild(new Option('履歴なし', ''));
      ui.historySelect.disabled = true;
      return;
    }
    for (let index = 0; index < ui.history.length; index += 1) {
      const entry = ui.history[index];
      const option = new Option(historyEntryLabel(entry, index), String(index));
      option.title = `${entry.reason || '選択'} · ${frameBadgeText(entry.result?.frame)}`;
      ui.historySelect.appendChild(option);
    }
    ui.historySelect.disabled = ui.pendingHistoryIndex !== null;
    ui.historySelect.value = String(Math.max(0, ui.historyIndex));
    ui.historySelect.setAttribute('aria-label', `選択履歴 ${ui.historyIndex + 1} / ${ui.history.length}`);
  }

  function boxSideSummary(sides) {
    if (!sides) return '—';
    return `T ${sides.top || '0px'} · R ${sides.right || '0px'} · B ${sides.bottom || '0px'} · L ${sides.left || '0px'}`;
  }

  function renderStylePropertyGrid(container, values) {
    if (!container) return;
    container.replaceChildren();
    for (const [property, value] of Object.entries(values || {})) {
      const item = document.createElement('div');
      item.className = 'style-property';
      const label = document.createElement('span');
      label.className = 'style-property-name';
      label.textContent = property;
      const valueNode = document.createElement('code');
      valueNode.className = 'style-property-value';
      valueNode.textContent = value || '—';
      item.append(label, valueNode);
      container.appendChild(item);
    }
  }

  function renderStylesView(result) {
    const boxModel = result?.boxModel;
    const computed = result?.computedStyles;
    if (ui.boxMarginValue) ui.boxMarginValue.textContent = boxSideSummary(boxModel?.margin);
    if (ui.boxBorderValue) ui.boxBorderValue.textContent = boxSideSummary(boxModel?.border);
    if (ui.boxPaddingValue) ui.boxPaddingValue.textContent = boxSideSummary(boxModel?.padding);
    if (ui.boxContentValue) {
      ui.boxContentValue.textContent = boxModel
        ? `${boxModel.content.width} × ${boxModel.content.height}`
        : '—';
    }
    if (ui.boxBorderBoxValue) {
      ui.boxBorderBoxValue.textContent = boxModel
        ? `${boxModel.borderBox.width} × ${boxModel.borderBox.height} · ${boxModel.boxSizing}`
        : '—';
    }
    if (ui.boxScrollValue) {
      const scroll = boxModel?.scroll;
      ui.boxScrollValue.textContent = scroll && scroll.width != null && scroll.height != null
        ? `${scroll.width} × ${scroll.height}`
        : '—';
    }
    renderStylePropertyGrid(ui.layoutStylesGrid, computed?.layout);
    renderStylePropertyGrid(ui.flexGridStylesGrid, computed?.flexGrid);
    renderStylePropertyGrid(ui.typographyStylesGrid, computed?.typography);
  }

  function renderAuditRows(container, entries, emptyText = '情報なし') {
    if (!container) return;
    container.replaceChildren();
    const filtered = entries.filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'audit-empty';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    for (const [labelText, rawValue] of filtered) {
      const row = document.createElement('div');
      row.className = 'audit-row';
      const label = document.createElement('span');
      label.className = 'audit-label';
      label.textContent = labelText;
      const value = document.createElement('code');
      value.className = 'audit-value';
      value.textContent = typeof rawValue === 'boolean' ? (rawValue ? 'true' : 'false') : String(rawValue);
      row.append(label, value);
      container.appendChild(row);
    }
  }

  function renderEditView(result) {
    const edits = result?.temporaryEdits;
    const hasResult = Boolean(result);
    const property = ui.editPropertySelect?.value || 'width';
    if (ui.editCurrentValue) {
      ui.editCurrentValue.textContent = hasResult
        ? edits?.currentValues?.[property] || '—'
        : '対象を固定してください';
    }
    if (ui.editApplyButton) ui.editApplyButton.disabled = !hasResult;
    if (ui.editValueInput) ui.editValueInput.disabled = !hasResult;
    if (ui.editPropertySelect) ui.editPropertySelect.disabled = !hasResult;
    if (ui.editUndoButton) ui.editUndoButton.disabled = !edits?.undoAvailable;
    if (ui.editResetCurrentButton) ui.editResetCurrentButton.disabled = !edits?.active;
    if (ui.editResetAllButton) ui.editResetAllButton.disabled = !(edits?.frameEditCount > 0);
    if (ui.editCopyCssButton) ui.editCopyCssButton.disabled = !edits?.allCssText;
    if (ui.editSummary) {
      const propertyCount = edits?.declarations?.length || 0;
      const targetCount = edits?.frameEditCount || 0;
      ui.editSummary.textContent = hasResult
        ? `${propertyCount} properties · ${targetCount} edited targets in frame`
        : 'Temporary · removed on close or reload';
    }
    if (!ui.editList) return;
    ui.editList.replaceChildren();
    const declarations = edits?.declarations || [];
    if (!declarations.length) {
      const empty = document.createElement('div');
      empty.className = 'edit-empty';
      empty.textContent = hasResult ? '現在の対象には一時編集がありません。' : '要素を固定すると編集できます。';
      ui.editList.appendChild(empty);
      return;
    }
    for (const declaration of declarations) {
      const row = document.createElement('div');
      row.className = 'edit-row';
      const propertyNode = document.createElement('code');
      propertyNode.className = 'edit-property';
      propertyNode.textContent = declaration.property;
      const values = document.createElement('div');
      values.className = 'edit-values';
      const before = document.createElement('code');
      before.textContent = declaration.before || '—';
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      const after = document.createElement('code');
      after.textContent = declaration.value || declaration.after || '—';
      values.append(before, arrow, after);
      row.append(propertyNode, values);
      ui.editList.appendChild(row);
    }
  }

  function renderAccessibilityView(result) {
    const accessibility = result?.accessibility;
    const events = result?.events;
    if (ui.a11yRoleValue) ui.a11yRoleValue.textContent = accessibility?.role || 'none';
    if (ui.a11yRoleSourceValue) {
      ui.a11yRoleSourceValue.textContent = accessibility?.explicitRole
        ? `explicit: ${accessibility.explicitRole}`
        : accessibility?.implicitRole
          ? `implicit: ${accessibility.implicitRole}`
          : 'no role';
    }
    if (ui.a11yNameValue) ui.a11yNameValue.textContent = accessibility?.name?.value || '名前なし';
    if (ui.a11yNameSourceValue) {
      const approximate = accessibility?.name?.approximate ? ' · estimated' : '';
      ui.a11yNameSourceValue.textContent = `${accessibility?.name?.source || 'none'}${approximate}`;
    }
    if (ui.a11yDescriptionValue) ui.a11yDescriptionValue.textContent = accessibility?.description?.value || '説明なし';
    if (ui.a11yLabelsValue) ui.a11yLabelsValue.textContent = accessibility?.labels?.join(' · ') || 'ラベルなし';
    if (ui.a11yFocusValue) {
      ui.a11yFocusValue.textContent = accessibility
        ? accessibility.focus.focusable
          ? accessibility.focus.sequentiallyFocusable ? 'Focusable · sequential' : 'Focusable · programmatic'
          : 'Not focusable'
        : '—';
    }
    if (ui.a11yTabIndexValue) {
      ui.a11yTabIndexValue.textContent = accessibility?.focus?.tabIndex == null
        ? '—'
        : String(accessibility.focus.tabIndex);
    }
    if (ui.a11yHeadingValue) ui.a11yHeadingValue.textContent = accessibility?.headingLevel ? `Level ${accessibility.headingLevel}` : '—';
    renderAuditRows(ui.a11yStatesGrid, Object.entries(accessibility?.states || {}), '状態情報なし');
    renderAuditRows(ui.a11yAriaGrid, Object.entries(accessibility?.ariaAttributes || {}), 'ARIA属性なし');

    if (ui.eventSummaryValue) {
      ui.eventSummaryValue.textContent = events?.hasAny
        ? `${events.types.length} types · DOM0 / inline only`
        : '検出可能なイベントなし';
    }
    if (!ui.eventList) return;
    ui.eventList.replaceChildren();
    const handlers = [
      ...(events?.attributes || []).map(item => ({ ...item, source: 'attribute' })),
      ...(events?.properties || []).map(item => ({ ...item, source: 'property' }))
    ];
    if (!handlers.length) {
      const empty = document.createElement('div');
      empty.className = 'audit-empty';
      empty.textContent = 'onclick属性やDOM0プロパティは検出されませんでした。';
      ui.eventList.appendChild(empty);
    } else {
      for (const handler of handlers) {
        const item = document.createElement('div');
        item.className = 'event-item';
        const head = document.createElement('div');
        head.className = 'event-head';
        const type = document.createElement('strong');
        type.textContent = handler.type;
        const source = document.createElement('span');
        source.textContent = handler.source;
        head.append(type, source);
        const preview = document.createElement('code');
        preview.className = 'event-preview';
        preview.textContent = handler.preview || 'handler';
        item.append(head, preview);
        ui.eventList.appendChild(item);
      }
    }
  }

  function isCurrentPinned() {
    return Boolean(ui.currentSelectionId) && ui.pins.some(pin =>
      pin.selectionId === ui.currentSelectionId && pin.frameId === ui.selectedFrameId
    );
  }

  function createComparisonField(label, value, options = {}) {
    const field = document.createElement('div');
    field.className = `compare-field${options.wide ? ' wide' : ''}`;
    const labelNode = document.createElement('span');
    labelNode.className = 'compare-label';
    labelNode.textContent = label;
    const valueNode = document.createElement('code');
    valueNode.className = `compare-value${options.wrap ? ' wrap' : ''}`;
    valueNode.textContent = value || '—';
    field.append(labelNode, valueNode);
    return field;
  }

  function renderPinnedComparisons() {
    if (!ui.compareGrid || !ui.compareTabButton) return;
    const pinCount = ui.pins.length;
    ui.compareTabButton.hidden = pinCount === 0;
    ui.compareTabButton.textContent = `Compare${pinCount ? ` ${pinCount}` : ''}`;
    if (ui.pinCount) ui.pinCount.textContent = String(pinCount);
    if (ui.clearPinsButton) ui.clearPinsButton.disabled = pinCount === 0;
    ui.compareGrid.replaceChildren();

    if (!pinCount) {
      const empty = document.createElement('div');
      empty.className = 'compare-empty';
      empty.textContent = 'ピン留めした要素がここに表示されます。';
      ui.compareGrid.appendChild(empty);
      if (ui.activeTab === 'compare') setActiveTab('overview');
      return;
    }

    for (const pin of ui.pins) {
      const result = pin.result || {};
      const card = document.createElement('article');
      card.className = 'compare-card';
      card.dataset.pinId = pin.pinId;

      const head = document.createElement('div');
      head.className = 'compare-head';
      const titleWrap = document.createElement('div');
      titleWrap.className = 'compare-title-wrap';
      const title = document.createElement('strong');
      title.className = 'compare-title';
      title.textContent = `<${result.selectedTag || 'element'}>`;
      const frame = document.createElement('span');
      frame.className = 'compare-frame';
      frame.textContent = frameBadgeText(result.frame);
      titleWrap.append(title, frame);

      const actions = document.createElement('div');
      actions.className = 'compare-actions';
      const restoreButton = document.createElement('button');
      restoreButton.type = 'button';
      restoreButton.dataset.pinAction = 'restore';
      restoreButton.textContent = '選択';
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.dataset.pinAction = 'remove';
      removeButton.setAttribute('aria-label', 'ピンを解除');
      removeButton.textContent = '解除';
      actions.append(restoreButton, removeButton);
      head.append(titleWrap, actions);

      const fields = document.createElement('div');
      fields.className = 'compare-fields';
      const rect = result.selectedRect;
      fields.append(
        createComparisonField('Identity', identityFromAttributes(result.selectedAttributes), { wide: true, wrap: true }),
        createComparisonField('Rect', rect ? `${rect.width} × ${rect.height} · ${rect.left}, ${rect.top}` : '—'),
        createComparisonField('Text', result.selectedText || 'テキストなし', { wide: true, wrap: true }),
        createComparisonField('CSS Selector', result.locators?.css?.value || '生成できません', { wide: true, wrap: true }),
        createComparisonField('XPath', result.locators?.xpath?.value || '生成できません', { wide: true, wrap: true }),
        createComparisonField('JS Path', result.locators?.jsPath?.value || '生成できません', { wide: true, wrap: true })
      );

      const locatorActions = document.createElement('div');
      locatorActions.className = 'compare-locators';
      for (const [kind, label] of [['css', 'CSS'], ['xpath', 'XPath'], ['jsPath', 'JS']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.pinAction = 'copy-locator';
        button.dataset.locatorKind = kind;
        button.textContent = label;
        button.disabled = !result.locators?.[kind]?.value;
        locatorActions.appendChild(button);
      }
      card.append(head, fields, locatorActions);
      ui.compareGrid.appendChild(card);
    }
  }

  function renderUI() {
    if (!ui.panel) return;
    const result = ui.result;
    const hasResult = Boolean(result);

    ui.backButton.disabled = ui.historyIndex <= 0 || ui.pendingHistoryIndex !== null;
    ui.forwardButton.disabled = ui.historyIndex < 0 || ui.historyIndex >= ui.history.length - 1 || ui.pendingHistoryIndex !== null;
    renderHistoryMenu();
    if (ui.pinButton) {
      ui.pinButton.disabled = !hasResult || !ui.currentSelectionId;
      ui.pinButton.dataset.active = isCurrentPinned() ? 'true' : 'false';
      ui.pinButton.setAttribute('aria-pressed', ui.pinButton.dataset.active);
      ui.pinButton.title = isCurrentPinned() ? '現在の要素のピンを解除' : '現在の要素を比較へピン留め';
    }
    renderPinnedComparisons();

    ui.parentButton.disabled = !result?.navigation?.hasParent;
    ui.parentButton.title = result?.navigation?.parentCrossesShadowBoundary
      ? 'Shadow Hostへ移動'
      : '親要素へ移動';
    ui.previousButton.disabled = !result?.navigation?.hasPreviousSibling;
    ui.nextButton.disabled = !result?.navigation?.hasNextSibling;
    ui.firstChildButton.disabled = !result?.navigation?.childCount;
    ui.lastChildButton.disabled = !result?.navigation?.childCount;

    ui.childSelect.disabled = !result?.navigation?.childCount;
    ui.childSelect.replaceChildren(new Option('子要素を選択…', ''));
    const hasShadowChildren = Boolean(result?.navigation?.children?.some(child => child.treeScope === 'shadow'));
    for (const child of result?.navigation?.children || []) {
      const scope = hasShadowChildren ? `${child.treeScope === 'shadow' ? 'Shadow' : 'Light'} · ` : '';
      ui.childSelect.appendChild(new Option(`${child.index + 1}. ${scope}${child.label}`, String(child.index)));
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
      ui.geometrySizeValue.textContent = '—';
      ui.geometryPositionValue.textContent = '—';
      ui.frameTypeValue.textContent = 'TOP FRAME';
      ui.frameUrlValue.textContent = location.href;
      ui.frameDepthValue.textContent = '0';
      ui.shadowDepthValue.textContent = '0';
      ui.shadowHostsValue.textContent = 'Document tree';
      renderHeaderFrameBadge(null);
      setLocatorView(ui.cssValue, ui.cssBadge, null, false);
      setLocatorView(ui.xpathValue, ui.xpathBadge, null, false);
      setLocatorView(ui.jsPathValue, ui.jsPathBadge, null, false);
      ui.jsonPreview.textContent = '固定した要素のJSONがここに表示されます。';
      renderStylesView(null);
      renderEditView(null);
      renderAccessibilityView(null);
      return;
    }

    const rect = result.selectedRect;
    ui.targetName.textContent = `<${result.selectedTag}>`;
    renderHeaderFrameBadge(result.frame);
    ui.tagValue.textContent = result.selectedTag || '—';
    ui.identityValue.textContent = identityFromAttributes(result.selectedAttributes);
    ui.rectValue.textContent = rect
      ? `${rect.width} × ${rect.height} · ${rect.left}, ${rect.top}`
      : '—';
    ui.textValue.textContent = result.selectedText || 'テキストなし';
    ui.geometrySizeValue.textContent = rect ? `${rect.width} × ${rect.height}` : '—';
    ui.geometryPositionValue.textContent = rect ? `${rect.left}, ${rect.top}` : '—';
    ui.frameTypeValue.textContent = frameBadgeText(result.frame);
    ui.frameUrlValue.textContent = result.frame?.url || '—';
    ui.frameDepthValue.textContent = String(result.frame?.depth ?? 0);
    ui.shadowDepthValue.textContent = String(result.shadow?.depth || 0);
    ui.shadowHostsValue.textContent = result.shadow?.inside
      ? result.shadow.hosts.map(host => host.label).join(' → ')
      : 'Document tree';
    const frameRelative = Boolean(result.locators?.context?.frameRelative);
    setLocatorView(ui.cssValue, ui.cssBadge, result.locators?.css, frameRelative);
    setLocatorView(ui.xpathValue, ui.xpathBadge, result.locators?.xpath, frameRelative);
    setLocatorView(ui.jsPathValue, ui.jsPathBadge, result.locators?.jsPath, frameRelative);
    ui.jsonPreview.textContent = JSON.stringify(result, null, 2);
    renderStylesView(result);
    renderEditView(result);
    renderAccessibilityView(result);
  }

  function setActiveTab(tabName) {
    if (tabName === 'compare' && !ui.pins.length) tabName = 'overview';
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
      result: event.result,
      reason: event.reason || '選択'
    });
    if (ui.history.length > MAX_HISTORY_ENTRIES) ui.history.shift();
    ui.historyIndex = ui.history.length - 1;
  }

  function navigateHistoryToIndex(targetIndex) {
    if (ui.pendingHistoryIndex !== null) return;
    const entry = ui.history[targetIndex];
    if (!entry) return;
    if (targetIndex === ui.historyIndex) return;
    ui.pendingHistoryIndex = targetIndex;
    renderUI();
    sendTopCommand('RESTORE_SELECTION', {
      targetFrameId: entry.frameId,
      selectionId: entry.selectionId
    });
  }

  function navigateHistory(delta) {
    navigateHistoryToIndex(ui.historyIndex + delta);
  }

  function toggleCurrentPin() {
    if (!ui.result || !ui.currentSelectionId || !Number.isInteger(ui.selectedFrameId)) return;
    const existingIndex = ui.pins.findIndex(pin =>
      pin.selectionId === ui.currentSelectionId && pin.frameId === ui.selectedFrameId
    );
    if (existingIndex >= 0) {
      const [removed] = ui.pins.splice(existingIndex, 1);
      sendTopCommand('UNPIN_SELECTION', {
        targetFrameId: removed.frameId,
        selectionId: removed.selectionId
      });
      setUIStatus('ピン留めを解除しました。', 'success');
      renderUI();
      return;
    }
    if (ui.pins.length >= MAX_PINNED_ENTRIES) {
      setUIStatus(`ピン留めは最大${MAX_PINNED_ENTRIES}件です。`, 'error');
      return;
    }
    const pin = {
      pinId: createToken(),
      selectionId: ui.currentSelectionId,
      frameId: ui.selectedFrameId,
      result: ui.result
    };
    ui.pins.push(pin);
    sendTopCommand('PIN_SELECTION', {
      targetFrameId: pin.frameId,
      selectionId: pin.selectionId
    });
    setUIStatus(`比較へピン留めしました（${ui.pins.length}/${MAX_PINNED_ENTRIES}）。`, 'success');
    renderUI();
  }

  function removePin(pinId) {
    const index = ui.pins.findIndex(pin => pin.pinId === pinId);
    if (index < 0) return;
    const [removed] = ui.pins.splice(index, 1);
    sendTopCommand('UNPIN_SELECTION', {
      targetFrameId: removed.frameId,
      selectionId: removed.selectionId
    });
    setUIStatus('ピン留めを解除しました。', 'success');
    renderUI();
  }

  function clearPins() {
    for (const pin of ui.pins) {
      sendTopCommand('UNPIN_SELECTION', {
        targetFrameId: pin.frameId,
        selectionId: pin.selectionId
      });
    }
    ui.pins = [];
    setUIStatus('すべてのピン留めを解除しました。', 'success');
    renderUI();
  }

  function restorePinnedSelection(pinId) {
    const pin = ui.pins.find(item => item.pinId === pinId);
    if (!pin) return;
    setUIStatus('ピン留めした要素へ移動しています。');
    sendTopCommand('RESTORE_SELECTION', {
      targetFrameId: pin.frameId,
      selectionId: pin.selectionId
    });
  }

  async function copyPinnedLocator(pinId, kind) {
    const pin = ui.pins.find(item => item.pinId === pinId);
    const value = pin?.result?.locators?.[kind]?.value;
    if (!value) return;
    try {
      await copyText(value);
      setUIStatus(`${kind === 'jsPath' ? 'JS Path' : kind.toUpperCase()}をコピーしました。`, 'success');
    } catch (error) {
      setUIStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function setDensity(density) {
    ui.density = density === 'comfortable' ? 'comfortable' : 'compact';
    if (!ui.panel) return;
    ui.panel.dataset.density = ui.density;
    for (const button of ui.densityButtons) {
      const active = button.dataset.densityOption === ui.density;
      button.dataset.active = active ? 'true' : 'false';
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function beginPicking() {
    clearUICountdown();
    ui.result = null;
    ui.selectedFrameId = null;
    ui.currentSelectionId = null;
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

  function applyEditFromUI() {
    if (!ui.result || !Number.isInteger(ui.selectedFrameId)) {
      setUIStatus('編集する要素を固定してください。', 'error');
      return;
    }
    const property = ui.editPropertySelect?.value;
    const value = ui.editValueInput?.value?.trim();
    if (!value) {
      setUIStatus('CSS値を入力してください。', 'error');
      ui.editValueInput?.focus();
      return;
    }
    sendTopCommand('APPLY_EDIT', { property, value });
  }

  async function copyTemporaryEditCss() {
    const cssText = ui.result?.temporaryEdits?.allCssText || ui.result?.temporaryEdits?.cssText;
    if (!cssText) {
      setUIStatus('コピーできる一時編集CSSがありません。', 'error');
      return;
    }
    try {
      await copyText(cssText);
      setUIStatus('一時編集CSSをコピーしました。', 'success');
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
    const filename = `prismora-${tag}-${stamp}.json`;
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
      renderHeaderFrameBadge({ ...event.frame, frameId: event.frameId });
      setUIStatus(ui.countdownTimer !== null
        ? 'カウント終了時にこの要素を固定します。'
        : 'クリックするとこの要素を固定します。');
      return;
    }

    if (event.kind === 'selected' && event.result) {
      clearUICountdown();
      if (event.historyMode === 'refresh') {
        if (ui.historyIndex >= 0 && ui.history[ui.historyIndex]) {
          ui.history[ui.historyIndex].result = event.result;
        }
      } else if (event.historyMode === 'restore' && ui.pendingHistoryIndex !== null) {
        ui.historyIndex = ui.pendingHistoryIndex;
      } else {
        pushSelectionHistory(event);
        if (ui.editValueInput) ui.editValueInput.value = '';
      }
      ui.pendingHistoryIndex = null;
      ui.result = event.result;
      ui.selectedFrameId = event.frameId;
      ui.currentSelectionId = event.selectionId || null;
      setUIMode('fixed');
      setUIStatus(event.statusMessage || `${event.reason || '選択'}で対象を固定しました。`, 'success');
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

  function clampPanelWidth(width, maximumWidth = window.innerWidth - 16) {
    const available = Math.max(240, Math.min(window.innerWidth - 16, maximumWidth));
    const minimum = Math.min(MIN_PANEL_WIDTH, available);
    return Math.min(available, Math.max(minimum, width));
  }

  function clampPanelHeight(height, top) {
    const available = Math.max(220, window.innerHeight - Math.max(8, top) - 8);
    const minimum = Math.min(MIN_PANEL_HEIGHT, available);
    return Math.min(available, Math.max(minimum, height));
  }

  function beginPanelResize(event) {
    if (event.button !== 0 || !ui.panel) return;
    const handle = event.currentTarget;
    const direction = handle.dataset.resizeDirection || handle.dataset.resizeSide;
    const rect = ui.panel.getBoundingClientRect();
    ui.resize = {
      pointerId: event.pointerId,
      direction,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
    ui.panel.style.right = 'auto';
    ui.panel.style.left = `${rect.left}px`;
    ui.panel.style.width = `${rect.width}px`;
    ui.panel.style.top = `${rect.top}px`;
    if (direction.includes('bottom')) {
      ui.panel.style.height = `${rect.height}px`;
      ui.panel.dataset.explicitHeight = 'true';
    }
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function resizePanel(event) {
    if (!ui.resize || event.pointerId !== ui.resize.pointerId) return;
    const direction = ui.resize.direction;
    let width = ui.resize.width;
    let left = ui.resize.left;
    let height = ui.resize.height;
    if (direction.includes('left')) {
      width = clampPanelWidth(ui.resize.right - event.clientX, ui.resize.right - 8);
      left = ui.resize.right - width;
    } else if (direction.includes('right')) {
      width = clampPanelWidth(event.clientX - ui.resize.left, window.innerWidth - ui.resize.left - 8);
    }
    left = Math.max(8, left);
    if (direction.includes('bottom')) {
      height = clampPanelHeight(event.clientY - ui.resize.top, ui.resize.top);
    }
    ui.panel.style.left = `${left}px`;
    ui.panel.style.width = `${width}px`;
    if (direction.includes('bottom')) ui.panel.style.height = `${height}px`;
  }

  function endPanelResize(event) {
    if (!ui.resize || event.pointerId !== ui.resize.pointerId) return;
    try {
      ui.resize.handle?.releasePointerCapture(event.pointerId);
    } catch {}
    ui.resize = null;
  }

  function keepPanelInViewport() {
    if (!ui.panel) return;
    const rect = ui.panel.getBoundingClientRect();
    const width = clampPanelWidth(rect.width || DEFAULT_PANEL_WIDTH);
    if (Math.abs(width - rect.width) > 0.5) ui.panel.style.width = `${width}px`;
    const explicitHeight = ui.panel.dataset.explicitHeight === 'true';
    if (explicitHeight) {
      const height = clampPanelHeight(rect.height, rect.top);
      if (Math.abs(height - rect.height) > 0.5) ui.panel.style.height = `${height}px`;
    }
    if (ui.panel.style.left !== '') {
      const position = clampPanelPosition(rect.left, rect.top);
      ui.panel.style.left = `${position.left}px`;
      ui.panel.style.top = `${position.top}px`;
    }
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
        --ei-ink: #20262d;
        --ei-muted: #68727e;
        --ei-faint: #8b949e;
        --ei-line: rgba(32,38,45,.12);
        --ei-line-strong: rgba(32,38,45,.2);
        --ei-panel: rgba(247,248,250,.94);
        --ei-surface: rgba(255,255,255,.82);
        --ei-surface-muted: rgba(239,242,245,.86);
        --ei-control: rgba(255,255,255,.84);
        --ei-control-hover: rgba(236,239,243,.96);
        --ei-graphite: #222930;
        --ei-graphite-soft: #2b333c;
        --ei-success: #4f8a68;
        --ei-danger: #b65d58;
        --ei-spectrum: linear-gradient(90deg, #8f82dc 0%, #66a7e8 24%, #65c6b1 49%, #e5bf67 73%, #d87891 100%);
        position: fixed;
        display: flex;
        flex-direction: column;
        top: 14px;
        right: 14px;
        z-index: 2;
        width: 468px;
        min-width: min(360px, calc(100vw - 16px));
        min-height: min(440px, calc(100vh - 16px));
        max-width: calc(100vw - 16px);
        max-height: calc(100vh - 28px);
        overflow: hidden;
        pointer-events: auto;
        color: var(--ei-ink);
        border: 1px solid rgba(255,255,255,.72);
        border-radius: 20px;
        background: var(--ei-panel);
        backdrop-filter: blur(24px) saturate(118%);
        -webkit-backdrop-filter: blur(24px) saturate(118%);
        box-shadow: 0 24px 70px rgba(15,20,28,.28), 0 0 0 1px rgba(32,38,45,.08), 0 1px 0 rgba(255,255,255,.92) inset;
        font: 12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        font-optical-sizing: auto;
        animation: ei-panel-arrive 160ms cubic-bezier(.2,.8,.2,1) both;
        container: inspector / inline-size;
        isolation: isolate;
      }
      .panel::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        border-radius: inherit;
        background: linear-gradient(180deg, rgba(255,255,255,.76), transparent 18%);
      }
      .panel > * { position: relative; z-index: 1; }
      .titlebar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 54px;
        padding: 9px 10px 9px 14px;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .titlebar::after {
        content: '';
        position: absolute;
        left: 12px; right: 12px; bottom: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(32,38,45,.1) 12%, rgba(32,38,45,.1) 88%, transparent);
      }
      .titlebar:active { cursor: grabbing; }
      .brand-mark {
        flex: 0 0 auto;
        display: block;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        object-fit: contain;
        box-shadow: 0 5px 14px rgba(28,35,43,.14);
      }
      .brand-copy { min-width: 0; flex: 1; }
      .brand-title { display: block; font-size: 12.5px; font-weight: 690; letter-spacing: -.012em; }
      .brand-subtitle { display: block; margin-top: 1px; color: var(--ei-muted); font-size: 9.5px; letter-spacing: .012em; }
      .title-actions { display: flex; align-items: center; gap: 6px; }
      .mode-pill, .frame-pill, .locator-badge {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        border: 1px solid var(--ei-line);
        border-radius: 999px;
        padding: 2px 7px;
        background: rgba(255,255,255,.62);
        color: var(--ei-muted);
        font-size: 8.5px;
        font-weight: 650;
        letter-spacing: .065em;
        white-space: nowrap;
      }
      .mode-pill[data-mode="picking"] { color: #4f7099; border-color: rgba(79,112,153,.34); background: rgba(224,234,246,.72); }
      .mode-pill[data-mode="fixed"] { color: var(--ei-success); border-color: rgba(79,138,104,.3); background: rgba(226,240,232,.76); }
      .mode-pill[data-mode="countdown"] { color: #947039; border-color: rgba(148,112,57,.28); background: rgba(245,237,219,.78); }
      .frame-pill[hidden] { display: none; }
      button, input, select { font: inherit; }
      button {
        --ei-control-fill: rgba(255,255,255,.86);
        min-height: 31px;
        border: 1px solid var(--ei-line);
        border-radius: 8px;
        padding: 5px 9px;
        background: var(--ei-control-fill);
        color: var(--ei-ink);
        box-shadow: 0 1px 0 rgba(255,255,255,.8) inset;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 90ms ease;
      }
      button:hover:not(:disabled) { background: var(--ei-control-hover); border-color: var(--ei-line-strong); }
      button:active:not(:disabled) { transform: scale(.97); }
      button:focus-visible, input:focus-visible, select:focus-visible {
        outline: 0;
        border-color: transparent;
        background: linear-gradient(var(--ei-control-fill), var(--ei-control-fill)) padding-box, var(--ei-spectrum) border-box;
        box-shadow: 0 0 0 2px rgba(255,255,255,.86), 0 0 0 4px rgba(73,88,105,.16);
      }
      button:disabled { opacity: .34; cursor: default; }
      button.primary { --ei-control-fill: var(--ei-graphite); background: var(--ei-control-fill); border-color: #171d22; color: #f7f8fa; box-shadow: 0 1px 0 rgba(255,255,255,.1) inset; }
      button.primary:hover:not(:disabled) { background: #303943; border-color: #20272e; }
      button.primary[data-active="true"] { box-shadow: 0 0 0 2px rgba(32,38,45,.1), 0 1px 0 rgba(255,255,255,.12) inset; }
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
      button.close-button { border-radius: 8px; color: #59636e; }
      .density-control {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        min-height: 29px;
        border: 1px solid var(--ei-line);
        border-radius: 9px;
        padding: 2px;
        background: rgba(32,38,45,.045);
      }
      button.density-option {
        min-height: 23px;
        border: 0;
        border-radius: 6px;
        padding: 0 7px;
        background: transparent;
        color: #69737e;
        box-shadow: none;
        font-size: 7.5px;
        font-weight: 700;
        letter-spacing: .045em;
      }
      button.density-option[data-active="false"]:hover:not(:disabled) { background: rgba(255,255,255,.7); border-color: transparent; }
      button.density-option[data-active="true"] {
        background: var(--ei-graphite);
        color: #f7f8fa;
        box-shadow: 0 1px 0 rgba(255,255,255,.12) inset;
      }
      button.density-option[data-active="true"]:hover:not(:disabled) { background: #303943; color: #f7f8fa; }
      button.pin-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 72px; }
      button.pin-button[data-active="true"] { color: #4b6177; border-color: rgba(75,97,119,.34); background: rgba(223,230,237,.9); }
      .pin-count { display: inline-grid; place-items: center; min-width: 16px; height: 16px; border-radius: 999px; background: rgba(32,38,45,.08); color: #4b5560; font-size: 8px; }
      .workspace {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        max-height: calc(100vh - 80px);
        overflow: hidden;
        padding: 10px 12px 0;
      }
      .panel[data-explicit-height="true"] .workspace { max-height: none; }
      .fixed-stack {
        flex: 0 0 auto;
        border: 1px solid var(--ei-line);
        border-radius: 14px;
        overflow: hidden;
        background: rgba(255,255,255,.56);
        box-shadow: 0 1px 0 rgba(255,255,255,.82) inset;
      }
      .command-surface { padding: 10px 11px 11px; }
      .target-row { display: flex; align-items: center; gap: 10px; }
      .eyebrow { color: var(--ei-faint); font-size: 9px; font-weight: 650; letter-spacing: .09em; text-transform: uppercase; }
      .target-name { display: block; margin-top: 2px; overflow: hidden; color: var(--ei-ink); font: 600 13px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace; text-overflow: ellipsis; white-space: nowrap; }
      .status { min-height: 20px; margin-top: 6px; color: var(--ei-muted); font-size: 10.5px; }
      .status[data-kind="success"] { color: var(--ei-success); }
      .status[data-kind="error"] { color: var(--ei-danger); }
      .command-row { display: grid; grid-template-columns: minmax(0,1fr) 142px auto; gap: 7px; margin-top: 8px; }
      .delay-control { display: grid; grid-template-columns: 43px 1fr; gap: 5px; }
      .history-surface {
        padding: 9px 11px 10px;
        border-top: 1px solid var(--ei-line);
        background: rgba(32,38,45,.025);
      }
      .history-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
      .history-label { color: var(--ei-faint); font-size: 8.5px; font-weight: 700; letter-spacing: .085em; text-transform: uppercase; }
      .history-position { color: #5f6974; font: 650 9px/1 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .history-bar { display: grid; grid-template-columns: 76px minmax(0,1fr) 76px; align-items: center; gap: 6px; }
      .history-select { min-width: 0; min-height: 35px; font-size: 9.5px; text-overflow: ellipsis; }
      button.history-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 0;
        min-height: 35px;
        padding-inline: 8px;
        font-size: 9.5px;
        font-weight: 650;
      }
      button.history-button svg { display: block; width: 16px; height: 16px; stroke: currentColor; }
      button.history-button:disabled { opacity: .48; border-color: rgba(32,38,45,.1); }
      input, select {
        --ei-control-fill: rgba(255,255,255,.9);
        width: 100%;
        min-height: 31px;
        border: 1px solid var(--ei-line);
        border-radius: 8px;
        padding: 5px 8px;
        background: var(--ei-control-fill);
        color: var(--ei-ink);
      }
      .hierarchy-surface {
        padding: 9px 10px 10px;
        border-top: 1px solid var(--ei-line);
        background: var(--ei-surface-muted);
      }
      .surface-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
      .surface-title { color: #5d6772; font-size: 9px; font-weight: 700; letter-spacing: .085em; text-transform: uppercase; }
      .metrics { display: flex; gap: 8px; color: var(--ei-faint); font-size: 8.5px; }
      .metrics b { color: #4e5964; font-weight: 650; }
      .nav-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
      .nav-grid button { min-width: 0; min-height: 29px; padding-inline: 4px; font-size: 9.5px; }
      .child-select { margin-top: 6px; }
      .tabs {
        display: flex;
        flex: 0 0 auto;
        gap: 20px;
        margin-top: 10px;
        padding: 0 4px;
        border-bottom: 1px solid var(--ei-line);
      }
      .tabs button {
        position: relative;
        min-height: 34px;
        border: 0;
        border-radius: 0;
        padding: 0 1px;
        background: transparent;
        color: #717b86;
        box-shadow: none;
        font-size: 10.5px;
      }
      .tabs button::after {
        content: '';
        position: absolute;
        left: 0; right: 0; bottom: -1px;
        height: 2px;
        border-radius: 2px 2px 0 0;
        background: var(--ei-spectrum);
        transform: scaleX(0);
        transition: transform 140ms ease;
      }
      .tabs button[data-active="true"] { color: var(--ei-ink); }
      .tabs button[data-active="true"]::after { transform: scaleX(1); }
      .view-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 1px 8px; }
      .tab-panel { margin: 0; }
      .tab-panel[hidden] { display: none; }
      .section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
      .section-title { margin: 0; color: #68727d; font-size: 9px; font-weight: 700; letter-spacing: .085em; text-transform: uppercase; }
      .overview-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .overview-section { min-width: 0; border: 1px solid var(--ei-line); border-radius: 11px; padding: 10px; background: var(--ei-surface); box-shadow: 0 1px 0 rgba(255,255,255,.72) inset; }
      .overview-section-title { margin: 0 0 8px; color: #69737e; font-size: 8.5px; font-weight: 700; letter-spacing: .075em; text-transform: uppercase; }
      .info-grid { display: grid; grid-template-columns: 1fr; gap: 0; }
      .info-cell { min-width: 0; border-bottom: 1px solid rgba(32,38,45,.08); padding: 6px 0 7px; }
      .info-cell:last-child { border-bottom: 0; }
      .info-cell.wide { grid-column: 1 / -1; }
      .info-label { display: block; color: var(--ei-faint); font-size: 8.5px; letter-spacing: .055em; text-transform: uppercase; }
      .info-value { display: block; margin-top: 3px; overflow: hidden; color: #29313a; text-overflow: ellipsis; white-space: nowrap; font: 10.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .info-value.wrap { max-height: 68px; overflow: auto; white-space: normal; overflow-wrap: anywhere; }
      .geometry-visual { display: grid; place-items: center; min-height: 116px; border: 1px solid #171d22; border-radius: 10px; background: var(--ei-graphite); }
      .geometry-middle { display: grid; place-items: center; width: 78%; min-height: 82px; border: 1px dashed rgba(224,230,236,.28); border-radius: 9px; }
      .geometry-core { display: grid; place-items: center; min-width: 74px; min-height: 48px; border: 1px solid transparent; border-radius: 8px; background: linear-gradient(var(--ei-graphite-soft), var(--ei-graphite-soft)) padding-box, var(--ei-spectrum) border-box; color: #f2f5f7; font: 650 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .geometry-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
      .styles-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .styles-section {
        min-width: 0;
        border: 1px solid var(--ei-line);
        border-radius: 11px;
        padding: 10px;
        background: var(--ei-surface);
        box-shadow: 0 1px 0 rgba(255,255,255,.72) inset;
      }
      .styles-section-title { margin: 0 0 8px; color: #69737e; font-size: 8.5px; font-weight: 700; letter-spacing: .075em; text-transform: uppercase; }
      .box-model-diagram { display: grid; gap: 5px; border-radius: 10px; padding: 8px; background: rgba(32,38,45,.045); }
      .box-model-layer { display: grid; gap: 5px; border: 1px solid var(--ei-line); border-radius: 8px; padding: 7px; }
      .box-model-layer.margin { background: rgba(224,211,176,.28); }
      .box-model-layer.border { background: rgba(191,202,214,.3); }
      .box-model-layer.padding { background: rgba(195,220,211,.32); }
      .box-model-layer.content { min-height: 54px; place-items: center; border-color: transparent; background: linear-gradient(var(--ei-graphite-soft), var(--ei-graphite-soft)) padding-box, var(--ei-spectrum) border-box; color: #f3f6f8; }
      .box-model-layer-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #59636e; font-size: 8px; text-transform: uppercase; letter-spacing: .055em; }
      .box-model-layer-head code { overflow: hidden; color: #39424c; text-overflow: ellipsis; white-space: nowrap; font: 8.5px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace; text-transform: none; letter-spacing: 0; }
      .box-model-layer.content .box-model-layer-head { width: 100%; color: #bfc7cf; }
      .box-model-layer.content .box-model-layer-head code { color: #f3f6f8; font-size: 11px; font-weight: 650; }
      .box-model-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
      .style-property-grid { display: grid; grid-template-columns: 1fr; gap: 0; }
      .style-property { display: grid; grid-template-columns: minmax(118px,.8fr) minmax(0,1.2fr); gap: 8px; align-items: baseline; min-width: 0; border-bottom: 1px solid rgba(32,38,45,.08); padding: 6px 0; }
      .style-property:last-child { border-bottom: 0; }
      .style-property-name { overflow: hidden; color: var(--ei-faint); text-overflow: ellipsis; white-space: nowrap; font-size: 8.5px; }
      .style-property-value { overflow: hidden; color: #29313a; text-align: right; text-overflow: ellipsis; white-space: nowrap; font: 9.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .edit-grid, .audit-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .edit-section, .audit-section {
        min-width: 0;
        border: 1px solid var(--ei-line);
        border-radius: 11px;
        padding: 10px;
        background: var(--ei-surface);
        box-shadow: 0 1px 0 rgba(255,255,255,.72) inset;
      }
      .edit-section-title, .audit-section-title { margin: 0 0 8px; color: #69737e; font-size: 8.5px; font-weight: 700; letter-spacing: .075em; text-transform: uppercase; }
      .edit-form { display: grid; grid-template-columns: minmax(120px,.82fr) minmax(0,1.18fr) auto; gap: 7px; align-items: end; }
      .edit-field { min-width: 0; }
      .edit-field label { display: block; margin-bottom: 4px; color: var(--ei-faint); font-size: 8px; letter-spacing: .055em; text-transform: uppercase; }
      .edit-current { margin-top: 8px; border: 1px solid var(--ei-line); border-radius: 8px; padding: 7px 8px; background: rgba(32,38,45,.04); }
      .edit-current span { display: block; color: var(--ei-faint); font-size: 8px; text-transform: uppercase; letter-spacing: .055em; }
      .edit-current code { display: block; margin-top: 3px; overflow: hidden; color: #29313a; text-overflow: ellipsis; white-space: nowrap; font: 10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .edit-toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .edit-toolbar button { min-height: 28px; padding: 4px 8px; font-size: 9px; }
      .edit-note { margin-top: 8px; color: var(--ei-muted); font-size: 8.5px; }
      .edit-summary { color: var(--ei-muted); font-size: 8.5px; }
      .edit-list { display: grid; gap: 6px; }
      .edit-empty, .audit-empty { border: 1px dashed var(--ei-line-strong); border-radius: 9px; padding: 14px 10px; color: var(--ei-muted); text-align: center; font-size: 9px; }
      .edit-row { display: grid; grid-template-columns: minmax(110px,.8fr) minmax(0,1.2fr); gap: 8px; align-items: center; border-bottom: 1px solid rgba(32,38,45,.08); padding: 6px 0; }
      .edit-row:last-child { border-bottom: 0; }
      .edit-property { overflow: hidden; color: #39424c; text-overflow: ellipsis; white-space: nowrap; font: 9.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .edit-values { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 5px; align-items: center; min-width: 0; }
      .edit-values code { overflow: hidden; color: var(--ei-muted); text-overflow: ellipsis; white-space: nowrap; font: 9px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .edit-values code:last-child { color: #29313a; text-align: right; }
      .edit-values span { color: var(--ei-faint); }
      .audit-semantics { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
      .audit-card { min-width: 0; border: 1px solid var(--ei-line); border-radius: 9px; padding: 8px; background: rgba(255,255,255,.58); }
      .audit-card.wide { grid-column: 1 / -1; }
      .audit-card span { display: block; color: var(--ei-faint); font-size: 8px; text-transform: uppercase; letter-spacing: .055em; }
      .audit-card code { display: block; margin-top: 3px; overflow: hidden; color: #29313a; text-overflow: ellipsis; white-space: nowrap; font: 9.5px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .audit-card code.wrap { max-height: 62px; overflow: auto; white-space: normal; overflow-wrap: anywhere; }
      .audit-subvalue { margin-top: 2px !important; color: var(--ei-muted) !important; font-size: 8px !important; }
      .audit-list { display: grid; gap: 0; }
      .audit-row { display: grid; grid-template-columns: minmax(110px,.8fr) minmax(0,1.2fr); gap: 8px; align-items: baseline; border-bottom: 1px solid rgba(32,38,45,.08); padding: 6px 0; }
      .audit-row:last-child { border-bottom: 0; }
      .audit-label { overflow: hidden; color: var(--ei-faint); text-overflow: ellipsis; white-space: nowrap; font-size: 8.5px; }
      .audit-value { overflow: hidden; color: #29313a; text-align: right; text-overflow: ellipsis; white-space: nowrap; font: 9.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .event-summary { display: block; margin-bottom: 8px; color: var(--ei-muted); font-size: 8.5px; }
      .event-list { display: grid; gap: 7px; }
      .event-item { min-width: 0; border: 1px solid var(--ei-line); border-radius: 9px; padding: 8px; background: rgba(32,38,45,.035); }
      .event-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .event-head strong { color: #39424c; font-size: 9.5px; }
      .event-head span { color: var(--ei-faint); font-size: 8px; text-transform: uppercase; letter-spacing: .055em; }
      .event-preview { display: block; max-height: 72px; margin-top: 6px; overflow: auto; color: #313943; white-space: pre-wrap; overflow-wrap: anywhere; font: 9px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .event-limitations { margin: 8px 0 0; padding-left: 16px; color: var(--ei-muted); font-size: 8.5px; }
      .locator-card { padding: 9px 0 10px; border-bottom: 1px solid rgba(32,38,45,.08); }
      .locator-card:first-child { padding-top: 0; }
      .locator-card:last-child { border-bottom: 0; }
      .locator-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .locator-name { color: #39424c; font-size: 10px; font-weight: 650; }
      .locator-badge[data-unique="true"] { color: var(--ei-success); border-color: rgba(79,138,104,.28); background: rgba(226,240,232,.7); }
      .locator-body { display: grid; grid-template-columns: minmax(0,1fr) 54px; gap: 7px; align-items: start; }
      .code-box {
        min-height: 44px;
        max-height: 108px;
        margin: 0;
        overflow: auto;
        border: 1px solid #171d22;
        border-radius: 8px;
        padding: 8px;
        background: var(--ei-graphite);
        color: #e9edf1;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;
      }
      .json-toolbar { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 8px; }
      .json-preview { max-height: 380px; }
      .compare-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      .compare-note { color: var(--ei-muted); font-size: 9px; }
      .compare-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .compare-empty { border: 1px dashed var(--ei-line-strong); border-radius: 11px; padding: 28px 14px; color: var(--ei-muted); text-align: center; }
      .compare-card { min-width: 0; border: 1px solid var(--ei-line); border-radius: 12px; padding: 10px; background: var(--ei-surface); box-shadow: 0 1px 0 rgba(255,255,255,.72) inset; }
      .compare-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
      .compare-title-wrap { min-width: 0; }
      .compare-title { display: block; overflow: hidden; color: var(--ei-ink); text-overflow: ellipsis; white-space: nowrap; font: 650 11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .compare-frame { display: block; margin-top: 2px; color: var(--ei-muted); font-size: 8px; }
      .compare-actions, .compare-locators { display: flex; gap: 5px; }
      .compare-actions button, .compare-locators button { min-height: 25px; padding: 3px 7px; font-size: 8.5px; }
      .compare-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 9px; }
      .compare-field { min-width: 0; border-top: 1px solid rgba(32,38,45,.08); padding-top: 6px; }
      .compare-field.wide { grid-column: 1 / -1; }
      .compare-label { display: block; color: var(--ei-faint); font-size: 8px; text-transform: uppercase; letter-spacing: .055em; }
      .compare-value { display: block; margin-top: 3px; overflow: hidden; color: #313943; text-overflow: ellipsis; white-space: nowrap; font: 9.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .compare-value.wrap { max-height: 48px; overflow: auto; white-space: normal; overflow-wrap: anywhere; }
      .compare-locators { margin-top: 9px; }
      .footer {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0 -12px;
        padding: 8px 12px 9px;
        border-top: 1px solid rgba(32,38,45,.08);
        color: var(--ei-muted);
        font-size: 8.5px;
      }
      .local-state { display: inline-flex; align-items: center; gap: 6px; }
      .local-state::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--ei-success); box-shadow: 0 0 0 2px rgba(79,138,104,.12); }
      .keycap { border: 1px solid var(--ei-line); border-radius: 5px; padding: 1px 5px; background: rgba(255,255,255,.58); color: #69737e; font-size: 8px; }
      .resize-handle { position: absolute; z-index: 3; touch-action: none; }
      .resize-handle.edge-left, .resize-handle.edge-right { top: 56px; bottom: 12px; width: 8px; cursor: ew-resize; }
      .resize-handle.edge-left { left: -1px; }
      .resize-handle.edge-right { right: -1px; }
      .resize-handle.edge-bottom { left: 12px; right: 12px; bottom: -1px; height: 8px; cursor: ns-resize; }
      .resize-handle.edge-left::after, .resize-handle.edge-right::after, .resize-handle.edge-bottom::after {
        content: '';
        position: absolute;
        border-radius: 2px;
        background: rgba(75,88,102,.28);
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .resize-handle.edge-left::after, .resize-handle.edge-right::after { top: 42%; bottom: 42%; width: 2px; }
      .resize-handle.edge-left::after { left: 1px; }
      .resize-handle.edge-right::after { right: 1px; }
      .resize-handle.edge-bottom::after { left: 43%; right: 43%; bottom: 1px; height: 2px; }
      .resize-handle.corner { bottom: 0; z-index: 5; width: 16px; height: 16px; }
      .resize-handle.corner-left { left: 0; cursor: nesw-resize; }
      .resize-handle.corner-right { right: 0; cursor: nwse-resize; }
      .resize-handle.corner-right::after {
        content: '';
        position: absolute;
        right: 3px;
        bottom: 3px;
        width: 9px;
        height: 9px;
        opacity: .42;
        background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(75,88,102,.48) 3px 4px);
        transition: opacity 120ms ease;
      }
      .resize-handle:hover::after, .resize-handle:active::after { opacity: .9; }
      .panel[data-density="comfortable"] .titlebar { min-height: 64px; padding-block: 14px; }
      .panel[data-density="comfortable"] .workspace { padding: 14px 18px 0; }
      .panel[data-density="comfortable"] .command-surface { padding: 16px; }
      .panel[data-density="comfortable"] .hierarchy-surface { padding: 15px 16px 16px; }
      .panel[data-density="comfortable"] button, .panel[data-density="comfortable"] input, .panel[data-density="comfortable"] select { min-height: 38px; }
      .panel[data-density="comfortable"] button.icon-button { width: 38px; min-width: 38px; height: 38px; min-height: 38px; }
      .panel[data-density="comfortable"] .density-control { min-height: 31px; }
      .panel[data-density="comfortable"] button.density-option { min-height: 25px; }
      .panel[data-density="comfortable"] .history-surface { padding: 13px 16px 14px; }
      .panel[data-density="comfortable"] .history-head { margin-bottom: 8px; }
      .panel[data-density="comfortable"] .history-bar { grid-template-columns: 84px minmax(0,1fr) 84px; gap: 8px; }
      .panel[data-density="comfortable"] button.history-button, .panel[data-density="comfortable"] .history-select { min-height: 40px; }
      .panel[data-density="comfortable"] .command-row { gap: 10px; margin-top: 12px; }
      .panel[data-density="comfortable"] .nav-grid { gap: 8px; }
      .panel[data-density="comfortable"] .nav-grid button { min-height: 37px; }
      .panel[data-density="comfortable"] .tabs { gap: 24px; margin-top: 14px; }
      .panel[data-density="comfortable"] .tabs button { min-height: 42px; }
      .panel[data-density="comfortable"] .view-scroll { padding-top: 16px; }
      .panel[data-density="comfortable"] .overview-grid, .panel[data-density="comfortable"] .styles-grid, .panel[data-density="comfortable"] .audit-grid { gap: 12px; }
      .panel[data-density="comfortable"] .overview-section, .panel[data-density="comfortable"] .compare-card { padding: 16px; }
      .panel[data-density="comfortable"] .styles-section { padding: 16px; }
      .panel[data-density="comfortable"] .edit-section, .panel[data-density="comfortable"] .audit-section { padding: 16px; }
      @container inspector (min-width: 440px) {
        .overview-grid { grid-template-columns: 1.12fr .9fr .98fr; }
      }
      @container inspector (min-width: 620px) {
        .compare-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        .locator-body { grid-template-columns: minmax(0,1fr) 62px; }
        .styles-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        .box-model-section { grid-column: 1 / -1; }
        .audit-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        .event-section { grid-column: 1 / -1; }
      }
      @container inspector (min-width: 920px) {
        .compare-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
      }
      @container inspector (max-width: 430px) {
        .frame-pill { display: none; }
        .brand-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .brand-subtitle { display: none; }
        .density-control { gap: 1px; }
        button.density-option { padding-inline: 5px; font-size: 7px; }
        .command-row { grid-template-columns: minmax(0,1fr) 135px; }
        .pin-button { grid-column: 1 / -1; }
        .history-bar { grid-template-columns: 68px minmax(0,1fr) 68px; }
        .nav-grid { grid-template-columns: repeat(3, 1fr); }
        .tabs { gap: 14px; }
        .edit-form { grid-template-columns: 1fr; }
      }
      @media (max-width: 380px) {
        .panel { width: calc(100vw - 16px); top: 8px; right: 8px; max-width: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel { animation: none; }
        button { transition: none; }
        .tabs button::after { transition: none; }
        .highlight-edge { animation-duration: 4s !important; }
      }
      @media (prefers-reduced-transparency: reduce) {
        .panel { background: #f4f6f8; backdrop-filter: none; -webkit-backdrop-filter: none; }
      }
      @media (prefers-contrast: more) {
        .panel { background: #fff; border-color: rgba(20,25,31,.56); }
        .fixed-stack, .overview-section, .compare-card { border-color: rgba(20,25,31,.34); }
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
    panel.setAttribute('aria-label', 'Prismora — Web Element Inspector');
    panel.innerHTML = `
      <header class="titlebar">
        <img class="brand-mark" src="${chrome.runtime.getURL('assets/icons/main-icon-48.png')}" alt="" aria-hidden="true">
        <div class="brand-copy">
          <strong class="brand-title">Prismora</strong>
          <span class="brand-subtitle">Web Element Inspector · v${EXTENSION_VERSION}</span>
        </div>
        <div class="title-actions">
          <div class="density-control" role="group" aria-label="表示密度">
            <button class="density-option" type="button" data-density-option="compact" data-active="true" aria-pressed="true">COMPACT</button>
            <button class="density-option" type="button" data-density-option="comfortable" data-active="false" aria-pressed="false">COMFORTABLE</button>
          </div>
          <span class="frame-pill" hidden></span>
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
              <button class="pin-button" type="button" data-action="pin" aria-pressed="false">Pin <span class="pin-count">0</span></button>
            </div>
          </section>

          <section class="history-surface" aria-label="選択履歴">
            <div class="history-head">
              <span class="history-label">Selection history</span>
              <span class="history-position" aria-live="polite">0 / 0</span>
            </div>
            <div class="history-bar">
              <button class="history-button" type="button" data-action="history-back" aria-label="前の選択へ戻る" title="前の選択へ戻る">
                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.75 3.5L5.25 8l4.5 4.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>戻る</span>
              </button>
              <select class="history-select" aria-label="選択履歴"><option value="">履歴なし</option></select>
              <button class="history-button" type="button" data-action="history-forward" aria-label="次の選択へ進む" title="次の選択へ進む">
                <span>進む</span>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.25 3.5L10.75 8l-4.5 4.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
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
          <button type="button" role="tab" data-tab="styles" data-active="false">Styles</button>
          <button type="button" role="tab" data-tab="edit" data-active="false">Edit</button>
          <button type="button" role="tab" data-tab="a11y" data-active="false">A11y</button>
          <button type="button" role="tab" data-tab="locators" data-active="false">Locators</button>
          <button type="button" role="tab" data-tab="compare" data-active="false" hidden>Compare</button>
          <button type="button" role="tab" data-tab="json" data-active="false">JSON</button>
        </nav>

        <div class="view-scroll">
          <div class="tab-panel" data-panel="overview">
            <div class="overview-grid">
              <section class="overview-section">
                <h2 class="overview-section-title">Element details</h2>
                <div class="info-grid">
                  <div class="info-cell"><span class="info-label">Tag</span><code class="info-value" data-value="tag">未固定</code></div>
                  <div class="info-cell"><span class="info-label">Identity</span><code class="info-value wrap" data-value="identity">—</code></div>
                  <div class="info-cell"><span class="info-label">Text</span><code class="info-value wrap" data-value="text">ページ上の要素へポインターを移動してください。</code></div>
                </div>
              </section>
              <section class="overview-section">
                <h2 class="overview-section-title">Geometry</h2>
                <div class="geometry-visual"><div class="geometry-middle"><div class="geometry-core" data-value="geometry-size">—</div></div></div>
                <div class="geometry-meta">
                  <div class="info-cell"><span class="info-label">Rect</span><code class="info-value" data-value="rect">—</code></div>
                  <div class="info-cell"><span class="info-label">Position</span><code class="info-value" data-value="geometry-position">—</code></div>
                </div>
              </section>
              <section class="overview-section">
                <h2 class="overview-section-title">Frame details</h2>
                <div class="info-grid">
                  <div class="info-cell"><span class="info-label">Type</span><code class="info-value" data-value="frame-type">TOP FRAME</code></div>
                  <div class="info-cell"><span class="info-label">Document</span><code class="info-value wrap" data-value="frame-url">—</code></div>
                  <div class="info-cell"><span class="info-label">Depth</span><code class="info-value" data-value="frame-depth">0</code></div>
                  <div class="info-cell"><span class="info-label">Shadow depth</span><code class="info-value" data-value="shadow-depth">0</code></div>
                  <div class="info-cell"><span class="info-label">Shadow hosts</span><code class="info-value wrap" data-value="shadow-hosts">Document tree</code></div>
                </div>
              </section>
            </div>
          </div>

          <div class="tab-panel" data-panel="styles" hidden>
            <div class="styles-grid">
              <section class="styles-section box-model-section">
                <h2 class="styles-section-title">Box model</h2>
                <div class="box-model-diagram">
                  <div class="box-model-layer margin">
                    <div class="box-model-layer-head"><span>Margin</span><code data-box-value="margin">—</code></div>
                    <div class="box-model-layer border">
                      <div class="box-model-layer-head"><span>Border</span><code data-box-value="border">—</code></div>
                      <div class="box-model-layer padding">
                        <div class="box-model-layer-head"><span>Padding</span><code data-box-value="padding">—</code></div>
                        <div class="box-model-layer content">
                          <div class="box-model-layer-head"><span>Content</span><code data-box-value="content">—</code></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="box-model-meta">
                  <div class="info-cell"><span class="info-label">Border box</span><code class="info-value" data-box-value="border-box">—</code></div>
                  <div class="info-cell"><span class="info-label">Scroll size</span><code class="info-value" data-box-value="scroll">—</code></div>
                </div>
              </section>
              <section class="styles-section">
                <h2 class="styles-section-title">Layout</h2>
                <div class="style-property-grid" data-style-group="layout"></div>
              </section>
              <section class="styles-section">
                <h2 class="styles-section-title">Flex / Grid</h2>
                <div class="style-property-grid" data-style-group="flex-grid"></div>
              </section>
              <section class="styles-section">
                <h2 class="styles-section-title">Typography</h2>
                <div class="style-property-grid" data-style-group="typography"></div>
              </section>
            </div>
          </div>

          <div class="tab-panel" data-panel="edit" hidden>
            <div class="edit-grid">
              <section class="edit-section">
                <h2 class="edit-section-title">Temporary CSS editor</h2>
                <div class="edit-form">
                  <div class="edit-field">
                    <label for="ei-edit-property">Property</label>
                    <select id="ei-edit-property" data-edit="property">
                      ${EDITABLE_PROPERTIES.map(([property, label]) => `<option value="${property}">${label}</option>`).join('')}
                    </select>
                  </div>
                  <div class="edit-field">
                    <label for="ei-edit-value">Value</label>
                    <input id="ei-edit-value" type="text" data-edit="value" placeholder="例: 320px / flex / #20262d">
                  </div>
                  <button class="primary" type="button" data-action="apply-edit">適用</button>
                </div>
                <div class="edit-current">
                  <span>Current computed value</span>
                  <code data-edit="current-value">対象を固定してください</code>
                </div>
                <div class="edit-toolbar">
                  <button type="button" data-action="undo-edit">Undo</button>
                  <button type="button" data-action="reset-current-edits">対象をReset</button>
                  <button type="button" data-action="reset-all-edits">全Reset</button>
                  <button type="button" data-action="copy-edit-css">編集CSSをコピー</button>
                </div>
                <p class="edit-note">既存のstyle属性は変更しません。Inspector終了またはページ再読み込みで完全に破棄されます。</p>
              </section>
              <section class="edit-section">
                <div class="section-head">
                  <h2 class="edit-section-title" style="margin:0">Active edits</h2>
                  <span class="edit-summary">Temporary · removed on close or reload</span>
                </div>
                <div class="edit-list"></div>
              </section>
            </div>
          </div>

          <div class="tab-panel" data-panel="a11y" hidden>
            <div class="audit-grid">
              <section class="audit-section">
                <h2 class="audit-section-title">Semantics</h2>
                <div class="audit-semantics">
                  <div class="audit-card">
                    <span>Role</span>
                    <code data-a11y="role">none</code>
                    <code class="audit-subvalue" data-a11y="role-source">no role</code>
                  </div>
                  <div class="audit-card">
                    <span>Accessible name</span>
                    <code data-a11y="name">名前なし</code>
                    <code class="audit-subvalue" data-a11y="name-source">none</code>
                  </div>
                  <div class="audit-card wide">
                    <span>Description</span>
                    <code class="wrap" data-a11y="description">説明なし</code>
                  </div>
                  <div class="audit-card wide">
                    <span>Labels</span>
                    <code class="wrap" data-a11y="labels">ラベルなし</code>
                  </div>
                </div>
              </section>
              <section class="audit-section">
                <h2 class="audit-section-title">Focus</h2>
                <div class="audit-semantics">
                  <div class="audit-card wide"><span>Focusability</span><code data-a11y="focus">—</code></div>
                  <div class="audit-card"><span>Tab index</span><code data-a11y="tab-index">—</code></div>
                  <div class="audit-card"><span>Heading</span><code data-a11y="heading">—</code></div>
                </div>
              </section>
              <section class="audit-section">
                <h2 class="audit-section-title">States</h2>
                <div class="audit-list" data-a11y-list="states"></div>
              </section>
              <section class="audit-section">
                <h2 class="audit-section-title">ARIA attributes</h2>
                <div class="audit-list" data-a11y-list="aria"></div>
              </section>
              <section class="audit-section event-section">
                <h2 class="audit-section-title">Limited event information</h2>
                <span class="event-summary" data-event="summary">検出可能なイベントなし</span>
                <div class="event-list"></div>
                <ul class="event-limitations">
                  <li>onclickなどのHTML属性とDOM0プロパティのみ表示します。</li>
                  <li>addEventListener()、React、Vueなどの内部リスナーは取得しません。</li>
                </ul>
              </section>
            </div>
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

          <div class="tab-panel" data-panel="compare" hidden>
            <section>
              <div class="compare-toolbar">
                <span class="compare-note">最大4件を同時比較</span>
                <button type="button" data-action="clear-pins">すべて解除</button>
              </div>
              <div class="compare-grid"></div>
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
      <div class="resize-handle edge-left" data-resize-side="left" data-resize-direction="left" role="separator" aria-orientation="vertical" aria-label="パネル左端をリサイズ"></div>
      <div class="resize-handle edge-right" data-resize-side="right" data-resize-direction="right" role="separator" aria-orientation="vertical" aria-label="パネル右端をリサイズ"></div>
      <div class="resize-handle edge-bottom" data-resize-direction="bottom" role="separator" aria-orientation="horizontal" aria-label="パネル下端をリサイズ"></div>
      <div class="resize-handle corner corner-left" data-resize-direction="bottom-left" aria-label="パネル左下を斜めにリサイズ"></div>
      <div class="resize-handle corner corner-right" data-resize-direction="bottom-right" aria-label="パネル右下を斜めにリサイズ"></div>
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
    ui.densityButtons = Array.from(panel.querySelectorAll('[data-density-option]'));
    ui.backButton = panel.querySelector('[data-action="history-back"]');
    ui.historySelect = panel.querySelector('.history-select');
    ui.historyPosition = panel.querySelector('.history-position');
    ui.forwardButton = panel.querySelector('[data-action="history-forward"]');
    ui.pinButton = panel.querySelector('[data-action="pin"]');
    ui.pinCount = panel.querySelector('.pin-count');
    ui.tabButtons = Array.from(panel.querySelectorAll('[data-tab]'));
    ui.tabPanels = Array.from(panel.querySelectorAll('[data-panel]'));
    ui.compareTabButton = panel.querySelector('[data-tab="compare"]');
    ui.compareGrid = panel.querySelector('.compare-grid');
    ui.clearPinsButton = panel.querySelector('[data-action="clear-pins"]');
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
    ui.geometrySizeValue = panel.querySelector('[data-value="geometry-size"]');
    ui.geometryPositionValue = panel.querySelector('[data-value="geometry-position"]');
    ui.frameTypeValue = panel.querySelector('[data-value="frame-type"]');
    ui.frameUrlValue = panel.querySelector('[data-value="frame-url"]');
    ui.frameDepthValue = panel.querySelector('[data-value="frame-depth"]');
    ui.shadowDepthValue = panel.querySelector('[data-value="shadow-depth"]');
    ui.shadowHostsValue = panel.querySelector('[data-value="shadow-hosts"]');
    ui.boxMarginValue = panel.querySelector('[data-box-value="margin"]');
    ui.boxBorderValue = panel.querySelector('[data-box-value="border"]');
    ui.boxPaddingValue = panel.querySelector('[data-box-value="padding"]');
    ui.boxContentValue = panel.querySelector('[data-box-value="content"]');
    ui.boxBorderBoxValue = panel.querySelector('[data-box-value="border-box"]');
    ui.boxScrollValue = panel.querySelector('[data-box-value="scroll"]');
    ui.layoutStylesGrid = panel.querySelector('[data-style-group="layout"]');
    ui.flexGridStylesGrid = panel.querySelector('[data-style-group="flex-grid"]');
    ui.typographyStylesGrid = panel.querySelector('[data-style-group="typography"]');
    ui.editPropertySelect = panel.querySelector('[data-edit="property"]');
    ui.editValueInput = panel.querySelector('[data-edit="value"]');
    ui.editApplyButton = panel.querySelector('[data-action="apply-edit"]');
    ui.editUndoButton = panel.querySelector('[data-action="undo-edit"]');
    ui.editResetCurrentButton = panel.querySelector('[data-action="reset-current-edits"]');
    ui.editResetAllButton = panel.querySelector('[data-action="reset-all-edits"]');
    ui.editCopyCssButton = panel.querySelector('[data-action="copy-edit-css"]');
    ui.editCurrentValue = panel.querySelector('[data-edit="current-value"]');
    ui.editSummary = panel.querySelector('.edit-summary');
    ui.editList = panel.querySelector('.edit-list');
    ui.a11yRoleValue = panel.querySelector('[data-a11y="role"]');
    ui.a11yRoleSourceValue = panel.querySelector('[data-a11y="role-source"]');
    ui.a11yNameValue = panel.querySelector('[data-a11y="name"]');
    ui.a11yNameSourceValue = panel.querySelector('[data-a11y="name-source"]');
    ui.a11yDescriptionValue = panel.querySelector('[data-a11y="description"]');
    ui.a11yLabelsValue = panel.querySelector('[data-a11y="labels"]');
    ui.a11yFocusValue = panel.querySelector('[data-a11y="focus"]');
    ui.a11yTabIndexValue = panel.querySelector('[data-a11y="tab-index"]');
    ui.a11yHeadingValue = panel.querySelector('[data-a11y="heading"]');
    ui.a11yStatesGrid = panel.querySelector('[data-a11y-list="states"]');
    ui.a11yAriaGrid = panel.querySelector('[data-a11y-list="aria"]');
    ui.eventSummaryValue = panel.querySelector('[data-event="summary"]');
    ui.eventList = panel.querySelector('.event-list');
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
    for (const button of ui.densityButtons) {
      button.addEventListener('click', () => setDensity(button.dataset.densityOption));
    }
    ui.backButton.addEventListener('click', () => navigateHistory(-1));
    ui.historySelect.addEventListener('change', () => {
      const targetIndex = Number.parseInt(ui.historySelect.value, 10);
      if (Number.isInteger(targetIndex)) navigateHistoryToIndex(targetIndex);
    });
    ui.forwardButton.addEventListener('click', () => navigateHistory(1));
    ui.pinButton.addEventListener('click', toggleCurrentPin);
    ui.clearPinsButton.addEventListener('click', clearPins);
    ui.editPropertySelect.addEventListener('change', () => renderEditView(ui.result));
    ui.editApplyButton.addEventListener('click', applyEditFromUI);
    ui.editValueInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') applyEditFromUI();
    });
    ui.editUndoButton.addEventListener('click', () => sendTopCommand('UNDO_EDIT'));
    ui.editResetCurrentButton.addEventListener('click', () => sendTopCommand('RESET_CURRENT_EDITS'));
    ui.editResetAllButton.addEventListener('click', () => sendTopCommand('RESET_ALL_EDITS'));
    ui.editCopyCssButton.addEventListener('click', copyTemporaryEditCss);
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

    ui.compareGrid.addEventListener('click', event => {
      const button = event.target.closest?.('[data-pin-action]');
      const card = button?.closest?.('[data-pin-id]');
      if (!button || !card) return;
      const pinId = card.dataset.pinId;
      if (button.dataset.pinAction === 'restore') restorePinnedSelection(pinId);
      else if (button.dataset.pinAction === 'remove') removePin(pinId);
      else if (button.dataset.pinAction === 'copy-locator') {
        copyPinnedLocator(pinId, button.dataset.locatorKind);
      }
    });

    for (const handle of panel.querySelectorAll('[data-resize-direction]')) {
      handle.addEventListener('pointerdown', beginPanelResize);
      handle.addEventListener('pointermove', resizePanel);
      handle.addEventListener('pointerup', endPanelResize);
      handle.addEventListener('pointercancel', endPanelResize);
    }

    setDensity(ui.density);
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
    resetAllTemporaryEdits({ refresh: false });
    frameState.host?.remove();
    frameState.host = null;
    frameState.shadow = null;
    frameState.marker = null;
    frameState.childFrameRequests.clear();
    frameState.selectionRegistry.clear();
    frameState.pinnedSelectionIds.clear();
    frameState.editUndoStack = [];
    clearUICountdown();
    for (const key of Object.keys(ui)) {
      if (['activeTab'].includes(key)) continue;
      if (key === 'densityButtons' || key === 'tabButtons' || key === 'tabPanels' || key === 'history' || key === 'pins') ui[key] = [];
      else if (key === 'countdownTimer') ui[key] = null;
      else if (key === 'countdownDeadline' || key === 'countdownRemaining') ui[key] = 0;
      else if (key === 'historyIndex') ui[key] = -1;
      else ui[key] = null;
    }
    ui.activeTab = 'overview';
    ui.density = 'compact';
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
    if (command === 'APPLY_EDIT') {
      applyTemporaryEdit(message.property, message.value);
      return;
    }
    if (command === 'UNDO_EDIT') {
      undoTemporaryEdit();
      return;
    }
    if (command === 'RESET_CURRENT_EDITS') {
      resetCurrentTemporaryEdits();
      return;
    }
    if (command === 'RESET_ALL_EDITS') {
      resetAllTemporaryEdits();
      return;
    }
    if (command === 'RESTORE_SELECTION') {
      restoreSelection(message.selectionId);
      return;
    }
    if (command === 'PIN_SELECTION') {
      if (message.selectionId) frameState.pinnedSelectionIds.add(message.selectionId);
      return;
    }
    if (command === 'UNPIN_SELECTION') {
      if (message.selectionId) frameState.pinnedSelectionIds.delete(message.selectionId);
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
