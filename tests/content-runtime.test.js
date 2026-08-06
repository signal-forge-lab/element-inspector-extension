'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MESSAGE = Object.freeze({
  FRAME_READY: 'ELEMENT_INSPECTOR_FRAME_READY',
  FRAME_EVENT: 'ELEMENT_INSPECTOR_FRAME_EVENT'
});

class FakeElement {
  constructor({ connected = true } = {}) {
    this.isConnected = connected;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 10, height: 10 };
  }
}

function createContentHarness(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const closeIndex = source.lastIndexOf('})();');
  assert.notEqual(closeIndex, -1);
  const instrumented = `${source.slice(0, closeIndex)}
    globalThis.__prismoraTest = {
      frameState,
      ui,
      renderEditView,
      updateHighlightPosition,
      onFrameContextMessage,
      requestFrameContext,
      requestChildFrameContexts: typeof requestChildFrameContexts === 'function'
        ? requestChildFrameContexts
        : null,
      refreshChildFrameContexts,
      handleTopEvent,
      beginPicking,
      toggleCountdown,
      setActiveTab,
      renderPinnedComparisons,
      inspectAndSelect,
      clampPanelWidth,
      clampPanelHeight,
      handleTabKeyDown: typeof handleTabKeyDown === 'function'
        ? handleTabKeyDown
        : null,
      onWindowPageHide: typeof onWindowPageHide === 'function'
        ? onWindowPageHide
        : null,
      clearTopSelectionState: typeof clearTopSelectionState === 'function'
        ? clearTopSelectionState
        : null
    };
  ${source.slice(closeIndex)}`;

  const runtimeMessages = [];
  const parentMessages = [];
  const messageListeners = [];
  let frameElements = [];

  const parentWindow = {
    postMessage(message, targetOrigin) {
      parentMessages.push({ message, targetOrigin });
    }
  };
  const window = {
    top: null,
    parent: options.isTopFrame === false ? parentWindow : null,
    innerWidth: options.innerWidth || 1280,
    innerHeight: options.innerHeight || 800,
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    },
    removeEventListener() {}
  };
  window.top = options.isTopFrame === false ? {} : window;
  if (options.isTopFrame !== false) window.parent = window;

  const document = {
    readyState: 'complete',
    title: 'Test document',
    documentElement: { appendChild() {} },
    body: null,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll(selector) {
      return selector === 'iframe, frame' ? frameElements : [];
    },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        appendChild() {},
        remove() {},
        attachShadow() {
          return { appendChild() {} };
        }
      };
    }
  };

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      getURL(value) { return value; },
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        if (message.type === MESSAGE.FRAME_READY) {
          callback?.({
            ok: true,
            active: false,
            frameId: options.frameId || 0,
            isTopFrame: options.isTopFrame !== false
          });
          return;
        }
        callback?.({ ok: true });
      }
    }
  };

  const context = {
    chrome,
    console,
    window,
    document,
    location: { href: 'https://example.test/' },
    navigator: {},
    Element: FakeElement,
    HTMLElement: FakeElement,
    CSS: { supports: () => true },
    crypto: { randomUUID: () => 'test-token' },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setInterval: () => 1,
    clearInterval() {},
    setTimeout,
    clearTimeout,
    URL,
    Blob,
    ElementInspector: {
      generateCssLocator() {
        return { value: options.frameSelector ?? null };
      },
      inspectElement() {
        if (options.inspectError) throw new Error(options.inspectError);
        return options.inspectResult || {
          selectedTag: 'button',
          selectedAttributes: {},
          selectedOuterHTML: '<button></button>',
          controlAttributes: {},
          outerHTML: '<button></button>',
          ancestors: [],
          shadow: { depth: 0, hosts: [] },
          locators: {
            css: { value: 'button' },
            xpath: { value: '//button' },
            jsPath: { value: 'document.querySelector("button")' }
          }
        };
      }
    },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context);

  return {
    api: context.__prismoraTest,
    runtimeMessages,
    parentMessages,
    parentWindow,
    setFrameElements(elements) {
      frameElements = elements;
    }
  };
}

