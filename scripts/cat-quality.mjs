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
//
// Since 12d it also prints Jev's calibration (corrections by confidence band),
// whether triage's "likely needs a fix" predicts fixes, and whether split hints
// are taken.

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

/** One query on the linked project, as rows of text cells. The header row is kept: it prints as the titles. */
function query(sql) {
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
    return out.split(/\r?\n/).filter((l) => /^[a-z0-9_]+,/.test(l)).map((l) => l.split(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WIDTHS = [8, 11, 15];
function print(title, rows) {
  console.log(`\n${title}`);
  for (const [label, ...cells] of rows) {
    console.log(`${label.padEnd(16)}${cells.map((c, i) => (c || '-').padStart(WIDTHS[i] ?? 12)).join('')}`);
  }
}

print('Each source: kept vs corrected', query(`
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
order by 1;`));

// 12d: is JEV_CONFIDENCE in the right place? Corrections should fall as confidence rises.
print('AI answers by confidence (12d calibration)', query(`
with ai as (
  select case
      when ai_confidence is null then 'no_conf'
      when ai_confidence >= 0.99 then 'conf_99_up'
      when ai_confidence >= 0.95 then 'conf_95_99'
      else 'conf_90_95' end || '_' || coalesce(ai_level, 'na') as band,
    (category_source = 'ai' and not category_is_manual and reviewed_at is not null) as kept,
    (corrected_from = 'ai') as corrected
  from public.transactions
  where category_source = 'ai' or corrected_from = 'ai'
)
select band, count(*) filter (where kept) as kept, count(*) filter (where corrected) as corrected,
  round(100.0 * count(*) filter (where corrected) / nullif(count(*) filter (where kept or corrected), 0), 1) as corrected_pct
from ai group by 1 order by 1;`));

// 12d: does "likely needs a fix" predict fixes?
print('Review priority vs fixes (12d triage)', query(`
select 'priority_' || review_priority as level,
  count(*) filter (where corrected_from is null) as kept,
  count(*) filter (where corrected_from is not null) as corrected,
  round(100.0 * count(*) filter (where corrected_from is not null) / nullif(count(*), 0), 1) as corrected_pct
from public.transactions
where review_priority is not null and reviewed_at is not null
group by 1 order by 1;`));

// 12d: do people split what Jev suggested?
print('Split hint vs splits (12d)', query(`
select case when split_suggested then 'suggested' else 'not_suggested' end as hint,
  count(*) filter (where split is not null) as split,
  count(*) filter (where split is null) as not_split,
  round(100.0 * count(*) filter (where split is not null) / nullif(count(*), 0), 1) as split_pct
from public.transactions
where split_suggested is not null and reviewed_at is not null
group by 1 order by 1;`));
