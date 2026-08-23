'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MESSAGE = Object.freeze({
  SET_ACTIVE: 'ELEMENT_INSPECTOR_SET_ACTIVE',
  QUERY_STATE: 'ELEMENT_INSPECTOR_QUERY_STATE',
  FRAME_READY: 'ELEMENT_INSPECTOR_FRAME_READY',
  FRAME_EVENT: 'ELEMENT_INSPECTOR_FRAME_EVENT',
  FRAME_COMMAND: 'ELEMENT_INSPECTOR_FRAME_COMMAND',
  TOP_EVENT: 'ELEMENT_INSPECTOR_TOP_EVENT',
  TOP_COMMAND: 'ELEMENT_INSPECTOR_TOP_COMMAND'
});

function createBackgroundHarness(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const runtimeListeners = [];
  const actionListeners = [];
  const sentMessages = [];
  const pendingStateQueries = [];
  const stateResponse = options.stateResponse || {
    ok: true,
    active: true,
    activeFrameId: 7,
    selectedFrameId: 7,
    currentSelectionId: 'selection-7'
  };

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        }
      }
    },
    action: {
      onClicked: {
        addListener(listener) {
          actionListeners.push(listener);
        }
      }
    },
    tabs: {
      onRemoved: { addListener() {} },
      sendMessage(tabId, message, optionsOrCallback, callbackArgument) {
        const optionsValue = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback || {};
        const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callbackArgument;
        const frameId = Number.isInteger(optionsValue.frameId) ? optionsValue.frameId : null;
        sentMessages.push({ tabId, frameId, message });

        if (frameId === 0 && message.type === MESSAGE.QUERY_STATE) {
          const resolveQuery = () => {
            if (options.stateError) {
              chrome.runtime.lastError = { message: options.stateError };
              callback?.();
              chrome.runtime.lastError = null;
              return;
            }
            callback?.(stateResponse);
          };
          if (options.deferStateQuery) pendingStateQueries.push(resolveQuery);
          else resolveQuery();
          return;
        }

        callback?.({ ok: true });
      }
    }
  };

  vm.runInNewContext(source, { chrome, console });
  assert.equal(runtimeListeners.length, 1);
  assert.equal(actionListeners.length, 1);

  return {
    sentMessages,
    clickAction(tabId = 41) {
      actionListeners[0]({ id: tabId });
    },
    dispatch(message, { tabId = 41, frameId = 0 } = {}) {
      const outcome = { returnValue: undefined, response: undefined };
      outcome.returnValue = runtimeListeners[0](
        message,
        { tab: { id: tabId }, frameId },
        response => {
          outcome.response = response;
        }
      );
      return outcome;
    },
    flushStateQueries() {
      for (const resolveQuery of pendingStateQueries.splice(0)) resolveQuery();
    },
    stateQueryCount() {
      return sentMessages.filter(item =>
        item.frameId === 0 && item.message.type === MESSAGE.QUERY_STATE
      ).length;
    }
  };
}

test('coalesces toolbar deactivate with in-flight service worker recovery', () => {
  const harness = createBackgroundHarness({ deferStateQuery: true });

  harness.clickAction();
  const hover = harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: { kind: 'hover', summary: { label: '<button>' } }
  }, { frameId: 7 });

  assert.equal(hover.returnValue, true);
  assert.equal(harness.stateQueryCount(), 1);

  harness.flushStateQueries();

  assert.ok(harness.sentMessages.some(item =>
    item.frameId === null && item.message.type === MESSAGE.SET_ACTIVE && item.message.active === false
  ));
  assert.equal(harness.sentMessages.some(item =>
    item.frameId === 0 && item.message.type === MESSAGE.TOP_EVENT && item.message.event?.kind === 'hover'
  ), false);
  assert.equal(hover.response?.ok, false);
  assert.equal(hover.response?.ignored, true);
});

test('recovers an active session before processing the first frame event after service worker restart', () => {
  const harness = createBackgroundHarness();
  const outcome = harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: { kind: 'hover', summary: { label: '<button>' } }
  }, { frameId: 7 });

  assert.equal(outcome.returnValue, true);
  assert.equal(outcome.response?.ok, true);
  const forwarded = harness.sentMessages.find(item => item.message.type === MESSAGE.TOP_EVENT);
  assert.ok(forwarded);
  assert.equal(forwarded.frameId, 0);
  assert.equal(forwarded.message.event.kind, 'hover');
  assert.equal(forwarded.message.event.frameId, 7);
});