function createFrameElement(sourceWindow) {
  return {
    localName: 'iframe',
    contentWindow: sourceWindow,
    getAttribute(name) {
      const values = {
        id: 'child-frame',
        name: 'private-name',
        title: 'Private title',
        src: 'https://child.example/private'
      };
      return values[name] || null;
    }
  };
}

function createTabButton(tabName, options = {}) {
  const attributes = new Map();
  return {
    dataset: { tab: tabName, active: options.active ? 'true' : 'false' },
    hidden: Boolean(options.hidden),
    disabled: Boolean(options.disabled),
    tabIndex: options.active ? 0 : -1,
    focused: false,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    focus() {
      this.focused = true;
    }
  };
}

function createTabPanel(panelName, hidden = true) {
  return {
    dataset: { panel: panelName },
    hidden
  };
}

test('keeps all-frame reset enabled when the current frame has no edits', () => {
  const harness = createContentHarness();
  harness.api.ui.editResetAllButton = { disabled: true };
  harness.api.renderEditView({
    temporaryEdits: {
      frameEditCount: 0,
      declarations: [],
      currentValues: {},
      undoAvailable: false,
      active: false,
      allCssText: ''
    }
  });

  assert.equal(harness.api.ui.editResetAllButton.disabled, false);
});

test('keeps normal panel minimums while fitting extremely small viewports', () => {
  const normal = createContentHarness({ innerWidth: 1280, innerHeight: 800 });
  assert.equal(normal.api.clampPanelWidth(200), 360);
  assert.equal(normal.api.clampPanelHeight(200, 8), 440);

  const small = createContentHarness({ innerWidth: 180, innerHeight: 160 });
  assert.equal(small.api.clampPanelWidth(468), 164);
  assert.equal(small.api.clampPanelHeight(440, 8), 144);
});

test('returns to picking without partial selection state when inspection throws', () => {
  const harness = createContentHarness({ inspectError: 'analysis failed' });
  const target = new FakeElement({ connected: true });
  Object.assign(harness.api.frameState, {
    active: true,
    mode: 'picking',
    hoveredElement: target,
    selectedElement: null,
    currentSelectionId: null,
    highlightedElement: target
  });

  assert.doesNotThrow(() => harness.api.inspectAndSelect(target));

  assert.equal(harness.api.frameState.mode, 'picking');
  assert.equal(harness.api.frameState.hoveredElement, null);
  assert.equal(harness.api.frameState.selectedElement, null);
  assert.equal(harness.api.frameState.currentSelectionId, null);
  assert.equal(harness.api.frameState.selectionRegistry.size, 0);
  assert.equal(harness.runtimeMessages.some(message =>
    message.type === MESSAGE.FRAME_EVENT && message.event?.kind === 'selected'
  ), false);
  const status = harness.runtimeMessages.find(message =>
    message.type === MESSAGE.FRAME_EVENT && message.event?.kind === 'status'
  );
  assert.ok(status);
  assert.equal(status.event.status, 'error');
  assert.match(status.event.message, /analysis failed/);
});

