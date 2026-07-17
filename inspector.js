(() => {
  'use strict';

  const CONTROL_SELECTOR = 'button, [role="button"], a, [tabindex]';
  const DEFAULT_MAX_ANCESTOR_DEPTH = 8;
  const DEFAULT_MAX_OUTER_HTML_LENGTH = 5000;

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

  function getComputedStyleForElement(element) {
    const view = element?.ownerDocument?.defaultView;
    if (view?.getComputedStyle) return view.getComputedStyle(element);
    if (typeof globalThis.getComputedStyle === 'function') return globalThis.getComputedStyle(element);
    return { display: '', visibility: '', position: '' };
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

  function findControlElement(selected) {
    return selected.closest?.(CONTROL_SELECTOR) || selected;
  }

  function findFirstSvg(control) {
    return control.matches?.('svg') ? control : control.querySelector?.('svg') || null;
  }

  function collectAncestors(control, maxDepth) {
    const ancestors = [];
    let current = control;

    for (let depth = 0; current && depth < maxDepth; depth += 1) {
      const style = getComputedStyleForElement(current);
      ancestors.push({
        depth,
        tagName: current.tagName?.toLowerCase(),
        attributes: attributesToObject(current),
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        rect: getRoundedRect(current)
      });
      current = current.parentElement;
    }

    return ancestors;
  }

  function inspectElement(selected, options = {}) {
    if (!isDomElement(selected)) {
      throw new Error('右クリックした要素を取得できません');
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

    return {
      selectedTag: selected.tagName?.toLowerCase(),
      selectedAttributes: attributesToObject(selected),

      controlTag: control.tagName?.toLowerCase(),
      controlAttributes: attributesToObject(control),

      text: normalizeText(control.textContent),

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

      ancestors: collectAncestors(control, maxAncestorDepth),
      outerHTML: String(control.outerHTML || '').slice(0, maxOuterHtmlLength)
    };
  }

  const api = Object.freeze({
    CONTROL_SELECTOR,
    DEFAULT_MAX_ANCESTOR_DEPTH,
    DEFAULT_MAX_OUTER_HTML_LENGTH,
    attributesToObject,
    inspectElement
  });

  globalThis.ElementInspector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
