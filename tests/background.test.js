'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MESSAGE = Object.freeze({
  QUERY_STATE: 'ELEMENT_INSPECTOR_QUERY_STATE',
  FRAME_EVENT: 'ELEMENT_INSPECTOR_FRAME_EVENT',
  FRAME_COMMAND: 'ELEMENT_INSPECTOR_FRAME_COMMAND',
  TOP_EVENT: 'ELEMENT_INSPECTOR_TOP_EVENT',
  TOP_COMMAND: 'ELEMENT_INSPECTOR_TOP_COMMAND'
});

function createBackgroundHarness(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const runtimeListeners = [];
  const sentMessages = [];
  const pendingStateQueries = [];
  const stateResponse = options.stateResponse || {
    ok: true,
    active: true,
    activeFrameId: 7,
    selectedFrameId: 7
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
      onClicked: { addListener() {} }
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

  return {
    sentMessages,
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
    { command: 'APPLY_EDIT', routedCommand: 'APPLY_EDIT', targetFrameId: 7 },
    { command: 'REQUEST_ANCESTOR_EXPORT', routedCommand: 'REQUEST_ANCESTOR_EXPORT', targetFrameId: 7 }
  ];
  for (const { command, routedCommand, targetFrameId } of cases) {
    const harness = createBackgroundHarness({
      stateResponse: {
        ok: true,
        active: true,
        activeFrameId: 5,
        selectedFrameId: 7
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
      selectedFrameId: 7
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