test('removes temporary edit attributes from nested SVG snapshot fields', () => {
  const internalAttribute = 'data-ei-edit-test-token';
  const harness = createContentHarness({
    inspectResult: {
      selectedTag: 'circle',
      selectedAttributes: { [internalAttribute]: 'selected-edit', cx: '5' },
      selectedOuterHTML: `<circle ${internalAttribute}="selected-edit" cx="5"></circle>`,
      controlAttributes: { [internalAttribute]: 'control-edit' },
      outerHTML: `<svg ${internalAttribute}="control-edit"></svg>`,
      ancestors: [{ attributes: { [internalAttribute]: 'ancestor-edit' } }],
      shadow: { depth: 0, hosts: [{ attributes: { [internalAttribute]: 'host-edit' } }] },
      locators: {
        css: { value: 'circle' },
        xpath: { value: '//circle' },
        jsPath: { value: 'document.querySelector("circle")' }
      },
      svg: {
        attributes: { [internalAttribute]: 'svg-edit', viewBox: '0 0 10 10' },
        useHref: null,
        paths: [],
        circles: [{ [internalAttribute]: 'circle-edit', cx: '5', cy: '5' }]
      }
    }
  });
  const target = new FakeElement({ connected: true });
  harness.api.frameState.active = true;

  harness.api.inspectAndSelect(target);

  const selected = harness.runtimeMessages.find(message =>
    message.type === MESSAGE.FRAME_EVENT && message.event?.kind === 'selected'
  );
  assert.ok(selected);
  const result = selected.event.result;
  assert.equal(Object.hasOwn(result.selectedAttributes, internalAttribute), false);
  assert.equal(Object.hasOwn(result.controlAttributes, internalAttribute), false);
  assert.equal(Object.hasOwn(result.ancestors[0].attributes, internalAttribute), false);
  assert.equal(Object.hasOwn(result.shadow.hosts[0].attributes, internalAttribute), false);
  assert.equal(Object.hasOwn(result.svg.attributes, internalAttribute), false);
  assert.equal(Object.hasOwn(result.svg.circles[0], internalAttribute), false);
  assert.doesNotMatch(result.selectedOuterHTML, new RegExp(internalAttribute));
  assert.doesNotMatch(result.outerHTML, new RegExp(internalAttribute));
});

test('applies tab selection, panel visibility, and roving tabindex together', () => {
  const harness = createContentHarness();
  const overview = createTabButton('overview', { active: true });
  const styles = createTabButton('styles');
  const json = createTabButton('json');
  const overviewPanel = createTabPanel('overview', false);
  const stylesPanel = createTabPanel('styles');
  const jsonPanel = createTabPanel('json');
  harness.api.ui.tabButtons = [overview, styles, json];
  harness.api.ui.tabPanels = [overviewPanel, stylesPanel, jsonPanel];

  harness.api.setActiveTab('styles');

  assert.equal(harness.api.ui.activeTab, 'styles');
  assert.equal(overview.getAttribute('aria-selected'), 'false');
  assert.equal(styles.getAttribute('aria-selected'), 'true');
  assert.equal(json.getAttribute('aria-selected'), 'false');
  assert.equal(overview.tabIndex, -1);
  assert.equal(styles.tabIndex, 0);
  assert.equal(json.tabIndex, -1);
  assert.equal(overviewPanel.hidden, true);
  assert.equal(stylesPanel.hidden, false);
  assert.equal(jsonPanel.hidden, true);
});

test('moves tabs with arrows, Home, and End while skipping hidden tabs', () => {
  const harness = createContentHarness();
  assert.equal(typeof harness.api.handleTabKeyDown, 'function');
  const overview = createTabButton('overview', { active: true });
  const styles = createTabButton('styles');
  const compare = createTabButton('compare', { hidden: true });
  const json = createTabButton('json');
  harness.api.ui.tabButtons = [overview, styles, compare, json];
  harness.api.ui.tabPanels = [
    createTabPanel('overview', false),
    createTabPanel('styles'),
    createTabPanel('compare'),
    createTabPanel('json')
  ];

  const eventFor = (currentTarget, key) => ({
    currentTarget,
    key,
    prevented: false,
    preventDefault() { this.prevented = true; }
  });

  let event = eventFor(overview, 'ArrowLeft');
  harness.api.handleTabKeyDown(event);
  assert.equal(event.prevented, true);
  assert.equal(harness.api.ui.activeTab, 'json');
  assert.equal(json.focused, true);

  event = eventFor(json, 'Home');
  harness.api.handleTabKeyDown(event);
  assert.equal(harness.api.ui.activeTab, 'overview');
  assert.equal(overview.focused, true);

  event = eventFor(overview, 'End');
  harness.api.handleTabKeyDown(event);
  assert.equal(harness.api.ui.activeTab, 'json');

  event = eventFor(json, 'ArrowRight');
  harness.api.handleTabKeyDown(event);
  assert.equal(harness.api.ui.activeTab, 'overview');
});

