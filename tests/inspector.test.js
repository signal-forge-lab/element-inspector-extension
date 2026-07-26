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

  get firstElementChild() {
    return this.children[0] || null;
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

test('manifest and runtime implement the toolbar-driven in-page inspector', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const inspectorSource = fs.readFileSync(path.join(root, 'inspector.js'), 'utf8');
  const runtimeSource = `${background}\n${content}\n${inspectorSource}`;

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.6.0');
  assert.equal(pkg.version, '0.6.0');
  assert.deepEqual(manifest.permissions, ['clipboardWrite']);
  assert.equal(manifest.content_scripts[0].all_frames, undefined);
  assert.doesNotMatch(background, /contextMenus/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(background, /ELEMENT_INSPECTOR_TOGGLE/);
  assert.match(background, /\{ frameId: 0 \}/);
  assert.match(content, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(content, /@property --ei-angle/);
  assert.match(content, /conic-gradient\(from var\(--ei-angle\)/);
  assert.match(content, /ei-rainbow-spin 1\.25s linear infinite/);
  assert.match(content, /selectedElement\?\.parentElement/);
  assert.match(content, /selectedElement\?\.firstElementChild/);
  assert.match(content, /countdownDeadline/);
  assert.match(content, /state\.mode !== 'picking'/);
  assert.match(content, /JSONをコピー/);
  assert.match(content, /JSONを保存/);
  assert.match(content, /beginPanelDrag/);
  assert.match(content, /setPointerCapture/);
  assert.match(content, /releasePointerCapture/);
  assert.match(content, /event\.key === 'Escape'[\s\S]*destroyInspector\(\)/);
  assert.match(content, /if \(state\.open\) destroyInspector\(\)/);
  assert.match(content, /navigator\.clipboard\?\.writeText/);
  assert.match(content, /URL\.createObjectURL/);
  assert.doesNotMatch(runtimeSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(runtimeSource, /localStorage|sessionStorage|chrome\.storage/);
});
