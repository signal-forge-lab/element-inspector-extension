'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class MockElement {
  constructor(tagName, attributes = {}, options = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.localName = String(tagName).toLowerCase();
    this.namespaceURI = options.namespaceURI || 'http://www.w3.org/1999/xhtml';
    this.attributeMap = { ...attributes };
    this.parentElement = null;
    this.children = [];
    this.textContent = options.textContent || '';
    this.outerHTML = options.outerHTML || `<${String(tagName).toLowerCase()}></${String(tagName).toLowerCase()}>`;
    this.rect = options.rect || { top: 0, left: 0, width: 0, height: 0 };
    this.computedStyle = options.computedStyle || { display: 'block', visibility: 'visible', position: 'static' };
    this.isConnected = options.isConnected !== false;
    this.ownerDocument = {
      defaultView: {
        getComputedStyle: element => element.computedStyle
      }
    };
  }

  get attributes() {
    return Object.entries(this.attributeMap).map(([name, value]) => ({ name, value }));
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  get classList() {
    return String(this.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean);
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 && index < this.parentElement.children.length - 1
      ? this.parentElement.children[index + 1]
      : null;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributeMap, name)
      ? this.attributeMap[name]
      : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributeMap, name);
  }

  matches(selector) {
    return String(selector).split(',').some(part => {
      const item = part.trim();
      if (item === 'button') return this.tagName === 'BUTTON';
      if (item === 'a') return this.tagName === 'A';
      if (item === 'svg') return this.tagName === 'SVG';
      if (item === 'path') return this.tagName === 'PATH';
      if (item === 'circle') return this.tagName === 'CIRCLE';
      if (item === 'use') return this.tagName === 'USE';
      if (item === '[role="button"]') return this.getAttribute('role') === 'button';
      if (item === '[tabindex]') return this.hasAttribute('tabindex');
      return false;
    });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getRootNode() {
    return this.selectorRoot || this.ownerDocument;
  }
}

global.Element = MockElement;

const root = path.join(__dirname, '..');
const inspector = require(path.join(root, 'inspector.js'));

test('inspects the selected SVG child and its nearest actionable control', () => {
  const parent = new MockElement('div', { id: 'parent' }, {
    rect: { top: 10.2, left: 20.8, width: 300.1, height: 80.7 },
    computedStyle: { display: 'flex', visibility: 'visible', position: 'relative' }
  });
  const button = parent.appendChild(new MockElement('button', {
    'data-testid': 'sample-button',
    'aria-label': 'Sample'
  }, {
    textContent: '  Sample\n button  ',
    outerHTML: '<button data-testid="sample-button"><svg></svg></button>',
    rect: { top: 12.4, left: 24.6, width: 40.2, height: 32.8 },
    computedStyle: { display: 'inline-flex', visibility: 'visible', position: 'absolute' }
  }));
  const svg = button.appendChild(new MockElement('svg', { width: '20', height: '20' }));
  const use = svg.appendChild(new MockElement('use', { href: '/sprite.svg#copy' }, {
    textContent: ' icon ',
    outerHTML: '<use href="/sprite.svg#copy"></use>',
    rect: { top: 14.2, left: 27.9, width: 18.1, height: 18.2 }
  }));
  svg.appendChild(new MockElement('path', { d: 'M0 0h10v10z' }));
  svg.appendChild(new MockElement('circle', { cx: '5', cy: '5', r: '2' }));

  const result = inspector.inspectElement(use);

  assert.equal(result.selectedTag, 'use');
  assert.equal(result.selectedText, 'icon');
  assert.equal(result.selectedOuterHTML, '<use href="/sprite.svg#copy"></use>');
  assert.deepEqual(result.selectedRect, { top: 14, left: 28, width: 18, height: 18 });
  assert.equal(result.controlTag, 'button');
  assert.deepEqual(result.controlRect, { top: 12, left: 25, width: 40, height: 33 });
  assert.equal(result.text, 'Sample button');
  assert.equal(result.svg.useHref, '/sprite.svg#copy');
  assert.deepEqual(result.svg.paths, ['M0 0h10v10z']);
  assert.deepEqual(result.svg.circles, [{ cx: '5', cy: '5', r: '2' }]);
  assert.equal(result.ancestors[0].tagName, 'use');
  assert.equal(result.ancestors[1].tagName, 'svg');
});

test('uses the selected element when no actionable ancestor exists', () => {
  const div = new MockElement('div', { 'data-state': 'open' }, { textContent: 'Plain content' });
  const result = inspector.inspectElement(div);
  assert.equal(result.selectedTag, 'div');
  assert.equal(result.controlTag, 'div');
  assert.equal(result.svg, null);
});

test('limits selected and control outerHTML to 5000 characters by default', () => {
  const div = new MockElement('div', {}, { outerHTML: 'x'.repeat(7000) });
  const result = inspector.inspectElement(div);
  assert.equal(result.selectedOuterHTML.length, 5000);
  assert.equal(result.outerHTML.length, 5000);
});