test('falls back to Overview when Compare is unavailable', () => {
  const harness = createContentHarness();
  const overview = createTabButton('overview', { active: true });
  const compare = createTabButton('compare', { hidden: true });
  harness.api.ui.tabButtons = [overview, compare];
  harness.api.ui.tabPanels = [createTabPanel('overview', false), createTabPanel('compare')];
  harness.api.ui.pins = [];

  harness.api.setActiveTab('compare', { focus: true });

  assert.equal(harness.api.ui.activeTab, 'overview');
  assert.equal(overview.focused, true);
  assert.equal(compare.focused, false);
});

test('moves focus to Overview when the active Compare tab disappears', () => {
  const harness = createContentHarness();
  const overview = createTabButton('overview');
  const compare = createTabButton('compare', { active: true });
  harness.api.ui.tabButtons = [overview, compare];
  harness.api.ui.tabPanels = [createTabPanel('overview'), createTabPanel('compare', false)];
  harness.api.ui.compareTabButton = compare;
  harness.api.ui.compareGrid = {
    replaceChildren() {},
    appendChild() {}
  };
  harness.api.ui.clearPinsButton = { disabled: false };
  harness.api.ui.pinCount = { textContent: '' };
  harness.api.ui.activeTab = 'compare';
  harness.api.ui.pins = [];

  harness.api.renderPinnedComparisons();

  assert.equal(compare.hidden, true);
  assert.equal(harness.api.ui.activeTab, 'overview');
  assert.equal(overview.focused, true);
});

test('clears stale ancestor JSON when returning to picking mode', () => {
  const harness = createContentHarness();
  Object.assign(harness.api.ui, {
    targetName: { textContent: '' },
    result: { selectedTag: 'button' },
    activeFrameId: 3,
    selectedFrameId: 7,
    currentSelectionId: 'selection-7',
    pendingHistoryIndex: 2,
    ancestorExport: { exportProfile: 'ancestor-detail' },
    ancestorExportPending: true,
    history: [{ selectionId: 'selection-7' }],
    pins: [{ pinId: 'pin-1' }]
  });

  harness.api.beginPicking();

  assert.equal(harness.api.ui.result, null);
  assert.equal(harness.api.ui.activeFrameId, null);
  assert.equal(harness.api.ui.selectedFrameId, null);
  assert.equal(harness.api.ui.currentSelectionId, null);
  assert.equal(harness.api.ui.pendingHistoryIndex, null);
  assert.equal(harness.api.ui.ancestorExport, null);
  assert.equal(harness.api.ui.ancestorExportPending, false);
  assert.equal(harness.api.ui.history.length, 1);
  assert.equal(harness.api.ui.pins.length, 1);
});

test('clears stale ancestor JSON when starting countdown mode', () => {
  const harness = createContentHarness();
  Object.assign(harness.api.ui, {
    delayInput: { value: '5' },
    result: { selectedTag: 'button' },
    activeFrameId: 3,
    selectedFrameId: 7,
    currentSelectionId: 'selection-7',
    pendingHistoryIndex: 2,
    ancestorExport: { exportProfile: 'ancestor-detail' },
    ancestorExportPending: true
  });

  harness.api.toggleCountdown();

  assert.equal(harness.api.ui.result, null);
  assert.equal(harness.api.ui.activeFrameId, null);
  assert.equal(harness.api.ui.selectedFrameId, null);
  assert.equal(harness.api.ui.currentSelectionId, null);
  assert.equal(harness.api.ui.pendingHistoryIndex, null);
  assert.equal(harness.api.ui.ancestorExport, null);
  assert.equal(harness.api.ui.ancestorExportPending, false);
});

