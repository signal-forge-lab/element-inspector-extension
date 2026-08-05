(() => {
  'use strict';

  const CONTROL_SELECTOR = 'button, [role="button"], a, [tabindex]';
  const DEFAULT_MAX_ANCESTOR_DEPTH = 8;
  const DEFAULT_MAX_OUTER_HTML_LENGTH = 5000;
  const MAX_SELECTOR_DEPTH = 12;
  const MAX_CHILD_SUMMARIES = 80;
  const MAX_EVENT_HANDLER_PREVIEW = 320;
  const MAX_CUSTOM_PROPERTIES = 200;
  const VOID_ELEMENT_NAMES = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);
  const DOM0_EVENT_PROPERTIES = Object.freeze([
    'onclick', 'ondblclick', 'oncontextmenu',
    'oninput', 'onchange', 'onsubmit', 'onreset',
    'onkeydown', 'onkeyup', 'onkeypress',
    'onpointerdown', 'onpointerup', 'onpointermove', 'onpointerenter', 'onpointerleave',
    'onmousedown', 'onmouseup', 'onmousemove', 'onmouseenter', 'onmouseleave',
    'onfocus', 'onblur', 'onfocusin', 'onfocusout',
    'ontouchstart', 'ontouchmove', 'ontouchend',
    'ondragstart', 'ondragend', 'ondragover', 'ondrop',
    'onwheel'
  ]);
  const COMPUTED_STYLE_GROUPS = Object.freeze({
    layout: [
      'display', 'position', 'box-sizing', 'width', 'height',
      'min-width', 'max-width', 'min-height', 'max-height',
      'overflow', 'overflow-x', 'overflow-y', 'z-index',
      'visibility', 'opacity'
    ],
    flexGrid: [
      'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
      'align-content', 'gap', 'row-gap', 'column-gap',
      'grid-template-columns', 'grid-template-rows', 'grid-auto-flow',
      'place-items'
    ],
    typography: [
      'font-family', 'font-size', 'font-weight', 'font-style',
      'line-height', 'letter-spacing', 'text-align', 'text-decoration-line',
      'text-transform', 'white-space', 'word-break', 'color'
    ]
  });

  function isDomElement(value) {
    return typeof Element !== 'undefined' && value instanceof Element;
  }

  function attributesToObject(element) {
    return Object.fromEntries(
      Array.from(element?.attributes || []).map(attribute => [
        attribute.name,
        attribute.value
      ])
    );
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function booleanAttributeState(element, attributeName, propertyName = attributeName) {
    if (!isDomElement(element)) return false;
    if (typeof element[propertyName] === 'boolean') return element[propertyName];
    return element.hasAttribute?.(attributeName) || false;
  }

  function ariaValue(element, name) {
    const value = element.getAttribute?.(`aria-${name}`);
    return value == null || value === '' ? null : value;
  }

  function resolveReferenceById(element, id) {
    const root = element.getRootNode?.();
    if (typeof root?.getElementById === 'function') return root.getElementById(id);
    if (typeof element.ownerDocument?.getElementById === 'function') {
      return element.ownerDocument.getElementById(id);
    }
    if (typeof root?.querySelector === 'function') {
      try {
        return root.querySelector(`#${cssEscapeIdentifier(id)}`);
      } catch {}
    }
    return null;
  }

  function textFromIdReferences(element, attributeName) {
    const ids = String(element.getAttribute?.(attributeName) || '').trim().split(/\s+/).filter(Boolean);
    return ids
      .map(id => normalizeText(resolveReferenceById(element, id)?.textContent))
      .filter(Boolean)
      .join(' ');
  }

  function associatedLabelTexts(element) {
    const labels = [];
    for (const label of Array.from(element.labels || [])) {
      const text = normalizeText(label?.textContent);
      if (text && !labels.includes(text)) labels.push(text);
    }

    const closestLabel = element.closest?.('label');
    const closestText = normalizeText(closestLabel?.textContent);
    if (closestText && !labels.includes(closestText)) labels.push(closestText);

    if (element.id) {
      const root = element.getRootNode?.();
      if (root?.querySelectorAll) {
        try {
          const selector = `label[for="${cssEscapeString(element.id)}"]`;
          for (const label of Array.from(root.querySelectorAll(selector))) {
            const text = normalizeText(label.textContent);
            if (text && !labels.includes(text)) labels.push(text);
          }
        } catch {}
      }
    }
    return labels;
  }

  function inferImplicitRole(element) {
    if (!isDomElement(element)) return null;
    const tagName = getTagName(element);
    if ((tagName === 'a' || tagName === 'area') && element.hasAttribute?.('href')) return 'link';
    if (tagName === 'button') return 'button';
    if (tagName === 'textarea') return 'textbox';
    if (tagName === 'select') {
      const size = Number.parseInt(element.getAttribute?.('size') || '0', 10);
      return booleanAttributeState(element, 'multiple') || size > 1 ? 'listbox' : 'combobox';
    }
    if (tagName === 'input') {
      const type = String(element.getAttribute?.('type') || 'text').toLowerCase();
      const roles = {
        button: 'button', submit: 'button', reset: 'button', image: 'button',
        checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
        search: 'searchbox', email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox'
      };
      return roles[type] || null;
    }
    const roles = {
      nav: 'navigation', main: 'main', aside: 'complementary',
      header: 'banner', footer: 'contentinfo', article: 'article',
      dialog: 'dialog', table: 'table', tr: 'row', td: 'cell',
      ul: 'list', ol: 'list', li: 'listitem', summary: 'button',
      progress: 'progressbar', meter: 'meter', option: 'option'
    };
    if (roles[tagName]) return roles[tagName];
    if (/^h[1-6]$/.test(tagName)) return 'heading';
    if (tagName === 'th') {
      return String(element.getAttribute?.('scope') || '').toLowerCase() === 'row'
        ? 'rowheader'
        : 'columnheader';
    }
    if (tagName === 'img' && element.getAttribute?.('alt') !== '') return 'img';
    return null;
  }

  function estimateAccessibleName(element, role) {
    const labelledBy = textFromIdReferences(element, 'aria-labelledby');
    if (labelledBy) return { value: labelledBy, source: 'aria-labelledby', approximate: false };

    const ariaLabel = normalizeText(element.getAttribute?.('aria-label'));
    if (ariaLabel) return { value: ariaLabel, source: 'aria-label', approximate: false };

    const labels = associatedLabelTexts(element);
    if (labels.length) return { value: labels.join(' '), source: 'label', approximate: false };

    const tagName = getTagName(element);
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    if (tagName === 'img' || tagName === 'area' || (tagName === 'input' && type === 'image')) {
      const alt = normalizeText(element.getAttribute?.('alt'));
      if (alt) return { value: alt, source: 'alt', approximate: false };
    }
    if (tagName === 'input' && ['button', 'submit', 'reset'].includes(type)) {
      const value = normalizeText(element.getAttribute?.('value') || element.value);
      if (value) return { value, source: 'value', approximate: false };
    }

    const nameFromContentRoles = new Set([
      'button', 'link', 'menuitem', 'option', 'tab', 'treeitem',
      'heading', 'checkbox', 'radio', 'switch'
    ]);
    if (nameFromContentRoles.has(role) || ['button', 'a', 'summary', 'option'].includes(tagName)) {
      const text = normalizeText(element.textContent);
      if (text) return { value: text, source: 'contents', approximate: true };
    }

    const title = normalizeText(element.getAttribute?.('title'));
    if (title) return { value: title, source: 'title', approximate: true };

    const placeholder = normalizeText(element.getAttribute?.('placeholder'));
    if (placeholder) return { value: placeholder, source: 'placeholder-fallback', approximate: true };

    return { value: '', source: 'none', approximate: true };
  }

  function collectAriaAttributes(element) {
    return Object.fromEntries(
      Array.from(element.attributes || [])
        .filter(attribute => attribute.name.startsWith('aria-'))
        .map(attribute => [attribute.name, attribute.value])
    );
  }

  function isNativeFocusable(element) {
    const tagName = getTagName(element);
    if (['button', 'select', 'textarea', 'iframe', 'object', 'summary'].includes(tagName)) return true;
    if ((tagName === 'a' || tagName === 'area') && element.hasAttribute?.('href')) return true;
    if (tagName === 'input') return String(element.getAttribute?.('type') || '').toLowerCase() !== 'hidden';
    if (element.hasAttribute?.('contenteditable')) return element.getAttribute('contenteditable') !== 'false';
    return false;
  }

  function collectAccessibility(element) {
    if (!isDomElement(element)) return null;
    const explicitRole = normalizeText(element.getAttribute?.('role')) || null;
    const implicitRole = inferImplicitRole(element);
    const role = explicitRole || implicitRole;
    const name = estimateAccessibleName(element, role);
    const describedBy = textFromIdReferences(element, 'aria-describedby');
    const ariaDescription = normalizeText(element.getAttribute?.('aria-description'));
    const title = normalizeText(element.getAttribute?.('title'));
    const labels = associatedLabelTexts(element);
    const style = getComputedStyleForElement(element);
    const hidden =
      element.hasAttribute?.('hidden') ||
      ariaValue(element, 'hidden') === 'true' ||
      readComputedStyleValue(style, 'display') === 'none' ||
      readComputedStyleValue(style, 'visibility') === 'hidden';
    const disabled = booleanAttributeState(element, 'disabled') || ariaValue(element, 'disabled') === 'true';
    const tabIndexAttribute = element.getAttribute?.('tabindex');
    const parsedTabIndex = tabIndexAttribute == null ? null : Number.parseInt(tabIndexAttribute, 10);
    const nativeFocusable = isNativeFocusable(element);
    const focusable = !hidden && !disabled && (nativeFocusable || Number.isInteger(parsedTabIndex));
    const sequentiallyFocusable = focusable && (parsedTabIndex == null || parsedTabIndex >= 0);
    const tagName = getTagName(element);
    const headingLevel = /^h[1-6]$/.test(tagName)
      ? Number.parseInt(tagName.slice(1), 10)
      : Number.parseInt(ariaValue(element, 'level') || '', 10) || null;

    return {
      explicitRole,
      implicitRole,
      role,
      name,
      description: {
        value: describedBy || ariaDescription || title || '',
        source: describedBy ? 'aria-describedby' : ariaDescription ? 'aria-description' : title ? 'title' : 'none',
        approximate: !describedBy && !ariaDescription
      },
      labels,
      headingLevel,
      focus: {
        focusable,
        sequentiallyFocusable,
        nativeFocusable,
        tabIndex: Number.isInteger(parsedTabIndex) ? parsedTabIndex : nativeFocusable ? 0 : null,
        contentEditable: element.hasAttribute?.('contenteditable') && element.getAttribute('contenteditable') !== 'false'
      },
      states: {
        hidden,
        disabled,
        required: booleanAttributeState(element, 'required') || ariaValue(element, 'required') === 'true',
        readOnly: booleanAttributeState(element, 'readonly', 'readOnly') || ariaValue(element, 'readonly') === 'true',
        checked: typeof element.checked === 'boolean' ? element.checked : ariaValue(element, 'checked'),
        selected: typeof element.selected === 'boolean' ? element.selected : ariaValue(element, 'selected'),
        expanded: ariaValue(element, 'expanded'),
        pressed: ariaValue(element, 'pressed'),
        invalid: ariaValue(element, 'invalid'),
        current: ariaValue(element, 'current'),
        busy: ariaValue(element, 'busy')
      },
      ariaAttributes: collectAriaAttributes(element)
    };
  }

  function previewHandler(value) {
    const text = typeof value === 'function' ? Function.prototype.toString.call(value) : String(value || '');
    const normalized = text.trim();
    return normalized.length > MAX_EVENT_HANDLER_PREVIEW
      ? `${normalized.slice(0, MAX_EVENT_HANDLER_PREVIEW - 1)}…`
      : normalized;
  }

  function collectEventInfo(element) {
    if (!isDomElement(element)) return null;
    const attributes = [];
    for (const attribute of Array.from(element.attributes || [])) {
      if (!/^on[a-z]+$/i.test(attribute.name)) continue;
      attributes.push({
        type: attribute.name.slice(2).toLowerCase(),
        name: attribute.name.toLowerCase(),
        preview: previewHandler(attribute.value)
      });
    }

    const properties = [];
    for (const property of DOM0_EVENT_PROPERTIES) {
      let handler = null;
      try {
        handler = element[property];
      } catch {}
      if (typeof handler !== 'function') continue;
      properties.push({
        type: property.slice(2),
        name: property,
        preview: previewHandler(handler)
      });
    }

    const types = Array.from(new Set([
      ...attributes.map(item => item.type),
      ...properties.map(item => item.type)
    ])).sort();

    return {
      hasAny: types.length > 0,
      types,
      attributes,
      properties,
      limitations: [
        'addEventListener()で登録されたリスナーは取得しません。',
        'ReactやVueなどフレームワーク内部のイベントは取得しません。'
      ]
    };
  }

  function getComputedStyleForElement(element) {
    const view = element?.ownerDocument?.defaultView;
    if (view?.getComputedStyle) return view.getComputedStyle(element);
    if (typeof globalThis.getComputedStyle === 'function') return globalThis.getComputedStyle(element);
    return { display: '', visibility: '', position: '' };
  }

  function cssPropertyToCamelCase(property) {
    return String(property).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
  }

  function readComputedStyleValue(style, property) {
    if (!style) return '';
    const direct = style.getPropertyValue?.(property);
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const camelCase = cssPropertyToCamelCase(property);
    const value = style[camelCase] ?? style[property];
    return value == null ? '' : String(value).trim();
  }

  function roundMetric(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function pixelValue(value) {
    const parsed = Number.parseFloat(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function collectSideValues(style, prefix, suffix = '') {
    const result = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      result[side] = readComputedStyleValue(style, `${prefix}-${side}${suffix}`) || '0px';
    }
    return result;
  }

  function collectCustomProperties(style) {
    const propertyNames = [];
    const length = Number.isFinite(style?.length) ? Math.max(0, style.length) : 0;
    for (let index = 0; index < length; index += 1) {
      const property = String(style.item?.(index) || style[index] || '');
      if (property.startsWith('--')) propertyNames.push(property);
    }
    const uniqueNames = Array.from(new Set(propertyNames)).sort();
    const visibleNames = uniqueNames.slice(0, MAX_CUSTOM_PROPERTIES);
    return {
      values: Object.fromEntries(visibleNames.map(property => [
        property,
        readComputedStyleValue(style, property) || '—'
      ])),
      total: uniqueNames.length,
      truncated: uniqueNames.length > MAX_CUSTOM_PROPERTIES,
      limit: MAX_CUSTOM_PROPERTIES
    };
  }

  function collectComputedStyles(element) {
    const style = getComputedStyleForElement(element);
    const result = {};
    for (const [group, properties] of Object.entries(COMPUTED_STYLE_GROUPS)) {
      result[group] = Object.fromEntries(properties.map(property => [
        property,
        readComputedStyleValue(style, property) || '—'
      ]));
    }
    const customProperties = collectCustomProperties(style);
    result.customProperties = customProperties.values;
    result.customPropertiesMeta = {
      total: customProperties.total,
      truncated: customProperties.truncated,
      limit: customProperties.limit
    };
    return result;
  }

  function collectBoxModel(element) {
    const style = getComputedStyleForElement(element);
    const rect = element.getBoundingClientRect();
    const margin = collectSideValues(style, 'margin');
    const border = collectSideValues(style, 'border', '-width');
    const padding = collectSideValues(style, 'padding');
    const horizontalInset =
      pixelValue(border.left) + pixelValue(border.right) +
      pixelValue(padding.left) + pixelValue(padding.right);
    const verticalInset =
      pixelValue(border.top) + pixelValue(border.bottom) +
      pixelValue(padding.top) + pixelValue(padding.bottom);

    return {
      boxSizing: readComputedStyleValue(style, 'box-sizing') || 'content-box',
      margin,
      border,
      padding,
      content: {
        width: roundMetric(Math.max(0, rect.width - horizontalInset)),
        height: roundMetric(Math.max(0, rect.height - verticalInset))
      },
      borderBox: {
        width: roundMetric(rect.width),
        height: roundMetric(rect.height)
      },
      scroll: {
        width: Number.isFinite(element.scrollWidth) ? element.scrollWidth : null,
        height: Number.isFinite(element.scrollHeight) ? element.scrollHeight : null
      }
    };
  }

  function getRoundedRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function getTagName(element) {
    return element.localName || element.tagName?.toLowerCase() || 'element';
  }

  function isOpenShadowRoot(root) {
    return Boolean(root && root.nodeType === 11 && root.host && root.mode !== 'closed');
  }

  function getComposedParent(element) {
    if (!isDomElement(element)) return null;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.();
    return isOpenShadowRoot(root) && isDomElement(root.host) ? root.host : null;
  }

  function getSiblingElements(element) {
    if (!isDomElement(element)) return [];
    if (element.parentElement) return Array.from(element.parentElement.children || []).filter(isDomElement);
    const root = element.getRootNode?.();
    if (isOpenShadowRoot(root)) return Array.from(root.children || []).filter(isDomElement);
    return [element];
  }

  function getNavigableChildren(element) {
    if (!isDomElement(element)) return [];
    const children = [];
    const shadowRoot = element.shadowRoot;
    if (isOpenShadowRoot(shadowRoot)) {
      for (const child of Array.from(shadowRoot.children || []).filter(isDomElement)) {
        children.push({ element: child, treeScope: 'shadow' });
      }
    }
    for (const child of Array.from(element.children || []).filter(isDomElement)) {
      children.push({ element: child, treeScope: 'light' });
    }
    return children;
  }

  function collectShadowContext(element) {
    if (!isDomElement(element)) return { inside: false, depth: 0, hosts: [] };
    const hosts = [];
    let current = element;
    let root = current.getRootNode?.();

    while (isOpenShadowRoot(root)) {
      const host = root.host;
      const locator = generateCssLocator(host);
      hosts.unshift({
        tagName: getTagName(host),
        attributes: attributesToObject(host),
        cssSelector: locator.value,
        label: summarizeElement(host)?.label || `<${getTagName(host)}>`
      });
      current = host;
      root = current.getRootNode?.();
    }

    return {
      inside: hosts.length > 0,
      depth: hosts.length,
      hosts
    };
  }

  function findControlElement(selected) {
    let current = selected;
    while (isDomElement(current)) {
      const control = current.closest?.(CONTROL_SELECTOR);
      if (control) return control;
      const root = current.getRootNode?.();
      current = isOpenShadowRoot(root) ? root.host : null;
    }
    return selected;
  }

  function findFirstSvg(control) {
    return control.matches?.('svg') ? control : control.querySelector?.('svg') || null;
  }

  function collectAncestors(selected, maxDepth) {
    const ancestors = [];
    let current = selected;

    for (let depth = 0; current && depth < maxDepth; depth += 1) {
      const style = getComputedStyleForElement(current);
      ancestors.push({
        depth,
        tagName: getTagName(current),
        attributes: attributesToObject(current),
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        rect: getRoundedRect(current)
      });
      current = getComposedParent(current);
    }

    return ancestors;
  }

  function escapeHtmlAttribute(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function createShallowOuterHTML(element) {
    if (!isDomElement(element)) return '';
    const tagName = getTagName(element);
    const attributes = Array.from(element.attributes || [])
      .map(attribute => ` ${attribute.name}="${escapeHtmlAttribute(attribute.value)}"`)
      .join('');
    const openingTag = `<${tagName}${attributes}>`;
    return VOID_ELEMENT_NAMES.has(tagName)
      ? openingTag
      : `${openingTag}…</${tagName}>`;
  }

  function inspectElementDetail(element) {
    if (!isDomElement(element)) throw new Error('対象要素を取得できません');
    const css = generateCssLocator(element);
    const xpath = generateXPathLocator(element);
    return {
      tagName: getTagName(element),
      attributes: attributesToObject(element),
      text: normalizeText(element.textContent),
      rect: getRoundedRect(element),
      shallowOuterHTML: createShallowOuterHTML(element),
      locators: {
        css,
        xpath,
        jsPath: generateJsPath(element, css)
      },
      computedStyles: collectComputedStyles(element),
      boxModel: collectBoxModel(element),
      accessibility: collectAccessibility(element),
      events: collectEventInfo(element),
      shadow: collectShadowContext(element)
    };
  }

  function buildAncestorExport(selected, options = {}) {
    if (!isDomElement(selected)) throw new Error('対象要素を取得できません');
    const ancestorLimit = Number.isInteger(options.maxAncestorDepth)
      ? Math.max(1, options.maxAncestorDepth)
      : DEFAULT_MAX_ANCESTOR_DEPTH;
    const navigation = getNavigationState(selected);
    const ancestors = [];
    let current = getComposedParent(selected);

    for (let depth = 1; current && depth <= ancestorLimit; depth += 1) {
      ancestors.push({
        depth,
        relation: depth === 1 ? 'parent' : 'ancestor',
        ...inspectElementDetail(current)
      });
      current = getComposedParent(current);
    }

    return {
      exportProfile: 'ancestor-detail',
      selected: inspectElementDetail(selected),
      directChildren: navigation.children,
      ancestors,
      scope: {
        ancestorLimit,
        ancestorCount: ancestors.length,
        directChildCount: navigation.childCount,
        directChildrenTruncated: navigation.childrenTruncated,
        descendantsIncluded: false
      }
    };
  }

  function cssEscapeIdentifier(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
    return String(value)
      .replace(/^(-?\d)/, '\\3$1 ')
      .replace(/[^a-zA-Z0-9_-]/g, character => `\\${character.codePointAt(0).toString(16)} `);
  }

  function cssEscapeString(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\d ')
      .replace(/\n/g, '\\a ');
  }

  function getSelectorRoot(element) {
    const root = element.getRootNode?.();
    if (root?.querySelectorAll) return root;
    return element.ownerDocument || globalThis.document || null;
  }

  function selectorScope(root) {
    return root?.nodeType === 11 ? 'shadow-root' : 'document';
  }

  function countSelectorMatches(root, selector) {
    if (!root?.querySelectorAll || !selector) return 0;
    try {
      return root.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  function isGeneratedClassName(value) {
    const className = String(value || '');
    if (!className || className.length > 64) return true;
    if (/^(css|sc|jsx|jss|emotion)-/i.test(className)) return true;
    if (/^_[a-z0-9]{5,}_[a-z0-9]+$/i.test(className)) return true;
    if (/^[a-z_-]*[0-9a-f]{7,}$/i.test(className)) return true;
    return false;
  }

  function getStableClasses(element) {
    return Array.from(element.classList || [])
      .filter(className => !isGeneratedClassName(className))
      .slice(0, 3);
  }

  function uniqueCssCandidate(root, selector) {
    const matchCount = countSelectorMatches(root, selector);
    return matchCount === 1 ? { value: selector, matchCount } : null;
  }

  function buildCssPath(element, root) {
    const segments = [];
    let current = element;

    for (let depth = 0; current && depth < MAX_SELECTOR_DEPTH; depth += 1) {
      const tagName = getTagName(current);
      let segment = tagName;

      if (current.id) {
        segment += `#${cssEscapeIdentifier(current.id)}`;
      } else {
        const stableClasses = getStableClasses(current);
        if (stableClasses.length) {
          segment += stableClasses.map(className => `.${cssEscapeIdentifier(className)}`).join('');
        }

        const parent = current.parentElement;
        if (parent) {
          const sameTagSiblings = Array.from(parent.children || [])
            .filter(sibling => getTagName(sibling) === tagName);
          if (sameTagSiblings.length > 1) {
            segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
          }
        }
      }

      segments.unshift(segment);
      const selector = segments.join(' > ');
      if (countSelectorMatches(root, selector) === 1) return selector;

      current = current.parentElement;
      if (current && getSelectorRoot(current) !== root) break;
    }

    return segments.join(' > ');
  }

  function generateCssLocator(element) {
    if (!isDomElement(element)) return { value: null, matchCount: 0, unique: false, scope: 'unknown' };
    const root = getSelectorRoot(element);
    const scope = selectorScope(root);
    const tagName = getTagName(element);

    if (element.id) {
      const result = uniqueCssCandidate(root, `#${cssEscapeIdentifier(element.id)}`);
      if (result) return { ...result, unique: true, scope };
    }

    for (const attributeName of ['data-testid', 'data-test', 'data-qa', 'aria-label', 'name', 'title', 'alt']) {
      const value = element.getAttribute?.(attributeName);
      if (!value) continue;
      const selector = `[${attributeName}="${cssEscapeString(value)}"]`;
      const result = uniqueCssCandidate(root, selector) || uniqueCssCandidate(root, `${tagName}${selector}`);
      if (result) return { ...result, unique: true, scope };
    }

    const stableClasses = getStableClasses(element);
    if (stableClasses.length) {
      const selector = `${tagName}${stableClasses.map(className => `.${cssEscapeIdentifier(className)}`).join('')}`;
      const result = uniqueCssCandidate(root, selector);
      if (result) return { ...result, unique: true, scope };
    }

    for (const attributeName of ['role', 'type', 'value', 'placeholder']) {
      const value = element.getAttribute?.(attributeName);
      if (!value) continue;
      const selector = `${tagName}[${attributeName}="${cssEscapeString(value)}"]`;
      const result = uniqueCssCandidate(root, selector);
      if (result) return { ...result, unique: true, scope };
    }

    const value = buildCssPath(element, root);
    const matchCount = countSelectorMatches(root, value);
    return {
      value: value || tagName,
      matchCount,
      unique: matchCount === 1,
      scope
    };
  }

  function xpathLiteral(value) {
    const stringValue = String(value);
    if (!stringValue.includes("'")) return `'${stringValue}'`;
    if (!stringValue.includes('"')) return `"${stringValue}"`;
    const pieces = stringValue.split("'");
    return `concat(${pieces.map((piece, index) => {
      const suffix = index < pieces.length - 1 ? ', "\'", ' : '';
      return `'${piece}'${suffix}`;
    }).join('')})`;
  }

  function countXPathMatches(documentNode, xpath) {
    if (!documentNode?.evaluate || !xpath) return 0;
    const XPathResultCtor = documentNode.defaultView?.XPathResult || globalThis.XPathResult;
    if (!XPathResultCtor) return 0;
    try {
      const result = documentNode.evaluate(
        xpath,
        documentNode,
        null,
        XPathResultCtor.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      return result.snapshotLength;
    } catch {
      return 0;
    }
  }

  function xpathNodeTest(element) {
    const tagName = getTagName(element);
    const namespace = element.namespaceURI || '';
    if (namespace && !namespace.includes('xhtml')) {
      return `*[local-name()=${xpathLiteral(tagName)}]`;
    }
    return tagName;
  }

  function buildAbsoluteXPath(element) {
    const parts = [];
    let current = element;

    while (current && isDomElement(current)) {
      const nodeTest = xpathNodeTest(current);
      const parent = current.parentElement;
      let position = 1;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children || [])
          .filter(sibling => getTagName(sibling) === getTagName(current));
        position = sameTagSiblings.indexOf(current) + 1;
      }
      parts.unshift(`${nodeTest}[${Math.max(1, position)}]`);
      current = parent;
    }

    return `/${parts.join('/')}`;
  }

  function generateXPathLocator(element) {
    if (!isDomElement(element)) return { value: null, matchCount: 0, unique: false, scope: 'unknown' };
    const root = getSelectorRoot(element);
    if (selectorScope(root) === 'shadow-root') {
      return { value: null, matchCount: 0, unique: false, scope: 'shadow-root', unsupported: true };
    }

    const documentNode = element.ownerDocument || root;
    for (const [attributeName, value] of [
      ['id', element.id],
      ['data-testid', element.getAttribute?.('data-testid')],
      ['data-test', element.getAttribute?.('data-test')],
      ['data-qa', element.getAttribute?.('data-qa')],
      ['aria-label', element.getAttribute?.('aria-label')],
      ['name', element.getAttribute?.('name')]
    ]) {
      if (!value) continue;
      const xpath = `//*[@${attributeName}=${xpathLiteral(value)}]`;
      const matchCount = countXPathMatches(documentNode, xpath);
      if (matchCount === 1) return { value: xpath, matchCount, unique: true, scope: 'document' };
    }

    const value = buildAbsoluteXPath(element);
    const matchCount = countXPathMatches(documentNode, value);
    return { value, matchCount, unique: matchCount === 1, scope: 'document' };
  }

  function generateJsPath(element, cssLocator = generateCssLocator(element)) {
    if (!cssLocator?.value) return { value: null, scope: cssLocator?.scope || 'unknown' };
    if (cssLocator.scope === 'shadow-root') {
      const segments = [];
      let current = element;
      let root = current.getRootNode?.();

      while (isOpenShadowRoot(root)) {
        const currentLocator = generateCssLocator(current);
        if (!currentLocator.value) {
          return { value: null, scope: 'shadow-chain', unsupported: true };
        }
        segments.unshift(currentLocator.value);
        current = root.host;
        root = current.getRootNode?.();
      }

      const hostLocator = generateCssLocator(current);
      if (!hostLocator.value) {
        return { value: null, scope: 'shadow-chain', unsupported: true };
      }
      segments.unshift(hostLocator.value);

      let value = `document.querySelector(${JSON.stringify(segments[0])})`;
      for (const selector of segments.slice(1)) {
        value += `?.shadowRoot?.querySelector(${JSON.stringify(selector)})`;
      }
      return {
        value,
        scope: 'shadow-chain',
        shadowDepth: segments.length - 1,
        segments
      };
    }
    return {
      value: `document.querySelector(${JSON.stringify(cssLocator.value)})`,
      scope: cssLocator.scope
    };
  }

  function summarizeElement(element, index = null) {
    if (!isDomElement(element)) return null;
    const classes = getStableClasses(element).slice(0, 2);
    const tagName = getTagName(element);
    const idText = element.id ? `#${element.id}` : '';
    const classText = classes.length ? `.${classes.join('.')}` : '';
    const text = normalizeText(element.textContent).slice(0, 48);
    return {
      index,
      tagName,
      id: element.id || null,
      classes,
      text,
      label: `<${tagName}${idText}${classText}>${text ? ` ${text}` : ''}`
    };
  }

  function getNavigationState(element) {
    if (!isDomElement(element)) {
      return {
        hasParent: false,
        hasPreviousSibling: false,
        hasNextSibling: false,
        childCount: 0,
        siblingIndex: 0,
        siblingCount: 0,
        children: []
      };
    }

    const parent = getComposedParent(element);
    const siblings = getSiblingElements(element);
    const children = getNavigableChildren(element);
    const siblingIndex = Math.max(0, siblings.indexOf(element));
    const crossesShadowBoundary = !element.parentElement && Boolean(parent);

    return {
      hasParent: Boolean(parent),
      parentCrossesShadowBoundary: crossesShadowBoundary,
      hasPreviousSibling: siblingIndex > 0,
      hasNextSibling: siblingIndex >= 0 && siblingIndex < siblings.length - 1,
      childCount: children.length,
      siblingIndex,
      siblingCount: siblings.length,
      childrenTruncated: children.length > MAX_CHILD_SUMMARIES,
      children: children.slice(0, MAX_CHILD_SUMMARIES).map((item, index) => ({
        ...summarizeElement(item.element, index),
        treeScope: item.treeScope
      }))
    };
  }

  function inspectElement(selected, options = {}) {
    if (!isDomElement(selected)) {
      throw new Error('対象要素を取得できません');
    }

    const maxAncestorDepth = Number.isInteger(options.maxAncestorDepth)
      ? Math.max(1, options.maxAncestorDepth)
      : DEFAULT_MAX_ANCESTOR_DEPTH;
    const maxOuterHtmlLength = Number.isInteger(options.maxOuterHtmlLength)
      ? Math.max(0, options.maxOuterHtmlLength)
      : DEFAULT_MAX_OUTER_HTML_LENGTH;

    const control = findControlElement(selected);
    const svg = findFirstSvg(control);
    const use = svg?.querySelector?.('use') || null;
    const css = generateCssLocator(selected);
    const xpath = generateXPathLocator(selected);

    return {
      selectedTag: getTagName(selected),
      selectedAttributes: attributesToObject(selected),
      selectedText: normalizeText(selected.textContent),
      selectedRect: getRoundedRect(selected),
      selectedOuterHTML: String(selected.outerHTML || '').slice(0, maxOuterHtmlLength),

      controlTag: getTagName(control),
      controlAttributes: attributesToObject(control),
      controlRect: getRoundedRect(control),

      text: normalizeText(control.textContent),

      locators: {
        css,
        xpath,
        jsPath: generateJsPath(selected, css)
      },

      navigation: getNavigationState(selected),

      shadow: collectShadowContext(selected),

      computedStyles: collectComputedStyles(selected),

      boxModel: collectBoxModel(selected),

      accessibility: collectAccessibility(selected),

      events: collectEventInfo(selected),

      svg: svg
        ? {
            attributes: attributesToObject(svg),
            useHref:
              use?.getAttribute?.('href') ||
              use?.getAttribute?.('xlink:href') ||
              null,
            paths: Array.from(svg.querySelectorAll?.('path') || []).map(path =>
              path.getAttribute?.('d') || null
            ),
            circles: Array.from(svg.querySelectorAll?.('circle') || []).map(circle =>
              attributesToObject(circle)
            )
          }
        : null,

      ancestors: collectAncestors(selected, maxAncestorDepth),
      outerHTML: String(control.outerHTML || '').slice(0, maxOuterHtmlLength)
    };
  }

  const api = Object.freeze({
    CONTROL_SELECTOR,
    DEFAULT_MAX_ANCESTOR_DEPTH,
    DEFAULT_MAX_OUTER_HTML_LENGTH,
    attributesToObject,
    cssEscapeIdentifier,
    generateCssLocator,
    generateXPathLocator,
    generateJsPath,
    getComposedParent,
    getSiblingElements,
    getNavigableChildren,
    getNavigationState,
    collectShadowContext,
    collectComputedStyles,
    collectBoxModel,
    collectAccessibility,
    collectEventInfo,
    createShallowOuterHTML,
    inspectElementDetail,
    buildAncestorExport,
    summarizeElement,
    inspectElement
  });

  globalThis.ElementInspector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
