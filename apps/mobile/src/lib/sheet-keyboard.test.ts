/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  keyboardOverlap,
  listPaddingAboveKeyboard,
  SHEET_KEYBOARD_PERSIST_TAPS,
  screenKeyboardPadding,
  sheetKeyboardFrame,
  sheetLiftStyle,
  sheetListStyle,
} from './sheet-keyboard.ts';

const phone = { windowHeight: 800, topInset: 40, bottomInset: 24, gap: 16 };

test('a closed keyboard leaves the sheet on the bottom safe area', () => {
  const frame = sheetKeyboardFrame({ ...phone, keyboardHeight: 0 });
  assert.deepEqual(frame, { marginBottom: 0, maxHeight: 744, paddingBottom: 40 });
  assert.equal(sheetLiftStyle(frame), null);
});

test('a short category list sits on the keyboard instead of under it', () => {
  const frame = sheetKeyboardFrame({ ...phone, keyboardHeight: 320 });
  const shortList = 180;
  const sheetHeight = Math.min(shortList, frame.maxHeight);
  const sheetBottom = phone.windowHeight - frame.marginBottom;

  assert.equal(frame.marginBottom, 320);
  assert.equal(frame.paddingBottom, 16);
  assert.equal(sheetBottom, 480);
  assert.equal(sheetHeight, shortList);
  assert.ok(sheetBottom - sheetHeight >= phone.topInset);
  assert.deepEqual(sheetLiftStyle(frame), { marginBottom: 320, maxHeight: 424 });
});

test('a long list is capped to the band above the keyboard', () => {
  const frame = sheetKeyboardFrame({ ...phone, keyboardHeight: 320 });
  assert.equal(Math.min(2000, frame.maxHeight), 424);
  assert.equal(phone.windowHeight - frame.marginBottom - frame.maxHeight, phone.topInset + phone.gap);
});

test('a keyboard taller than the window cannot push the sheet negative', () => {
  const frame = sheetKeyboardFrame({ ...phone, keyboardHeight: 5000 });
  assert.equal(frame.marginBottom, 800);
  assert.equal(frame.maxHeight, 0);
  assert.equal(frame.paddingBottom, 16);
});

test('nonsense insets do not move the sheet', () => {
  const frame = sheetKeyboardFrame({
    windowHeight: Number.NaN,
    keyboardHeight: Number.NaN,
    topInset: -10,
    bottomInset: Number.POSITIVE_INFINITY,
    gap: -4,
  });
  assert.deepEqual(frame, { marginBottom: 0, maxHeight: 0, paddingBottom: 0 });
});

test('keyboard overlap prefers a reported height and clamps it to the window', () => {
  assert.equal(keyboardOverlap({ height: 320, screenY: 480 }, 800), 320);
  assert.equal(keyboardOverlap({ height: 1200, screenY: 0 }, 800), 800);
});

test('keyboard overlap falls back to screenY when the height is missing', () => {
  assert.equal(keyboardOverlap({ height: 0, screenY: 480 }, 800), 320);
  assert.equal(keyboardOverlap({ height: 0, screenY: 800 }, 800), 0);
  assert.equal(keyboardOverlap({ height: 0, screenY: 0 }, 800), 0);
  assert.equal(keyboardOverlap({ height: Number.NaN, screenY: Number.NaN }, 800), 0);
  assert.equal(keyboardOverlap({ height: -10, screenY: -1 }, 800), 0);
});

test('a list adds room to scroll its last row above the keyboard', () => {
  assert.equal(listPaddingAboveKeyboard(0, 16), 0);
  assert.equal(listPaddingAboveKeyboard(320, 16), 336);
  assert.equal(listPaddingAboveKeyboard(-5, 16), 0);
});

test('an edge-to-edge Android screen adds the navigation bar the keyboard event left out', () => {
  assert.equal(screenKeyboardPadding(296, 24, 0, 'android'), 320);
  assert.equal(screenKeyboardPadding(320, 34, 0, 'ios'), 320);
  assert.equal(screenKeyboardPadding(0, 24, 16, 'android'), 0);
});

test('the first tap on a sheet row is delivered while the keyboard is open', () => {
  assert.equal(SHEET_KEYBOARD_PERSIST_TAPS, 'handled');
});

test('a sheet list shrinks into the band and does not stretch a short result', () => {
  assert.equal(sheetListStyle.flexGrow, 0);
  assert.equal(sheetListStyle.flexShrink, 1);
  assert.equal(sheetListStyle.minHeight, 0);
});
