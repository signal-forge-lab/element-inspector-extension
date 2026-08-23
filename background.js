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
  const tabStateRecoveries = new Map();

  function consumeLastError() {
    return chrome.runtime.lastError?.message || null;
  }

  function getTabState(tabId) {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, {
        active: false,
        activeFrameId: null,
        selectedFrameId: null,
        selectedSelectionId: null
      });
    }
    return tabStates.get(tabId);
  }

  function recoverTabState(tabId, callback) {
    if (tabStates.has(tabId)) {
      callback(tabStates.get(tabId), null);
      return;
    }

    const pendingCallbacks = tabStateRecoveries.get(tabId);
    if (pendingCallbacks) {
      pendingCallbacks.push(callback);
      return;
    }

    tabStateRecoveries.set(tabId, [callback]);
    sendToFrame(tabId, 0, { type: MESSAGE.QUERY_STATE }, (response, error) => {
      const callbacks = tabStateRecoveries.get(tabId) || [];
      tabStateRecoveries.delete(tabId);
      if (!callbacks.length) return;

      const recoveryError = error || (!response?.ok ? response?.error || 'top frame state unavailable' : null);
      if (recoveryError) {
        for (const pendingCallback of callbacks) pendingCallback(null, recoveryError);
        return;
      }

      const state = getTabState(tabId);
      state.active = Boolean(response.active);
      state.activeFrameId = state.active && Number.isInteger(response.activeFrameId)
        ? response.activeFrameId
        : null;
      state.selectedFrameId = state.active && Number.isInteger(response.selectedFrameId)
        ? response.selectedFrameId
        : null;
      state.selectedSelectionId = state.active && typeof response.currentSelectionId === 'string'
        ? response.currentSelectionId
        : null;
      for (const pendingCallback of callbacks) pendingCallback(state, null);
    });
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

  function startTabSelectionMode(tabId, state, command) {
    state.activeFrameId = null;
    state.selectedFrameId = null;
    state.selectedSelectionId = null;
    broadcastToFrames(tabId, {
      type: MESSAGE.FRAME_COMMAND,
      command
    });
  }

  function respondToFrameReady(tabId, frameId, state, sendResponse) {
    const selectedFrameReloaded = state.active && Number.isInteger(state.selectedFrameId) &&
      (frameId === 0 || state.selectedFrameId === frameId);
    if (selectedFrameReloaded) {
      const selectionId = state.selectedSelectionId;
      startTabSelectionMode(tabId, state, 'START_PICKING');
      if (frameId !== 0) {
        sendTopEvent(tabId, {
          kind: 'selectionInvalidated',
          status: 'error',
          selectionId,
          frameId,
          message: '固定した要素を含むiframeが再読み込みまたは移動しました。'
        });
      }
    } else if (state.active && frameId === 0) {
      startTabSelectionMode(tabId, state, 'START_PICKING');
    } else if (state.activeFrameId === frameId) {
      state.activeFrameId = null;
    }
    sendResponse({
      ok: true,
      active: state.active,
      frameId,
      isTopFrame: frameId === 0
    });
  }

  function setTabActive(tabId, active) {
    const state = getTabState(tabId);
    state.active = active;
    state.activeFrameId = null;
    state.selectedFrameId = null;
    state.selectedSelectionId = null;
    broadcastToFrames(tabId, { type: MESSAGE.SET_ACTIVE, active });
  }

  chrome.action.onClicked.addListener(tab => {
    if (!Number.isInteger(tab?.id)) return;
    recoverTabState(tab.id, (state, error) => {
      if (error) {
        console.warn('[Prismora] unavailable on this page:', error);
        return;
      }
      setTabActive(tab.id, !Boolean(state?.active));
    });
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    tabStates.delete(tabId);
    tabStateRecoveries.delete(tabId);
  });

  function handleRuntimeMessage(message, sender, sendResponse, options = {}) {
    const tabId = sender.tab?.id;
    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
    if (!Number.isInteger(tabId)) return undefined;

    if (message?.type === MESSAGE.FRAME_READY) {
      if (!tabStates.has(tabId) && frameId !== 0) {
        recoverTabState(tabId, (recoveredState, error) => {
          if (error || !recoveredState) {
            sendResponse({
              ok: false,
              error: error || 'top frame state unavailable',
              active: false,
              frameId,
              isTopFrame: false
            });
            return;
          }
          respondToFrameReady(tabId, frameId, recoveredState, sendResponse);
        });
        return true;
      }
      const state = getTabState(tabId);
      respondToFrameReady(tabId, frameId, state, sendResponse);
      return false;
    }

    const requiresStateRecovery =
      message?.type === MESSAGE.FRAME_EVENT ||
      (message?.type === MESSAGE.TOP_COMMAND && frameId === 0);
    if (!options.skipRecovery && requiresStateRecovery && !tabStates.has(tabId)) {
      recoverTabState(tabId, (_recoveredState, error) => {
        if (error) {
          sendResponse({ ok: false, error });
          return;
        }
        handleRuntimeMessage(message, sender, sendResponse, { skipRecovery: true });
      });
      return true;
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
        state.selectedSelectionId = typeof event.selectionId === 'string' ? event.selectionId : null;
        broadcastToFrames(tabId, {
          type: MESSAGE.FRAME_COMMAND,
          command: 'SYNC_SELECTED',
          selectedFrameId: frameId
        });
      }

      if (event.kind === 'selectionInvalidated') {
        if (
          state.selectedFrameId !== frameId ||
          typeof event.selectionId !== 'string' ||
          state.selectedSelectionId !== event.selectionId
        ) {
          sendResponse({ ok: false, ignored: true });
          return false;
        }
        startTabSelectionMode(tabId, state, 'START_PICKING');
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
        startTabSelectionMode(tabId, state, command);
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

      if (
        command === 'NAVIGATE' ||
        command === 'SELECT_CHILD' ||
        command === 'PREVIEW_CHILD' ||
        command === 'CLEAR_CHILD_PREVIEW'
      ) {
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
  }

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
})();