test('recovers active and selected frame routing for countdown, navigation, edit, and ancestor export commands', () => {
  const cases = [
    { command: 'FIX_ACTIVE_HOVER', routedCommand: 'FIX_HOVER', targetFrameId: 5 },
    { command: 'NAVIGATE', routedCommand: 'NAVIGATE', targetFrameId: 7 },
    { command: 'PREVIEW_CHILD', routedCommand: 'PREVIEW_CHILD', targetFrameId: 7 },
    { command: 'CLEAR_CHILD_PREVIEW', routedCommand: 'CLEAR_CHILD_PREVIEW', targetFrameId: 7 },
    { command: 'APPLY_EDIT', routedCommand: 'APPLY_EDIT', targetFrameId: 7 },
    { command: 'REQUEST_ANCESTOR_EXPORT', routedCommand: 'REQUEST_ANCESTOR_EXPORT', targetFrameId: 7 }
  ];
  for (const { command, routedCommand, targetFrameId } of cases) {
    const harness = createBackgroundHarness({
      stateResponse: {
        ok: true,
        active: true,
        activeFrameId: 5,
        selectedFrameId: 7,
        currentSelectionId: 'selection-7'
      }
    });
    const message = {
      type: MESSAGE.TOP_COMMAND,
      command,
      direction: 'parent',
      property: 'display',
      value: 'grid',
      selectionId: 'selection-7'
    };
    const outcome = harness.dispatch(message, { frameId: 0 });

    assert.equal(outcome.returnValue, true, command);
    assert.equal(outcome.response?.ok, true, command);
    const routed = harness.sentMessages.find(item =>
      item.frameId === targetFrameId &&
      item.message.type === MESSAGE.FRAME_COMMAND &&
      item.message.command === routedCommand
    );
    assert.ok(routed, `${command} was not routed to the recovered target frame`);
  }
});

test('routes history restore and pin commands to their explicit target frame', () => {
  const cases = ['RESTORE_SELECTION', 'PIN_SELECTION', 'UNPIN_SELECTION'];
  for (const command of cases) {
    const harness = createBackgroundHarness();
    const outcome = harness.dispatch({
      type: MESSAGE.TOP_COMMAND,
      command,
      targetFrameId: 9,
      selectionId: 'selection-9'
    });

    assert.equal(outcome.returnValue, true, command);
    assert.equal(outcome.response?.ok, true, command);
    assert.ok(harness.sentMessages.some(item =>
      item.frameId === 9 &&
      item.message.type === MESSAGE.FRAME_COMMAND &&
      item.message.command === command &&
      item.message.selectionId === 'selection-9'
    ), `${command} was not routed to the explicit target frame`);
  }
});

test('shares one recovery query across concurrent messages after service worker restart', () => {
  const harness = createBackgroundHarness({ deferStateQuery: true });
  const hover = harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: { kind: 'hover', summary: { label: '<div>' } }
  }, { frameId: 5 });
  const navigation = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'NAVIGATE',
    direction: 'parent'
  });

  assert.equal(hover.returnValue, true);
  assert.equal(navigation.returnValue, true);
  assert.equal(harness.stateQueryCount(), 1);
  assert.equal(hover.response, undefined);
  assert.equal(navigation.response, undefined);

  harness.flushStateQueries();

  assert.equal(hover.response?.ok, true);
  assert.equal(navigation.response?.ok, true);
});

test('returns a logical error when session recovery cannot reach the top frame', () => {
  const harness = createBackgroundHarness({ stateError: 'Could not establish connection.' });
  const outcome = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'REQUEST_ANCESTOR_EXPORT',
    selectionId: 'selection-7'
  });

  assert.equal(outcome.returnValue, true);
  assert.equal(outcome.response?.ok, false);
  assert.equal(outcome.response?.error, 'Could not establish connection.');
});

test('does not start session recovery for unknown messages', () => {
  const harness = createBackgroundHarness();
  const outcome = harness.dispatch({ type: 'UNKNOWN_MESSAGE' }, { frameId: 3 });

  assert.equal(outcome.returnValue, undefined);
  assert.equal(outcome.response, undefined);
  assert.equal(harness.stateQueryCount(), 0);
});

test('does not reactivate an inactive session during recovery', () => {
  const harness = createBackgroundHarness({
    stateResponse: {
      ok: true,
      active: false,
      activeFrameId: 5,
      selectedFrameId: 7,
      currentSelectionId: 'selection-7'
    }
  });
  const outcome = harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: { kind: 'hover', summary: { label: '<button>' } }
  }, { frameId: 5 });

  assert.equal(outcome.returnValue, true);
  assert.equal(outcome.response?.ok, false);
  assert.equal(outcome.response?.ignored, true);
  assert.equal(harness.sentMessages.some(item => item.message.type === MESSAGE.TOP_EVENT), false);
});

