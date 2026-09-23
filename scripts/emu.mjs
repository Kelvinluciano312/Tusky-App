#!/usr/bin/env node
// Cheap emulator driver for agents: read the screen as text instead of screenshots.
//   node scripts/emu.mjs ui                 visible labels with tap centers
//   node scripts/emu.mjs tap "Settings"     tap first element whose text/desc contains it
//   node scripts/emu.mjs tapxy 540 1200
//   node scripts/emu.mjs type "user_good"   (then `key enter`)
//   node scripts/emu.mjs key back|enter|home
//   node scripts/emu.mjs scroll down|up
//   node scripts/emu.mjs logs               JS logs + crashes since last call, then clears
//   node scripts/emu.mjs shot [out.png]     real screenshot, only when layout matters
// Device: $ANDROID_SERIAL, else emulator-5554.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
const adb = (args, opts = {}) =>
  execFileSync('adb', ['-s', serial, ...args], { maxBuffer: 64 << 20, ...opts });

function nodes() {
  const xml = adb(['exec-out', 'uiautomator', 'dump', '/dev/tty']).toString();
  const out = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const a = Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const label = (a.text || a['content-desc'] || '').trim();
    const b = a.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!label || !b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 <= x1 || y2 <= y1) continue;
    out.push({ label, x: (x1 + x2) >> 1, y: (y1 + y2) >> 1, click: a.clickable === 'true' });
  }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(' ');
const keys = { back: 4, enter: 66, home: 3, del: 67 };

switch (cmd) {
  case 'ui':
    for (const n of nodes()) console.log(`${n.click ? '*' : ' '} ${n.label.replace(/\s+/g, ' ')} @${n.x},${n.y}`);
    break;
  case 'tap': {
    const q = arg.toLowerCase();
    const all = nodes();
    const n = all.find((n) => n.label.toLowerCase() === q) || all.find((n) => n.label.toLowerCase().includes(q));
    if (!n) { console.error(`no element matching "${arg}"`); process.exit(1); }
    adb(['shell', 'input', 'tap', n.x, n.y].map(String));
    console.log(`tapped "${n.label}" @${n.x},${n.y}`);
    break;
  }
  case 'tapxy': adb(['shell', 'input', 'tap', ...rest]); break;
  case 'type': adb(['shell', 'input', 'text', arg.replace(/ /g, '%s')]); break;
  case 'key': adb(['shell', 'input', 'keyevent', String(keys[arg] ?? arg)]); break;
  case 'scroll':
    adb(['shell', 'input', 'swipe', '540', arg === 'up' ? '800' : '1800', '540', arg === 'up' ? '1800' : '800', '300']);
    break;
  case 'logs': {
    const log = adb(['logcat', '-d', '-v', 'brief', '-s', 'ReactNativeJS:V', 'ReactNative:E', 'AndroidRuntime:E']).toString();
    console.log(log.split('\n').filter((l) => l && !l.startsWith('-----')).slice(-60).join('\n') || '(no logs)');
    adb(['logcat', '-c']);
    break;
  }
  case 'shot': {
    const file = rest[0] || join(tmpdir(), 'emu.png');
    writeFileSync(file, adb(['exec-out', 'screencap', '-p']));
    console.log(file);
    break;
  }
  default:
    console.error('usage: emu.mjs ui | tap <text> | tapxy x y | type <text> | key <name> | scroll up|down | logs | shot [file]');
    process.exit(1);
}
