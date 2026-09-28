#!/usr/bin/env node
// Categorization quality (Phase 12): for each source, how many of the
// categories it set were kept (reviewed without a fix) and how many a user
// corrected by hand. Read-only.
//
//   node scripts/cat-quality.mjs
//
// Runs on the LINKED project and refuses anything but dev. Rows reviewed before
// Phase 12a count as kept, and fixes made before it were never recorded, so
// compare runs made after 12a shipped.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEV_REF = 'ifibrsgqdibcomzxencf';

const linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
if (linked !== DEV_REF) {
  console.error(`refusing: the CLI is linked to ${linked}, not the dev project ${DEV_REF}`);
  process.exit(2);
}

const sql = `
with kept as (
  select category_source as source, count(*) as kept
  from public.transactions where not category_is_manual and reviewed_at is not null group by 1
), fixed as (
  select corrected_from as source, count(*) as corrected
  from public.transactions where corrected_from is not null group by 1
)
select coalesce(k.source, f.source) as source, coalesce(k.kept, 0) as kept, coalesce(f.corrected, 0) as corrected,
  round(100.0 * coalesce(f.corrected, 0) / nullif(coalesce(k.kept, 0) + coalesce(f.corrected, 0), 0), 1) as corrected_pct
from kept k full join fixed f on f.source = k.source
order by 1;`;

// The SQL goes through a file: quoting it for a Windows shell is hopeless.
const dir = mkdtempSync(join(tmpdir(), 'cat-quality-'));
try {
  const file = join(dir, 'q.sql');
  writeFileSync(file, sql);
  const out = execFileSync('npx', ['-y', 'supabase@2.118.0', 'db', 'query', '--linked', '-o', 'csv', '-f', file], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = out.split(/\r?\n/).filter((l) => /^[a-z_]+,/.test(l));
  for (const line of lines) {
    const [source, kept, corrected, pct] = line.split(',');
    console.log(`${source.padEnd(16)}${kept.padStart(8)}${corrected.padStart(11)}${(pct || '-').padStart(15)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
