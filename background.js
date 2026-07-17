(() => {
  'use strict';

  const MENU_ID = 'element-inspector-copy-json';
  const RUN_MESSAGE_TYPE = 'ELEMENT_INSPECTOR_RUN';
  const SUPPORTED_PAGE_PATTERNS = [
    'http://*/*',
    'https://*/*',
    'file://*/*'
  ];

  function consumeLastError() {
    return chrome.runtime.lastError?.message || null;
  }

  function registerContextMenu() {
    chrome.contextMenus.removeAll(() => {
      consumeLastError();
      chrome.contextMenus.create({
        id: MENU_ID,
        title: 'Element Inspector',
        contexts: ['all'],
        documentUrlPatterns: SUPPORTED_PAGE_PATTERNS
      }, () => {
        const error = consumeLastError();
        if (error) console.warn('[Element Inspector] context menu registration failed:', error);
      });
    });
  }

  chrome.runtime.onInstalled.addListener(registerContextMenu);
  chrome.runtime.onStartup.addListener(registerContextMenu);

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !Number.isInteger(tab?.id)) return;

    const frameId = Number.isInteger(info.frameId) ? info.frameId : 0;
    chrome.tabs.sendMessage(
      tab.id,
      { type: RUN_MESSAGE_TYPE },
      { frameId },
      response => {
        const error = consumeLastError();
        if (error) {
          console.warn('[Element Inspector] unavailable on this page:', error);
          return;
        }
        if (!response?.ok) {
          console.warn('[Element Inspector] inspection failed:', response?.error || 'unknown error');
        }
      }
    );
  });
})();
