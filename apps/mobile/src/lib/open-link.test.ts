/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LINK_FAILED_TITLE, linkFailedMessage, openResolvedLink, type LinkOpener } from './open-link.ts';

const PAGE = 'https://studiosouroboros.com/tusky/privacy';

function recording(): LinkOpener & { browser: string[]; system: string[]; alerts: { title: string; message?: string }[] } {
  const browser: string[] = [];
  const system: string[] = [];
  const alerts: { title: string; message?: string }[] = [];
  return {
    browser,
    system,
    alerts,
    openBrowser: async (url) => {
      browser.push(url);
    },
    openURL: async (url) => {
      system.push(url);
    },
    alert: (title, message) => {
      alerts.push({ title, message });
    },
  };
}

test('a web page opens in the in-app browser and does not ask the system', async () => {
  const opener = recording();
  await openResolvedLink(PAGE, 'page', opener);
  assert.deepEqual(opener.browser, [PAGE]);
  assert.deepEqual(opener.system, []);
  assert.deepEqual(opener.alerts, []);
});

test('closing the in-app browser is success, not a fallback', async () => {
  const opener = recording();
  opener.openBrowser = async (url) => {
    opener.browser.push(url);
    return { type: 'cancel' };
  };
  await openResolvedLink(PAGE, 'page', opener);
  assert.deepEqual(opener.browser, [PAGE]);
  assert.deepEqual(opener.system, []);
  assert.deepEqual(opener.alerts, []);
});

test('a web page falls back to the system when the in-app browser cannot open', async () => {
  const opener = recording();
  opener.openBrowser = async (url) => {
    opener.browser.push(url);
    throw new Error('Unable to open browser');
  };
  await openResolvedLink(PAGE, 'page', opener);
  assert.deepEqual(opener.browser, [PAGE]);
  assert.deepEqual(opener.system, [PAGE]);
  assert.deepEqual(opener.alerts, []);
});

test('a web page that neither opener can show alerts with the address and does not reject', async () => {
  const opener = recording();
  opener.openBrowser = async () => {
    throw new Error('Unable to open browser');
  };
  opener.openURL = async () => {
    throw new Error('Unable to open URL: ' + PAGE);
  };
  await openResolvedLink(PAGE, 'page', opener);
  assert.deepEqual(opener.alerts, [{ title: LINK_FAILED_TITLE, message: linkFailedMessage(PAGE) }]);
  assert.match(linkFailedMessage(PAGE), new RegExp(PAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a system link uses Linking and skips the in-app browser', async () => {
  const opener = recording();
  const url = 'https://apps.apple.com/account/subscriptions';
  await openResolvedLink(url, 'system', opener);
  assert.deepEqual(opener.browser, []);
  assert.deepEqual(opener.system, [url]);
  assert.deepEqual(opener.alerts, []);
});

test('a system link that fails alerts with the address and does not reject', async () => {
  const opener = recording();
  const url = 'https://apps.apple.com/account/subscriptions';
  opener.openURL = async () => {
    throw new Error('Unable to open URL: ' + url);
  };
  await openResolvedLink(url, 'system', opener);
  assert.deepEqual(opener.browser, []);
  assert.deepEqual(opener.alerts, [{ title: LINK_FAILED_TITLE, message: linkFailedMessage(url) }]);
});

test('a link whose address never arrives alerts and does not reject', async () => {
  const opener = recording();
  await openResolvedLink(Promise.reject(new Error('store unavailable')), 'system', opener);
  assert.deepEqual(opener.browser, []);
  assert.deepEqual(opener.system, []);
  assert.equal(opener.alerts.length, 1);
  assert.equal(opener.alerts[0]?.title, LINK_FAILED_TITLE);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : [];
  });
}

test('every Linking.openURL call goes through the shared helper', () => {
  const callers = sourceFiles(join(root, 'src'))
    .filter((file) => !file.endsWith('.test.ts'))
    .filter((file) => readFileSync(file, 'utf8').includes('Linking.openURL'))
    .map((file) => file.slice(root.length + 1))
    .sort();
  assert.deepEqual(callers, ['src/lib/links.ts']);
});
