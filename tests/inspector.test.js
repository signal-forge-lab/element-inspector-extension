'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
    this.shadowRoot = null;
    this.scrollWidth = options.scrollWidth ?? this.rect.width;
    this.scrollHeight = options.scrollHeight ?? this.rect.height;
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

class MockShadowRoot {
  constructor(host) {
    this.nodeType = 11;
    this.host = host;
    this.mode = 'open';
    this.children = [];
    host.shadowRoot = this;
  }

  appendChild(child) {
    child.parentElement = null;
    child.selectorRoot = this;
    child.ownerDocument = this.host.ownerDocument;
    this.children.push(child);
    return child;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      if (selector.startsWith('#') && node.id === selector.slice(1)) matches.push(node);
      if (selector === node.localName) matches.push(node);
      for (const child of node.children || []) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
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

test('generates an executable JS path through an open Shadow Root', () => {
  const host = new MockElement('section', { id: 'settings-host' });
  const documentRoot = {
    nodeType: 9,
    querySelectorAll: selector => selector === '#settings-host' ? [host] : [],
    defaultView: { getComputedStyle: element => element.computedStyle }
  };
  host.selectorRoot = documentRoot;
  host.ownerDocument = documentRoot;
  const shadowRoot = new MockShadowRoot(host);
  const button = shadowRoot.appendChild(new MockElement('button', { id: 'shadow-save' }));

  const css = inspector.generateCssLocator(button);
  const jsPath = inspector.generateJsPath(button, css);

  assert.equal(css.scope, 'shadow-root');
  assert.equal(jsPath.scope, 'shadow-chain');
  assert.equal(jsPath.shadowDepth, 1);
  assert.equal(
    jsPath.value,
    'document.querySelector("#settings-host")?.shadowRoot?.querySelector("#shadow-save")'
  );
  assert.deepEqual(jsPath.segments, ['#settings-host', '#shadow-save']);
});

test('supports nested open Shadow Roots and hierarchy traversal across hosts', () => {
  const outerHost = new MockElement('section', { id: 'outer-host' });
  const documentRoot = {
    nodeType: 9,
    querySelectorAll: selector => selector === '#outer-host' ? [outerHost] : [],
    defaultView: { getComputedStyle: element => element.computedStyle }
  };
  outerHost.selectorRoot = documentRoot;
  outerHost.ownerDocument = documentRoot;
  const outerRoot = new MockShadowRoot(outerHost);
  const innerHost = outerRoot.appendChild(new MockElement('div', { id: 'inner-host' }));
  const innerRoot = new MockShadowRoot(innerHost);
  const target = innerRoot.appendChild(new MockElement('button', { id: 'nested-target' }));

  const jsPath = inspector.generateJsPath(target);
  assert.equal(jsPath.shadowDepth, 2);
  assert.equal(
    jsPath.value,
    'document.querySelector("#outer-host")?.shadowRoot?.querySelector("#inner-host")?.shadowRoot?.querySelector("#nested-target")'
  );

  const targetNavigation = inspector.getNavigationState(target);
  assert.equal(targetNavigation.hasParent, true);
  assert.equal(targetNavigation.parentCrossesShadowBoundary, true);
  assert.equal(inspector.getComposedParent(target), innerHost);

  const hostNavigation = inspector.getNavigationState(innerHost);
  assert.equal(hostNavigation.childCount, 1);
  assert.equal(hostNavigation.children[0].treeScope, 'shadow');

  const shadow = inspector.collectShadowContext(target);
  assert.equal(shadow.inside, true);
  assert.equal(shadow.depth, 2);
  assert.deepEqual(shadow.hosts.map(item => item.tagName), ['section', 'div']);
});

test('collects computed styles and a numeric box model', () => {
  const element = new MockElement('div', {}, {
    rect: { top: 10, left: 20, width: 200, height: 100 },
    scrollWidth: 260,
    scrollHeight: 180,
    computedStyle: {
      0: '--brand-color',
      1: '--space-unit',
      length: 2,
      '--brand-color': '#123456',
      '--space-unit': '8px',
      getPropertyValue(property) { return this[property] || ''; },
      display: 'flex',
      position: 'relative',
      boxSizing: 'border-box',
      width: '200px',
      height: '100px',
      paddingTop: '10px',
      paddingRight: '12px',
      paddingBottom: '10px',
      paddingLeft: '12px',
      borderTopWidth: '2px',
      borderRightWidth: '2px',
      borderBottomWidth: '2px',
      borderLeftWidth: '2px',
      marginTop: '4px',
      marginRight: '5px',
      marginBottom: '6px',
      marginLeft: '7px',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontFamily: 'system-ui',
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '20px',
      color: 'rgb(32, 38, 45)'
    }
  });

  const result = inspector.inspectElement(element);
  assert.equal(result.computedStyles.layout.display, 'flex');
  assert.equal(result.computedStyles.flexGrid['justify-content'], 'space-between');
  assert.equal(result.computedStyles.typography['font-size'], '14px');
  assert.deepEqual(result.computedStyles.customProperties, {
    '--brand-color': '#123456',
    '--space-unit': '8px'
  });
  assert.deepEqual(result.computedStyles.customPropertiesMeta, {
    total: 2,
    truncated: false,
    limit: 200
  });
  assert.deepEqual(result.boxModel.margin, {
    top: '4px', right: '5px', bottom: '6px', left: '7px'
  });
  assert.deepEqual(result.boxModel.content, { width: 172, height: 76 });
  assert.deepEqual(result.boxModel.borderBox, { width: 200, height: 100 });
  assert.deepEqual(result.boxModel.scroll, { width: 260, height: 180 });
});

test('limits CSS custom property snapshots to 200 entries', () => {
  const computedStyle = { length: 205 };
  for (let index = 0; index < 205; index += 1) {
    const property = `--token-${String(index).padStart(3, '0')}`;
    computedStyle[index] = property;
    computedStyle[property] = String(index);
  }
  computedStyle.getPropertyValue = function getPropertyValue(property) {
    return this[property] || '';
  };
  const element = new MockElement('div', {}, { computedStyle });
  const computed = inspector.collectComputedStyles(element);
  assert.equal(Object.keys(computed.customProperties).length, 200);
  assert.deepEqual(computed.customPropertiesMeta, {
    total: 205,
    truncated: true,
    limit: 200
  });
});

test('builds an ancestor-detail export without recursive descendants', () => {
  const root = new MockElement('main', { id: 'app' }, {
    rect: { top: 0, left: 0, width: 800, height: 600 },
    computedStyle: { display: 'block', visibility: 'visible', position: 'relative' }
  });
  const parent = new MockElement('section', { class: 'panel' }, {
    rect: { top: 20, left: 30, width: 500, height: 300 },
    computedStyle: { display: 'grid', visibility: 'visible', position: 'relative' }
  });
  const selected = new MockElement('button', { id: 'save', type: 'button' }, {
    rect: { top: 50, left: 60, width: 120, height: 36 },
    textContent: '保存',
    outerHTML: '<button id="save"><span><strong>保存</strong></span></button>',
    computedStyle: { display: 'inline-flex', visibility: 'visible', position: 'static' }
  });
  const child = new MockElement('span', { class: 'label' }, {
    textContent: '保存',
    outerHTML: '<span class="label"><strong>保存</strong></span>'
  });
  const grandchild = new MockElement('strong', {}, { textContent: '保存' });

  root.appendChild(parent);
  parent.appendChild(selected);
  selected.appendChild(child);
  child.appendChild(grandchild);

  const result = inspector.buildAncestorExport(selected, { maxAncestorDepth: 8 });

  assert.equal(result.exportProfile, 'ancestor-detail');
  assert.equal(result.selected.tagName, 'button');
  assert.equal(result.selected.shallowOuterHTML, '<button id="save" type="button">…</button>');
  assert.doesNotMatch(result.selected.shallowOuterHTML, /span|strong|保存/);
  assert.equal(result.directChildren.length, 1);
  assert.equal(result.directChildren[0].tagName, 'span');
  assert.equal(Object.hasOwn(result.directChildren[0], 'computedStyles'), false);
  assert.equal(Object.hasOwn(result.directChildren[0], 'children'), false);
  assert.equal(result.ancestors.length, 2);
  assert.equal(result.ancestors[0].depth, 1);
  assert.equal(result.ancestors[0].relation, 'parent');
  assert.equal(result.ancestors[0].tagName, 'section');
  assert.equal(result.ancestors[0].computedStyles.layout.display, 'grid');
  assert.equal(result.ancestors[0].shallowOuterHTML, '<section class="panel">…</section>');
  assert.doesNotMatch(result.ancestors[0].shallowOuterHTML, /button|span|strong|保存/);
  assert.equal(Object.hasOwn(result.ancestors[0], 'ancestors'), false);
  assert.equal(result.ancestors[1].depth, 2);
  assert.equal(result.ancestors[1].relation, 'ancestor');
  assert.equal(result.ancestors[1].tagName, 'main');
  assert.deepEqual(result.scope, {
    ancestorLimit: 8,
    ancestorCount: 2,
    directChildCount: 1,
    directChildrenTruncated: false,
    descendantsIncluded: false
  });
});

test('collects basic accessibility semantics, name, description, focus, and ARIA states', () => {
  const label = new MockElement('span', { id: 'save-label' }, { textContent: 'Save changes' });
  const description = new MockElement('span', { id: 'save-help' }, { textContent: 'Applies the current settings' });
  const button = new MockElement('button', {
    'aria-labelledby': 'save-label',
    'aria-describedby': 'save-help',
    'aria-expanded': 'true',
    'aria-pressed': 'false',
    tabindex: '0'
  });
  const elementsById = new Map([
    ['save-label', label],
    ['save-help', description]
  ]);
  const selectorRoot = {
    nodeType: 9,
    querySelectorAll: () => [],
    getElementById: id => elementsById.get(id) || null,
    defaultView: { getComputedStyle: element => element.computedStyle }
  };
  button.selectorRoot = selectorRoot;
  button.ownerDocument = selectorRoot;

  const accessibility = inspector.collectAccessibility(button);
  assert.equal(accessibility.explicitRole, null);
  assert.equal(accessibility.implicitRole, 'button');
  assert.equal(accessibility.role, 'button');
  assert.deepEqual(accessibility.name, {
    value: 'Save changes',
    source: 'aria-labelledby',
    approximate: false
  });
  assert.equal(accessibility.description.value, 'Applies the current settings');
  assert.equal(accessibility.description.source, 'aria-describedby');
  assert.equal(accessibility.focus.focusable, true);
  assert.equal(accessibility.focus.sequentiallyFocusable, true);
  assert.equal(accessibility.focus.tabIndex, 0);
  assert.equal(accessibility.states.expanded, 'true');
  assert.equal(accessibility.states.pressed, 'false');
  assert.equal(accessibility.ariaAttributes['aria-labelledby'], 'save-label');
});

test('collects only inline and DOM0 event information with bounded previews', () => {
  const button = new MockElement('button', {
    onclick: 'saveChanges()',
    onkeydown: 'handleKey(event)'
  });
  button.onclick = function clickHandler() { return 'saved'; };
  button.onchange = function changeHandler() { return 'changed'; };

  const events = inspector.collectEventInfo(button);
  assert.equal(events.hasAny, true);
  assert.deepEqual(events.types, ['change', 'click', 'keydown']);
  assert.equal(events.attributes.length, 2);
  assert.equal(events.attributes[0].type, 'click');
  assert.match(events.properties.find(item => item.type === 'click').preview, /clickHandler/);
  assert.match(events.properties.find(item => item.type === 'change').preview, /changeHandler/);
  assert.equal(events.limitations.length, 2);
  assert.match(events.limitations[0], /addEventListener/);
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
  assert.equal(manifest.name, 'Prismora — Web Element Inspector');
  assert.equal(manifest.version, '0.14.1');
  assert.equal(manifest.action.default_title, 'Prismoraを開く');
  assert.equal(pkg.name, 'prismora-web-element-inspector');
  assert.equal(pkg.version, '0.14.1');
  assert.deepEqual(manifest.icons, {
    16: 'assets/icons/main-icon-16.png',
    32: 'assets/icons/main-icon-32.png',
    48: 'assets/icons/main-icon-48.png',
    128: 'assets/icons/main-icon-128.png'
  });
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['assets/icons/main-icon-48.png']);
  for (const size of [16, 32, 48, 128]) {
    const icon = fs.readFileSync(path.join(root, `assets/icons/main-icon-${size}.png`));
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
  const iconSource = fs.readFileSync(path.join(root, 'assets/icons/main-icon.png'));
  assert.equal(iconSource.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(iconSource.readUInt32BE(16), 256);
  assert.equal(iconSource.readUInt32BE(20), 256);
  assert.equal(
    crypto.createHash('sha256').update(iconSource).digest('hex'),
    'd1938fae57b4065040e551d6ac8b83ee2b92fe86a6d990319513772744448353'
  );
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
  assert.match(background, /command === 'APPLY_EDIT' \|\| command === 'UNDO_EDIT' \|\| command === 'RESET_CURRENT_EDITS'/);
  assert.match(background, /command === 'RESET_ALL_EDITS'/);
  assert.match(background, /command === 'REQUEST_ANCESTOR_EXPORT'/);
  assert.match(background, /targetFrameId/);
  assert.match(background, /historyRestoreFailed: true/);
  assert.match(content, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(content, /chrome\.runtime\.getURL\('assets\/icons\/main-icon-48\.png'\)/);
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
  assert.match(content, /data-tab="styles"/);
  assert.match(content, /data-tab="edit"/);
  assert.match(content, /data-tab="a11y"/);
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
  assert.match(content, /Prismora — Web Element Inspector/);
  assert.match(content, /Web Element Inspector · v\$\{EXTENSION_VERSION\}/);
  assert.match(content, /data-density-option="compact"/);
  assert.match(content, /data-density-option="comfortable"/);
  assert.match(content, /button\.density-option\[data-active="false"\]:hover:not\(:disabled\)/);
  assert.match(content, /button\.density-option\[data-active="true"\]:hover:not\(:disabled\)/);
  assert.match(content, /data-density=/);
  assert.match(content, /function setDensity/);
  assert.match(content, /data-density="comfortable"[^\n]*button\.icon-button/);
  assert.match(content, /history-position/);
  assert.match(content, /Selection history/);
  assert.match(content, /<span>戻る<\/span>/);
  assert.match(content, /<span>進む<\/span>/);
  const commandSurfaceIndex = content.indexOf('<section class="command-surface">');
  const historySurfaceIndex = content.indexOf('<section class="history-surface"');
  const hierarchySurfaceIndex = content.indexOf('<section class="hierarchy-surface">');
  assert.ok(commandSurfaceIndex < historySurfaceIndex && historySurfaceIndex < hierarchySurfaceIndex);
  assert.match(content, /function renderHeaderFrameBadge/);
  assert.match(content, /<span class="frame-pill" hidden><\/span>/);
  assert.match(content, /\.brand-subtitle \{ display: none; \}/);
  assert.match(content, /data-resize-side="left"/);
  assert.match(content, /data-resize-side="right"/);
  assert.match(content, /data-resize-direction="bottom"/);
  assert.match(content, /data-resize-direction="bottom-left"/);
  assert.match(content, /data-resize-direction="bottom-right"/);
  assert.match(content, /MIN_PANEL_HEIGHT = 440/);
  assert.match(content, /function clampPanelHeight/);
  assert.match(content, /function beginPanelResize/);
  assert.match(content, /function resizePanel/);
  assert.match(content, /container: inspector \/ inline-size/);
  assert.match(content, /--ei-spectrum:/);
  assert.match(content, /#20262d/);
  assert.match(content, /#4f8a68/);
  assert.match(content, /Local only · no storage/);
  assert.match(content, /UNIQUE · \$\{scope\}/);
  assert.match(content, /countdownDeadline/);
  assert.match(content, /JSONをコピー/);
  assert.match(content, /JSONを保存/);
  assert.match(content, /data-json-profile="standard"/);
  assert.match(content, /data-json-profile="ancestor-detail"/);
  assert.match(content, /function setJsonProfile/);
  assert.match(content, /function requestAncestorExport/);
  assert.match(content, /function buildAncestorExportSnapshot/);
  assert.match(content, /kind === 'ancestorExport'/);
  assert.match(content, /REQUEST_ANCESTOR_EXPORT/);
  assert.match(content, /prismora-ancestors-/);
  assert.match(content, /Descendants[\s\S]*Excluded/);
  assert.match(content, /beginPanelDrag/);
  assert.match(content, /setPointerCapture/);
  assert.match(content, /releasePointerCapture/);
  assert.match(content, /event\.key !== 'Escape'[\s\S]*sendTopCommand\('DEACTIVATE'\)/);
  assert.match(content, /navigator\.clipboard\?\.writeText/);
  assert.match(content, /URL\.createObjectURL/);
  assert.match(inspectorSource, /generateCssLocator/);
  assert.match(inspectorSource, /generateXPathLocator/);
  assert.match(inspectorSource, /generateJsPath/);
  assert.match(inspectorSource, /shadowRoot\?\.querySelector/);
  assert.match(inspectorSource, /collectShadowContext/);
  assert.match(inspectorSource, /collectComputedStyles/);
  assert.match(inspectorSource, /collectBoxModel/);
  assert.match(content, /Box model/);
  assert.match(content, /data-style-group="layout"/);
  assert.match(content, /data-style-group="flex-grid"/);
  assert.match(content, /data-style-group="typography"/);
  assert.match(content, /data-style-group="custom-properties"/);
  assert.match(content, /data-style-search/);
  assert.match(content, /function openStyleInEdit/);
  assert.match(content, /style-property-badge/);
  assert.match(content, /requested \$\{declaration\.value/);
  assert.match(content, /stylesSearchInput\.addEventListener\('input'/);
  assert.match(inspectorSource, /MAX_CUSTOM_PROPERTIES = 200/);
  assert.match(inspectorSource, /function collectCustomProperties/);
  assert.match(content, /EDITABLE_PROPERTIES/);
  assert.match(content, /adoptedStyleSheets/);
  assert.match(content, /function applyTemporaryEdit/);
  assert.match(content, /function undoTemporaryEdit/);
  assert.match(content, /function resetCurrentTemporaryEdits/);
  assert.match(content, /function resetAllTemporaryEdits/);
  assert.match(content, /data-action="copy-edit-css"/);
  assert.match(content, /既存のstyle属性は変更しません/);
  assert.doesNotMatch(content, /selectedElement\.style\.|record\.element\.style\./);
  assert.match(inspectorSource, /collectAccessibility/);
  assert.match(inspectorSource, /collectEventInfo/);
  assert.match(content, /Limited event information/);
  assert.match(content, /addEventListener\(\)\、React\、Vue/);
  assert.match(inspectorSource, /getNavigationState/);
  assert.doesNotMatch(runtimeSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(runtimeSource, /localStorage|sessionStorage|chrome\.storage/);
});
