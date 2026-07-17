'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class MockElement {
  constructor(tagName, attributes = {}, options = {}) {
    this.tagName = String(tagName).toUpperCase();
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

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
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
}

global.Element = MockElement;

const root = path.join(__dirname, '..');
const inspector = require(path.join(root, 'inspector.js'));

test('inspects a nested SVG target through its nearest button', () => {
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
  const use = svg.appendChild(new MockElement('use', { href: '/sprite.svg#copy' }));
  svg.appendChild(new MockElement('path', { d: 'M0 0h10v10z' }));
  svg.appendChild(new MockElement('circle', { cx: '5', cy: '5', r: '2' }));

  const result = inspector.inspectElement(use);

  assert.equal(result.selectedTag, 'use');
  assert.equal(result.controlTag, 'button');
  assert.equal(result.controlAttributes['data-testid'], 'sample-button');
  assert.equal(result.text, 'Sample button');
  assert.equal(result.svg.useHref, '/sprite.svg#copy');
  assert.deepEqual(result.svg.paths, ['M0 0h10v10z']);
  assert.deepEqual(result.svg.circles, [{ cx: '5', cy: '5', r: '2' }]);
  assert.equal(result.ancestors.length, 2);
  assert.deepEqual(result.ancestors[0].rect, { top: 12, left: 25, width: 40, height: 33 });
  assert.equal(result.ancestors[1].display, 'flex');
});

test('uses the selected element when no actionable ancestor exists', () => {
  const div = new MockElement('div', { 'data-state': 'open' }, { textContent: 'Plain content' });
  const result = inspector.inspectElement(div);
  assert.equal(result.selectedTag, 'div');
  assert.equal(result.controlTag, 'div');
  assert.equal(result.svg, null);
});

test('limits outerHTML to 5000 characters by default', () => {
  const div = new MockElement('div', {}, { outerHTML: 'x'.repeat(7000) });
  const result = inspector.inspectElement(div);
  assert.equal(result.outerHTML.length, 5000);
});

test('rejects a missing DOM element', () => {
  assert.throws(() => inspector.inspectElement(null), /右クリックした要素を取得できません/);
});

test('manifest and runtime wiring remain narrow and frame-aware', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const inspectorSource = fs.readFileSync(path.join(root, 'inspector.js'), 'utf8');
  const iconPath = path.join(root, 'assets', 'icons', 'main-icon.png');
  const contextMenuIcon16Path = path.join(root, 'assets', 'icons', 'context-menu-icon-16.png');
  const contextMenuIcon32Path = path.join(root, 'assets', 'icons', 'context-menu-icon-32.png');
  const icon = fs.readFileSync(iconPath);
  const contextMenuIcon16 = fs.readFileSync(contextMenuIcon16Path);
  const contextMenuIcon32 = fs.readFileSync(contextMenuIcon32Path);
  const runtimeSource = `${background}\n${content}\n${inspectorSource}`;

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.5.0');
  assert.deepEqual(manifest.permissions.sort(), ['clipboardWrite', 'contextMenus']);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.deepEqual(manifest.content_scripts[0].js, ['inspector.js', 'content.js']);
  assert.deepEqual(manifest.icons, {
    16: 'assets/icons/context-menu-icon-16.png',
    32: 'assets/icons/context-menu-icon-32.png',
    48: 'assets/icons/main-icon.png',
    128: 'assets/icons/main-icon.png'
  });
  assert.deepEqual(new Set(Object.values(manifest.action.default_icon)), new Set(['assets/icons/main-icon.png']));
  assert.equal(manifest.action.default_title, 'Element Inspector');
  assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(icon.readUInt32BE(16), 128);
  assert.equal(icon.readUInt32BE(20), 128);
  assert.deepEqual(contextMenuIcon16.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(contextMenuIcon16.readUInt32BE(16), 16);
  assert.equal(contextMenuIcon16.readUInt32BE(20), 16);
  assert.deepEqual(contextMenuIcon32.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(contextMenuIcon32.readUInt32BE(16), 32);
  assert.equal(contextMenuIcon32.readUInt32BE(20), 32);
  assert.match(background, /\{ frameId \}/);
  assert.match(content, /document\.addEventListener\('contextmenu'/);
  assert.match(content, /navigator\.clipboard\?\.writeText/);
  assert.match(content, /document\.execCommand\?\.\('copy'\)/);
  assert.match(content, /lastContextMenuTarget\.isConnected/);
  assert.match(content, /HIGHLIGHT_DURATION_MS = 3000/);
  assert.match(content, /showElementHighlight\(lastContextMenuTarget\)/);
  assert.match(content, /requestAnimationFrame\(updatePosition\)/);
  assert.match(content, /setTimeout\(removeHighlight, durationMs \+ 150\)/);
  assert.match(content, /border: 3px solid #fff/);
  assert.match(content, /0 0 0 3px #000/);
  assert.match(content, /@keyframes element-inspector-highlight-pulse/);
  assert.match(content, /100% \{\s*opacity: 0;/);
  assert.match(content, /animation: element-inspector-highlight-pulse \$\{durationMs\}ms ease-in-out forwards/);
  assert.match(content, /marker\.addEventListener\('animationend', removeHighlight/);
  assert.doesNotMatch(content, /element\.style\./);
  assert.doesNotMatch(runtimeSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(runtimeSource, /localStorage|sessionStorage|chrome\.storage/);
});