test('emits selection invalidation when a fixed element is removed', () => {
  const harness = createContentHarness();
  const removed = new FakeElement({ connected: false });
  Object.assign(harness.api.frameState, {
    active: true,
    mode: 'fixed',
    marker: { style: {} },
    highlightedElement: removed,
    selectedElement: removed,
    currentSelectionId: 'selection-1'
  });

  harness.api.updateHighlightPosition();

  const invalidation = harness.runtimeMessages.find(message =>
    message.type === MESSAGE.FRAME_EVENT && message.event?.kind === 'selectionInvalidated'
  );
  assert.ok(invalidation);
  assert.equal(invalidation.event.selectionId, 'selection-1');
  assert.equal(harness.api.frameState.mode, 'picking');
  assert.equal(harness.api.frameState.selectedElement, null);
});

test('invalidates a child-frame selection before the iframe unloads', () => {
  const harness = createContentHarness({ isTopFrame: false, frameId: 9 });
  assert.equal(typeof harness.api.onWindowPageHide, 'function');
  const selected = new FakeElement({ connected: true });
  Object.assign(harness.api.frameState, {
    active: true,
    mode: 'fixed',
    selectedElement: selected,
    highlightedElement: selected,
    currentSelectionId: 'selection-frame-9'
  });

  harness.api.onWindowPageHide();

  const invalidation = harness.runtimeMessages.find(message =>
    message.type === MESSAGE.FRAME_EVENT && message.event?.kind === 'selectionInvalidated'
  );
  assert.ok(invalidation);
  assert.equal(invalidation.event.selectionId, 'selection-frame-9');
  assert.equal(harness.api.frameState.mode, 'picking');
});

test('clears top-frame selection state through one invalidation helper', () => {
  const harness = createContentHarness();
  assert.equal(typeof harness.api.clearTopSelectionState, 'function');
  Object.assign(harness.api.ui, {
    result: { selectedTag: 'button' },
    activeFrameId: 3,
    selectedFrameId: 7,
    currentSelectionId: 'selection-7',
    pendingHistoryIndex: 2,
    ancestorExport: { exportProfile: 'ancestor-detail' },
    ancestorExportPending: true
  });

  harness.api.clearTopSelectionState();

  assert.equal(harness.api.ui.result, null);
  assert.equal(harness.api.ui.activeFrameId, null);
  assert.equal(harness.api.ui.selectedFrameId, null);
  assert.equal(harness.api.ui.currentSelectionId, null);
  assert.equal(harness.api.ui.pendingHistoryIndex, null);
  assert.equal(harness.api.ui.ancestorExport, null);
  assert.equal(harness.api.ui.ancestorExportPending, false);
});

test('does not request or answer frame context while inactive', () => {
  const childHarness = createContentHarness({ isTopFrame: false, frameId: 9 });
  childHarness.api.frameState.active = false;
  childHarness.api.requestFrameContext();
  assert.equal(childHarness.parentMessages.length, 0);

  const topHarness = createContentHarness();
  const sourceWindow = { postMessage() { throw new Error('must not respond'); } };
  topHarness.setFrameElements([createFrameElement(sourceWindow)]);
  topHarness.api.frameState.active = false;
  topHarness.api.onFrameContextMessage({
    source: sourceWindow,
    data: { channel: '__element_inspector_frame_context_v1__', type: 'HELLO', token: 'child-token' }
  });
  assert.equal(topHarness.api.frameState.childFrameRequests.size, 0);
});

test('supports either parent-first or child-first activation without polling', () => {
  const topHarness = createContentHarness();
  assert.equal(typeof topHarness.api.requestChildFrameContexts, 'function');
  const childRequests = [];
  const childWindow = {
    postMessage(message) { childRequests.push(message); }
  };
  topHarness.setFrameElements([createFrameElement(childWindow)]);
  topHarness.api.frameState.active = true;
  topHarness.api.requestChildFrameContexts();
  assert.equal(childRequests[0]?.type, 'REQUEST_HELLO');

  const childHarness = createContentHarness({ isTopFrame: false, frameId: 9 });
  childHarness.api.frameState.active = true;
  childHarness.api.onFrameContextMessage({
    source: childHarness.parentWindow,
    data: { channel: '__element_inspector_frame_context_v1__', type: 'REQUEST_HELLO' }
  });
  assert.equal(childHarness.parentMessages[0]?.message?.type, 'HELLO');
});