test('invalidates a removed selection across background and all frames', () => {
  const harness = createBackgroundHarness({
    stateResponse: {
      ok: true,
      active: true,
      activeFrameId: 7,
      selectedFrameId: 7,
      currentSelectionId: 'selection-7'
    }
  });
  const invalidation = harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: {
      kind: 'selectionInvalidated',
      selectionId: 'selection-7',
      message: '固定した要素がページから削除されました。'
    }
  }, { frameId: 7 });

  assert.equal(invalidation.returnValue, true);
  assert.equal(invalidation.response?.ok, true);
  assert.ok(harness.sentMessages.some(item =>
    item.frameId === null &&
    item.message.type === MESSAGE.FRAME_COMMAND &&
    item.message.command === 'START_PICKING'
  ));
  assert.ok(harness.sentMessages.some(item =>
    item.frameId === 0 &&
    item.message.type === MESSAGE.TOP_EVENT &&
    item.message.event.kind === 'selectionInvalidated'
  ));

  const navigation = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'NAVIGATE',
    direction: 'parent'
  });
  assert.equal(navigation.response?.ok, false);
  assert.equal(navigation.response?.error, 'no selected frame');
});

test('ignores a stale invalidation from an older selection in the same frame', () => {
  const harness = createBackgroundHarness({
    stateResponse: {
      ok: true,
      active: true,
      activeFrameId: 7,
      selectedFrameId: 7,
      currentSelectionId: 'selection-new'
    }
  });
  const invalidation = harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: {
      kind: 'selectionInvalidated',
      selectionId: 'selection-old',
      message: 'stale invalidation'
    }
  }, { frameId: 7 });

  assert.equal(invalidation.response?.ok, false);
  assert.equal(invalidation.response?.ignored, true);
  assert.equal(harness.sentMessages.some(item =>
    item.frameId === null && item.message.command === 'START_PICKING'
  ), false);

  const navigation = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'NAVIGATE',
    direction: 'parent'
  });
  assert.equal(navigation.response?.ok, true);
});

test('invalidates the selected child frame when its content script reloads', () => {
  const harness = createBackgroundHarness();
  harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: { kind: 'selected', selectionId: 'selection-7', result: {} }
  }, { frameId: 7 });
  const messageOffset = harness.sentMessages.length;

  const ready = harness.dispatch({ type: MESSAGE.FRAME_READY }, { frameId: 7 });

  assert.equal(ready.response?.ok, true);
  const newMessages = harness.sentMessages.slice(messageOffset);
  assert.ok(newMessages.some(item =>
    item.frameId === null && item.message.command === 'START_PICKING'
  ));
  assert.ok(newMessages.some(item =>
    item.frameId === 0 &&
    item.message.type === MESSAGE.TOP_EVENT &&
    item.message.event.kind === 'selectionInvalidated'
  ));
  const navigation = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'NAVIGATE',
    direction: 'parent'
  });
  assert.equal(navigation.response?.ok, false);
});

test('clears stale selection routing when the top frame reloads', () => {
  const harness = createBackgroundHarness();
  harness.dispatch({
    type: MESSAGE.FRAME_EVENT,
    event: { kind: 'selected', selectionId: 'selection-7', result: {} }
  }, { frameId: 7 });

  const ready = harness.dispatch({ type: MESSAGE.FRAME_READY }, { frameId: 0 });

  assert.equal(ready.response?.ok, true);
  const navigation = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'NAVIGATE',
    direction: 'parent'
  });
  assert.equal(navigation.response?.ok, false);
  assert.equal(navigation.response?.error, 'no selected frame');
});

test('broadcasts all-edit reset independently of the selected frame edit count', () => {
  const harness = createBackgroundHarness();
  const outcome = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'RESET_ALL_EDITS'
  });

  assert.equal(outcome.response?.ok, true);
  assert.ok(harness.sentMessages.some(item =>
    item.frameId === null &&
    item.message.type === MESSAGE.FRAME_COMMAND &&
    item.message.command === 'RESET_ALL_EDITS'
  ));
});

test('clears stale hover routing when the top frame reloads before selection', () => {
  const harness = createBackgroundHarness({
    stateResponse: {
      ok: true,
      active: true,
      activeFrameId: 7,
      selectedFrameId: null,
      currentSelectionId: null
    }
  });
  harness.dispatch({ type: MESSAGE.FRAME_EVENT, event: { kind: 'hover' } }, { frameId: 7 });

  harness.dispatch({ type: MESSAGE.FRAME_READY }, { frameId: 0 });
  const fix = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'FIX_ACTIVE_HOVER'
  });

  assert.equal(fix.response?.ok, false);
  assert.equal(fix.response?.error, 'no active frame');
});

test('clears stale hover routing when the hovered child frame reloads', () => {
  const harness = createBackgroundHarness({
    stateResponse: {
      ok: true,
      active: true,
      activeFrameId: 7,
      selectedFrameId: null,
      currentSelectionId: null
    }
  });
  harness.dispatch({ type: MESSAGE.FRAME_EVENT, event: { kind: 'hover' } }, { frameId: 7 });

  harness.dispatch({ type: MESSAGE.FRAME_READY }, { frameId: 7 });
  const fix = harness.dispatch({
    type: MESSAGE.TOP_COMMAND,
    command: 'FIX_ACTIVE_HOVER'
  });

  assert.equal(fix.response?.ok, false);
  assert.equal(fix.response?.error, 'no active frame');
});