test('rejects a missing DOM element', () => {
  assert.throws(() => inspector.inspectElement(null), /対象要素を取得できません/);
});

test('generates unique CSS, XPath, and JS path locators', () => {
  const button = new MockElement('button', { id: 'save-button', 'data-testid': 'save' });
  const xpathResult = { ORDERED_NODE_SNAPSHOT_TYPE: 7 };
  const selectorRoot = {
    nodeType: 9,
    querySelectorAll: selector => selector === '#save-button' ? [button] : [],
    evaluate: xpath => ({ snapshotLength: xpath === "//*[@id='save-button']" ? 1 : 0 }),
    defaultView: { XPathResult: xpathResult, getComputedStyle: element => element.computedStyle }
  };
  button.selectorRoot = selectorRoot;
  button.ownerDocument = selectorRoot;

  const css = inspector.generateCssLocator(button);
  const xpath = inspector.generateXPathLocator(button);
  const jsPath = inspector.generateJsPath(button, css);

  assert.deepEqual(css, {
    value: '#save-button',
    matchCount: 1,
    unique: true,
    scope: 'document'
  });
  assert.equal(xpath.value, "//*[@id='save-button']");
  assert.equal(xpath.unique, true);
  assert.equal(jsPath.value, 'document.querySelector("#save-button")');
});