test('accepts only bounded string tokens from direct child frames', () => {
  const harness = createContentHarness();
  const responses = [];
  const sourceWindow = {
    postMessage(message) { responses.push(message); }
  };
  harness.setFrameElements([createFrameElement(sourceWindow)]);
  harness.api.frameState.active = true;

  harness.api.onFrameContextMessage({
    source: sourceWindow,
    data: { channel: '__element_inspector_frame_context_v1__', type: 'HELLO', token: 42 }
  });
  harness.api.onFrameContextMessage({
    source: sourceWindow,
    data: { channel: '__element_inspector_frame_context_v1__', type: 'HELLO', token: 'x'.repeat(300) }
  });
  assert.equal(responses.length, 0);
  assert.equal(harness.api.frameState.childFrameRequests.size, 0);

  harness.api.onFrameContextMessage({
    source: sourceWindow,
    data: { channel: '__element_inspector_frame_context_v1__', type: 'HELLO', token: 'child-token' }
  });
  assert.equal(responses.length, 1);
  assert.equal(harness.api.frameState.childFrameRequests.size, 1);
  assert.deepEqual(Object.keys(responses[0].context.path[0]).sort(), ['css', 'tagName']);
});

test('omits an oversized generated frame selector before posting context', () => {
  const harness = createContentHarness({ frameSelector: '#'.padEnd(3000, 'x') });
  const responses = [];
  const sourceWindow = {
    postMessage(message) { responses.push(message); }
  };
  harness.setFrameElements([createFrameElement(sourceWindow)]);
  harness.api.frameState.active = true;

  harness.api.onFrameContextMessage({
    source: sourceWindow,
    data: { channel: '__element_inspector_frame_context_v1__', type: 'HELLO', token: 'child-token' }
  });

  assert.equal(responses.length, 1);
  assert.equal(responses[0].context.path[0].css, null);
});

test('prunes child frame requests after the iframe disappears', () => {
  const harness = createContentHarness();
  const sourceWindow = { postMessage() {} };
  harness.setFrameElements([createFrameElement(sourceWindow)]);
  harness.api.frameState.active = true;
  harness.api.onFrameContextMessage({
    source: sourceWindow,
    data: { channel: '__element_inspector_frame_context_v1__', type: 'HELLO', token: 'child-token' }
  });
  assert.equal(harness.api.frameState.childFrameRequests.size, 1);

  harness.setFrameElements([]);
  harness.api.refreshChildFrameContexts();
  assert.equal(harness.api.frameState.childFrameRequests.size, 0);
});

test('rejects malformed parent context instead of storing untrusted metadata', () => {
  const harness = createContentHarness({ isTopFrame: false, frameId: 9 });
  harness.api.frameState.active = true;
  harness.api.onFrameContextMessage({
    source: harness.parentWindow,
    data: {
      channel: '__element_inspector_frame_context_v1__',
      type: 'CONTEXT',
      token: harness.api.frameState.frameToken,
      context: {
        depth: 999,
        path: [{ src: 'https://parent.example/private', title: 'Private title' }]
      }
    }
  });

  assert.equal(harness.api.frameState.frameContext.depth, 0);
  assert.equal(harness.api.frameState.frameContext.path.length, 0);
});

test('stores only sanitized fields from a valid parent frame context', () => {
  const harness = createContentHarness({ isTopFrame: false, frameId: 9 });
  harness.api.frameState.active = true;
  harness.api.onFrameContextMessage({
    source: harness.parentWindow,
    data: {
      channel: '__element_inspector_frame_context_v1__',
      type: 'CONTEXT',
      token: harness.api.frameState.frameToken,
      context: {
        depth: 2,
        path: [
          { tagName: 'iframe', css: '#outer', src: 'https://private.example/' },
          { tagName: 'frame', css: null, title: 'Private title' }
        ]
      }
    }
  });

  assert.equal(harness.api.frameState.frameContext.depth, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.api.frameState.frameContext.path)),
    [
      { tagName: 'iframe', css: '#outer' },
      { tagName: 'frame', css: null }
    ]
  );
});
