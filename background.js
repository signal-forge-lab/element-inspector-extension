(() => {
  'use strict';

  const TOGGLE_MESSAGE_TYPE = 'ELEMENT_INSPECTOR_TOGGLE';

  function consumeLastError() {
    return chrome.runtime.lastError?.message || null;
  }

  chrome.action.onClicked.addListener(tab => {
    if (!Number.isInteger(tab?.id)) return;

    chrome.tabs.sendMessage(
      tab.id,
      { type: TOGGLE_MESSAGE_TYPE },
      { frameId: 0 },
      response => {
        const error = consumeLastError();
        if (error) {
          console.warn('[Element Inspector] unavailable on this page:', error);
          return;
        }
        if (!response?.ok) {
          console.warn('[Element Inspector] toggle failed:', response?.error || 'unknown error');
        }
      }
    );
  });
})();