test('escapes mixed quotes in XPath attribute values', () => {
  const button = new MockElement('button', { id: `save'button"primary` });
  let evaluatedXPath = null;
  const selectorRoot = {
    nodeType: 9,
    querySelectorAll: () => [button],
    evaluate: xpath => {
      evaluatedXPath = xpath;
      return { snapshotLength: 1 };
    },
    defaultView: {
      XPathResult: { ORDERED_NODE_SNAPSHOT_TYPE: 7 },
      getComputedStyle: element => element.computedStyle
    }
  };
  button.selectorRoot = selectorRoot;
  button.ownerDocument = selectorRoot;

  const xpath = inspector.generateXPathLocator(button);
  assert.equal(xpath.unique, true);
  assert.match(evaluatedXPath, /^\/\/\*\[@id=concat\(/);
  assert.match(evaluatedXPath, /"'"/);
});

test('marks a duplicated CSS selector as non-unique', () => {
  const first = new MockElement('button', { class: 'action' });
  const second = new MockElement('button', { class: 'action' });
  const selectorRoot = {
    nodeType: 9,
    querySelectorAll: selector => selector === 'button.action' ? [first, second] : []
  };
  first.selectorRoot = selectorRoot;
  first.ownerDocument = selectorRoot;

  const css = inspector.generateCssLocator(first);
  assert.equal(css.value, 'button.action');
  assert.equal(css.matchCount, 2);
  assert.equal(css.unique, false);
});

test('does not emit a misleading JS path inside a Shadow Root', () => {
  const button = new MockElement('button', { id: 'shadow-save' });
  const shadowRoot = {
    nodeType: 11,
    querySelectorAll: selector => selector === '#shadow-save' ? [button] : []
  };
  button.selectorRoot = shadowRoot;

  const css = inspector.generateCssLocator(button);
  const jsPath = inspector.generateJsPath(button, css);

  assert.equal(css.scope, 'shadow-root');
  assert.equal(jsPath.value, null);
  assert.equal(jsPath.unsupported, true);
});

test('reports sibling position and selectable children', () => {
  const parent = new MockElement('div');
  const first = parent.appendChild(new MockElement('span', { id: 'first' }, { textContent: 'First' }));
  const second = parent.appendChild(new MockElement('span', { id: 'second' }, { textContent: 'Second' }));
  second.appendChild(new MockElement('strong', {}, { textContent: 'Child A' }));
  second.appendChild(new MockElement('em', {}, { textContent: 'Child B' }));
  parent.appendChild(new MockElement('span', { id: 'third' }, { textContent: 'Third' }));

  const navigation = inspector.getNavigationState(second);
  assert.equal(navigation.hasParent, true);
  assert.equal(navigation.hasPreviousSibling, true);
  assert.equal(navigation.hasNextSibling, true);
  assert.equal(navigation.siblingIndex, 1);
  assert.equal(navigation.siblingCount, 3);
  assert.equal(navigation.childCount, 2);
  assert.equal(navigation.children[0].tagName, 'strong');
  assert.equal(first.nextElementSibling, second);
});

test('manifest and runtime implement the toolbar-driven in-page inspector', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const inspectorSource = fs.readFileSync(path.join(root, 'inspector.js'), 'utf8');
  const runtimeSource = `${background}\n${content}\n${inspectorSource}`;
  const highlightCss = content.slice(
    content.indexOf('.highlight {'),
    content.indexOf('.panel {')
  );

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.8.2');
  assert.equal(pkg.version, '0.8.2');
  assert.deepEqual(manifest.permissions, ['clipboardWrite']);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.content_scripts[0].match_about_blank, true);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback, true);
  assert.doesNotMatch(background, /contextMenus/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(background, /ELEMENT_INSPECTOR_FRAME_READY/);
  assert.match(background, /ELEMENT_INSPECTOR_QUERY_STATE/);
  assert.match(background, /ELEMENT_INSPECTOR_TOP_COMMAND/);
  assert.match(background, /selectedFrameId/);
  assert.match(background, /broadcastToFrames/);
  assert.match(background, /command === 'RESTORE_SELECTION'/);
  assert.match(background, /command === 'PIN_SELECTION' \|\| command === 'UNPIN_SELECTION'/);
  assert.match(background, /targetFrameId/);
  assert.match(background, /historyRestoreFailed: true/);
  assert.match(content, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(content, /@keyframes ei-rainbow-flow-x/);
  assert.match(content, /@keyframes ei-rainbow-flow-y/);
  assert.match(content, /for \(const side of \['top', 'right', 'bottom', 'left'\]\)/);
  assert.match(content, /edge\.className = `highlight-edge \$\{side\}`/);
  assert.doesNotMatch(highlightCss, /mask-composite|webkit-mask|conic-gradient|drop-shadow/);
  assert.doesNotMatch(highlightCss, /opacity\s*:/);
  assert.match(content, /FRAME_CHANNEL/);
  assert.match(content, /window\.parent\.postMessage/);
  assert.match(content, /querySelectorAll\('iframe, frame'\)/);
  assert.match(content, /refreshChildFrameContexts/);
  assert.match(content, /frameRelative/);
  assert.match(content, /data-nav="previous"/);
  assert.match(content, /data-nav="next"/);
  assert.match(content, /child-select/);
  assert.match(content, /fixed-stack/);
  assert.match(content, /hierarchy-surface/);
  assert.match(content, /\.view-scroll \{ flex: 1 1 auto;/);
  assert.match(content, /history-back/);
  assert.match(content, /history-forward/);
  assert.match(content, /history-select/);
  assert.match(content, /function navigateHistoryToIndex/);
  assert.match(content, /selectionRegistry/);
  assert.match(content, /pinnedSelectionIds/);
  assert.match(content, /historyMode: options\.historyMode \|\| 'push'/);
  assert.match(content, /function navigateHistory/);
  assert.match(content, /RESTORE_SELECTION/);
  assert.match(content, /<svg viewBox="0 0 16 16"[^>]*>[\s\S]*M4 4l8 8M12 4l-8 8/);
  assert.doesNotMatch(content, /data-action="close" aria-label="閉じる">×<\/button>/);
  assert.match(content, /data-tab="locators"/);
  assert.match(content, /data-tab="compare"/);
  assert.match(content, /MAX_PINNED_ENTRIES = 4/);
  assert.match(content, /function toggleCurrentPin/);
  assert.match(content, /function renderPinnedComparisons/);
  assert.match(content, /data-action="clear-pins"/);
  assert.match(content, /createComparisonField\('CSS Selector'/);
  assert.match(content, /createComparisonField\('XPath'/);
  assert.match(content, /createComparisonField\('JS Path'/);
  assert.match(content, /CSS Selector/);
  assert.match(content, /XPath/);
  assert.match(content, /JS Path/);
  assert.match(content, /prefers-reduced-motion/);
  assert.match(content, /prefers-reduced-transparency/);
  assert.match(content, /tabs button::after/);
  assert.match(content, /data-action="density"/);
  assert.match(content, /data-density=/);
  assert.match(content, /function toggleDensity/);
  assert.match(content, /data-resize-side="left"/);
  assert.match(content, /data-resize-side="right"/);
  assert.match(content, /function beginPanelResize/);
  assert.match(content, /function resizePanel/);
  assert.match(content, /container: inspector \/ inline-size/);
  assert.match(content, /rgba\(113,155,255/);
  assert.match(content, /#77d6a3/);
  assert.match(content, /Local only · no storage/);
  assert.match(content, /UNIQUE · \$\{scope\}/);
  assert.match(content, /countdownDeadline/);
  assert.match(content, /JSONをコピー/);
  assert.match(content, /JSONを保存/);
  assert.match(content, /beginPanelDrag/);
  assert.match(content, /setPointerCapture/);
  assert.match(content, /releasePointerCapture/);
  assert.match(content, /event\.key !== 'Escape'[\s\S]*sendTopCommand\('DEACTIVATE'\)/);
  assert.match(content, /navigator\.clipboard\?\.writeText/);
  assert.match(content, /URL\.createObjectURL/);
  assert.match(inspectorSource, /generateCssLocator/);
  assert.match(inspectorSource, /generateXPathLocator/);
  assert.match(inspectorSource, /generateJsPath/);
  assert.match(inspectorSource, /getNavigationState/);
  assert.doesNotMatch(runtimeSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(runtimeSource, /localStorage|sessionStorage|chrome\.storage/);
});
