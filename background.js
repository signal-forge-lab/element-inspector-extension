(() => {
  'use strict';

  const MESSAGE = Object.freeze({
    SET_ACTIVE: 'ELEMENT_INSPECTOR_SET_ACTIVE',
    QUERY_STATE: 'ELEMENT_INSPECTOR_QUERY_STATE',
    FRAME_READY: 'ELEMENT_INSPECTOR_FRAME_READY',
    FRAME_EVENT: 'ELEMENT_INSPECTOR_FRAME_EVENT',
    FRAME_COMMAND: 'ELEMENT_INSPECTOR_FRAME_COMMAND',
    TOP_EVENT: 'ELEMENT_INSPECTOR_TOP_EVENT',
    TOP_COMMAND: 'ELEMENT_INSPECTOR_TOP_COMMAND'
  });

  const tabStates = new Map();

  function consumeLastError() {
    return chrome.runtime.lastError?.message || null;
  }

  function getTabState(tabId) {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, {
        active: false,
        activeFrameId: null,
        selectedFrameId: null
      });
    }
    return tabStates.get(tabId);
  }

  function sendToFrame(tabId, frameId, message, callback = null) {
    chrome.tabs.sendMessage(tabId, message, { frameId }, response => {
      const error = consumeLastError();
      if (error && callback) callback(null, error);
      else if (callback) callback(response || null, null);
    });
  }

  function broadcastToFrames(tabId, message) {
    chrome.tabs.sendMessage(tabId, message, () => consumeLastError());
  }

  function sendTopEvent(tabId, event) {
    sendToFrame(tabId, 0, { type: MESSAGE.TOP_EVENT, event });
  }

  function setTabActive(tabId, active) {
    const state = getTabState(tabId);
    state.active = active;
    state.activeFrameId = null;
    state.selectedFrameId = null;
    broadcastToFrames(tabId, { type: MESSAGE.SET_ACTIVE, active });
  }

  chrome.action.onClicked.addListener(tab => {
    if (!Number.isInteger(tab?.id)) return;
    sendToFrame(tab.id, 0, { type: MESSAGE.QUERY_STATE }, (response, error) => {
      if (error) {
        console.warn('[Element Inspector] unavailable on this page:', error);
        return;
      }
      setTabActive(tab.id, !Boolean(response?.active));
    });
  });

  chrome.tabs.onRemoved.addListener(tabId => tabStates.delete(tabId));

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
    if (!Number.isInteger(tabId)) return undefined;

    if (message?.type === MESSAGE.FRAME_READY) {
      if (!tabStates.has(tabId) && frameId !== 0) {
        sendToFrame(tabId, 0, { type: MESSAGE.QUERY_STATE }, response => {
          const recoveredState = getTabState(tabId);
          recoveredState.active = Boolean(response?.active);
          sendResponse({
            ok: true,
            active: recoveredState.active,
            frameId,
            isTopFrame: false
          });
        });
        return true;
      }
      const state = getTabState(tabId);
      sendResponse({
        ok: true,
        active: state.active,
        frameId,
        isTopFrame: frameId === 0
      });
      return false;
    }

    const state = getTabState(tabId);

    if (message?.type === MESSAGE.FRAME_EVENT) {
      if (!state.active || !message.event) {
        sendResponse({ ok: false, ignored: true });
        return false;
      }

      const event = { ...message.event, frameId };
      if (event.kind === 'hover') {
        const previousFrameId = state.activeFrameId;
        state.activeFrameId = frameId;
        if (Number.isInteger(previousFrameId) && previousFrameId !== frameId) {
          sendToFrame(tabId, previousFrameId, {
            type: MESSAGE.FRAME_COMMAND,
            command: 'CLEAR_HOVER'
          });
        }
      }

      if (event.kind === 'selected') {
        state.activeFrameId = frameId;
        state.selectedFrameId = frameId;
        broadcastToFrames(tabId, {
          type: MESSAGE.FRAME_COMMAND,
          command: 'SYNC_SELECTED',
          selectedFrameId: frameId
        });
      }

      sendTopEvent(tabId, event);
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === MESSAGE.TOP_COMMAND && frameId === 0) {
      const command = message.command;

      if (command === 'DEACTIVATE') {
        setTabActive(tabId, false);
        sendResponse({ ok: true });
        return false;
      }

      if (command === 'START_PICKING' || command === 'START_COUNTDOWN') {
        state.activeFrameId = null;
        state.selectedFrameId = null;
        broadcastToFrames(tabId, {
          type: MESSAGE.FRAME_COMMAND,
          command
        });
        sendResponse({ ok: true });
        return false;
      }

      if (command === 'FIX_ACTIVE_HOVER') {
        if (!Number.isInteger(state.activeFrameId)) {
          sendTopEvent(tabId, {
            kind: 'status',
            status: 'error',
            message: 'カウント終了時に対象要素が見つかりませんでした。'
          });
          sendResponse({ ok: false, error: 'no active frame' });
          return false;
        }
        sendToFrame(tabId, state.activeFrameId, {
          type: MESSAGE.FRAME_COMMAND,
          command: 'FIX_HOVER'
        });
        sendResponse({ ok: true });
        return false;
      }

      if (command === 'NAVIGATE' || command === 'SELECT_CHILD') {
        if (!Number.isInteger(state.selectedFrameId)) {
          sendResponse({ ok: false, error: 'no selected frame' });
          return false;
        }
        sendToFrame(tabId, state.selectedFrameId, {
          type: MESSAGE.FRAME_COMMAND,
          command,
          direction: message.direction,
          childIndex: message.childIndex
        });
        sendResponse({ ok: true });
        return false;
      }

      if (command === 'APPLY_EDIT' || command === 'UNDO_EDIT' || command === 'RESET_CURRENT_EDITS') {
        if (!Number.isInteger(state.selectedFrameId)) {
          sendResponse({ ok: false, error: 'no selected frame' });
          return false;
        }
        sendToFrame(tabId, state.selectedFrameId, {
          type: MESSAGE.FRAME_COMMAND,
          command,
          property: message.property,
          value: message.value
        });
        sendResponse({ ok: true });
        return false;
      }

      if (command === 'RESET_ALL_EDITS') {
        broadcastToFrames(tabId, {
          type: MESSAGE.FRAME_COMMAND,
          command
        });
        sendResponse({ ok: true });
        return false;
      }

      if (command === 'REQUEST_ANCESTOR_EXPORT') {
        if (!Number.isInteger(state.selectedFrameId) || typeof message.selectionId !== 'string') {
          sendResponse({ ok: false, error: 'invalid ancestor export target' });
          return false;
        }
        sendToFrame(tabId, state.selectedFrameId, {
          type: MESSAGE.FRAME_COMMAND,
          command,
          selectionId: message.selectionId
        }, (_response, error) => {
          if (error) {
            sendTopEvent(tabId, {
              kind: 'status',
              status: 'error',
              ancestorExportFailed: true,
              message: '先祖詳細を取得するフレームへ接続できませんでした。'
            });
            sendResponse({ ok: false, error });
            return;
          }
          sendResponse({ ok: true });
        });
        return true;
      }

      if (command === 'RESTORE_SELECTION') {
        if (!Number.isInteger(message.targetFrameId) || typeof message.selectionId !== 'string') {
          sendResponse({ ok: false, error: 'invalid history target' });
          return false;
        }
        sendToFrame(tabId, message.targetFrameId, {
          type: MESSAGE.FRAME_COMMAND,
          command: 'RESTORE_SELECTION',
          selectionId: message.selectionId
        }, (_response, error) => {
          if (error) {
            sendTopEvent(tabId, {
              kind: 'status',
              status: 'error',
              historyRestoreFailed: true,
              message: '保存した選択対象のiframeはすでにページから削除されています。'
            });
            sendResponse({ ok: false, error });
            return;
          }
          sendResponse({ ok: true });
        });
        return true;
      }

      if (command === 'PIN_SELECTION' || command === 'UNPIN_SELECTION') {
        if (!Number.isInteger(message.targetFrameId) || typeof message.selectionId !== 'string') {
          sendResponse({ ok: false, error: 'invalid pin target' });
          return false;
        }
        sendToFrame(tabId, message.targetFrameId, {
          type: MESSAGE.FRAME_COMMAND,
          command,
          selectionId: message.selectionId
        }, (_response, error) => {
          if (error) {
            sendTopEvent(tabId, {
              kind: 'status',
              status: 'error',
              message: 'ピン留め対象のフレームへ接続できませんでした。'
            });
          }
        });
        sendResponse({ ok: true });
        return false;
      }
    }

    return undefined;
  });
})();
