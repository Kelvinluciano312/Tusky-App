# Phase 7a — Category Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today's 16 categories become groups over 61 finer categories from Plaid's detailed codes. Budgets can be set on a group or on one of its categories, and reports roll up by group with a per-group drill-in.

**Architecture:**
- **Database.** One migration adds `parent_id` and `user_id` to `categories`, with a trigger that keeps the tree two levels deep. It seeds the children and a `plaid_detailed_map`, and backfills every non-manual transaction. It also adds `transactions.merchant_key` (generated) and `merchant_entity_id`.
- **Server.** `resolveCategoryId` becomes an ordered-precedence resolver (rule > detailed > primary > fallback), and sync uses it.
- **App.** A new pure `lib/categories.ts` (tree, group lookup, rollups, budget replacement), tested with `node --test`, drives the picker, Budgets and Reports.

**Tech Stack:** Supabase Postgres; Deno Edge Functions (`npm:plaid@30`); Expo SDK 57 / expo-router 57; React Query 5; Node 26 `node:test` with native type stripping.

**Spec:** `docs/superpowers/specs/2026-09-24-phase-7-categories-design.md` (milestone 7a, plus the Taxonomy table)

## Global Constraints

- **Group ids and slugs are unchanged.** Today's 16 rows become the groups.
- **Never rewrite a manual row.** The backfill and the resolver never change a `category_is_manual` row (`pickCategoryId` still wins).
- **Two levels only.** A child's parent must be a built-in group (`parent_id is null and user_id is null`), and a child inherits its group's `kind` by trigger.
- **Card payments.** `credit_card_payment` is transfer-kind, but recurring detection must NOT ignore it.
- **Grants fail closed** (Phase 6). `plaid_detailed_map` gets no client grants. The new `transactions` columns are covered by the existing table-level `select`.
- **UI conventions.** Every amount goes through `Amount`, all text through `AppText`, and colours and spacing only through `constants/theme.ts` (category colours are data).
- **Expo SDK 57 APIs.** Read `apps/mobile/AGENTS.md`. No new native modules, so the dev build needs no rebuild.
- **Deploy order.** Push the migration before deploying the functions: sync starts writing `merchant_entity_id`.
- **Git.** Work on `pedro`. Never merge (Pedro merges). Never run `supabase secrets set --env-file`.

## Review Focus

1. **A category id the client doesn't know** (e.g. an app still holding the pre-migration category cache). The row must render its fallback, never crash, and rollups must keep the id under itself. Test: `groupIdOf` and `rollupByGroup` with an unknown id (Task 3).
2. **Negative spend in a child** (a month of refunds). The group rollup includes it; slices and the breakdown drop entries that are not positive. Test in Task 4.
3. **A transaction whose `pfc_detailed` is null** (older rows). The resolver falls to the primary code (Task 2 test). The backfill does the same with `coalesce` (Task 1 SQL check).
4. **Setting a budget that would overlap.** Setting a group's replaces its children's; setting a child's replaces the group's; a sibling's is never touched. Test: `budgetsReplacedBy` (Task 3).
5. **Card payments after the reclassification.** They leave spending and cash flow but stay in recurring detection. Test: `ignoredCategoryIds` (Task 2) and `buildCashFlow` with a transfer child (Task 4).

---

### Task 1: Migration — category groups, detailed map, backfill

**Files:**
- Create: `supabase/migrations/20260924190000_phase7a_category_groups.sql`

**Interfaces:**
- Produces:
  - `categories.parent_id uuid null`, `categories.user_id uuid null`, and `categories.slug` becomes nullable.
  - 61 child rows.
  - `plaid_detailed_map(pfc_detailed text pk, category_id uuid)` with 102 rows.
  - `plaid_category_map` gains `LOAN_DISBURSEMENTS`.
  - `transactions.merchant_key text` (generated) and `transactions.merchant_entity_id text null`.

- [ ] **Step 1: Record the pre-migration baseline** (repo root). Save the output in the ledger.

```sh
npx --no-install supabase db query --linked -o csv "select count(*) manual_rows, md5(string_agg(id::text || ':' || category_id::text, ',' order by id)) manual_checksum from transactions where category_is_manual"
npx --no-install supabase db query --linked -o csv "select count(*) filter (where c.slug='uncategorized') uncategorized, count(*) filter (where t.pfc_primary='LOAN_DISBURSEMENTS') loan_disb, count(*) filter (where t.pfc_detailed='LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') cc_payments from transactions t join categories c on c.id=t.category_id"
```

- [ ] **Step 2: Write the migration**

```sql
-- Phase 7a: categories become two levels. Today's 16 rows are the groups, with
-- ids unchanged, so budgets, manual overrides and stream category_ids stay
-- valid. About 60 finer categories become their children, mapped from Plaid's
-- detailed codes. See docs/superpowers/specs/2026-09-24-phase-7-categories-design.md.

alter table public.categories
  add column parent_id uuid references public.categories (id),
  -- null = built-in. Defaulted so a client insert (7b) never names it; rows the
  -- migration inserts get null, because auth.uid() is null outside a request.
  add column user_id uuid default auth.uid() references auth.users (id) on delete cascade,
  alter column slug drop not null;

alter table public.categories
  add constraint categories_slug_iff_builtin check ((user_id is null) = (slug is not null));

create index categories_parent_id_idx on public.categories (parent_id);
create index categories_user_id_idx on public.categories (user_id);

-- Two levels, and custom groups are impossible: a parent must be a built-in
-- group. A child's kind is its group's, always, so income/expense/transfer
-- bucketing never depends on a child agreeing with its group.
create function public.categories_enforce_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  if exists (select 1 from public.categories c where c.parent_id = new.id) then
    raise exception 'a group with children cannot itself have a parent';
  end if;
  select c.parent_id, c.user_id, c.kind into parent from public.categories c where c.id = new.parent_id;
  if not found then
    raise exception 'parent category % does not exist', new.parent_id;
  end if;
  if parent.parent_id is not null or parent.user_id is not null then
    raise exception 'a category''s parent must be a built-in group';
  end if;
  new.kind := parent.kind;
  return new;
end;
$$;

create trigger categories_enforce_tree
  before insert or update of parent_id, kind on public.categories
  for each row execute function public.categories_enforce_tree();

-- Built-ins for everyone, custom rows (7b) for their owner only.
drop policy "Categories are readable by all signed-in users" on public.categories;
create policy "Users see built-in categories and their own"
  on public.categories for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

-- The children. Colour comes from the group; kind is set by the trigger.
insert into public.categories (slug, name, kind, icon, color, sort_order, parent_id)
select v.slug, v.name, g.kind, v.icon, g.color, v.sort_order, g.id
from (values
  ('income', 'paychecks', 'Paychecks', 'Banknote', 1),
  ('income', 'freelance_and_gig', 'Freelance & Gig', 'Briefcase', 2),
  ('income', 'interest_and_dividends', 'Interest & Dividends', 'PiggyBank', 3),
  ('income', 'rental_income', 'Rental Income', 'KeyRound', 4),
  ('income', 'benefits_and_refunds', 'Benefits & Refunds', 'HandCoins', 5),
  ('transfer', 'account_transfers', 'Account Transfers', 'ArrowLeftRight', 1),
  ('transfer', 'credit_card_payment', 'Credit Card Payment', 'CreditCard', 2),
  ('transfer', 'loan_disbursements', 'Loan Disbursements', 'HandCoins', 3),
  ('food_and_dining', 'groceries', 'Groceries', 'ShoppingCart', 1),
  ('food_and_dining', 'restaurants_and_bars', 'Restaurants & Bars', 'UtensilsCrossed', 2),
  ('food_and_dining', 'fast_food', 'Fast Food', 'Sandwich', 3),
  ('food_and_dining', 'coffee_shops', 'Coffee Shops', 'Coffee', 4),
  ('bills_and_utilities', 'rent', 'Rent', 'Building', 1),
  ('bills_and_utilities', 'gas_and_electric', 'Gas & Electric', 'PlugZap', 2),
  ('bills_and_utilities', 'internet_and_cable', 'Internet & Cable', 'Wifi', 3),
  ('bills_and_utilities', 'phone', 'Phone', 'Smartphone', 4),
  ('bills_and_utilities', 'water_and_waste', 'Water & Waste', 'Droplets', 5),
  ('transportation', 'fuel', 'Gas', 'Fuel', 1),
  ('transportation', 'parking_and_tolls', 'Parking & Tolls', 'SquareParking', 2),
  ('transportation', 'public_transit', 'Public Transit', 'TrainFront', 3),
  ('transportation', 'rideshare_and_taxi', 'Rideshare & Taxi', 'CarTaxiFront', 4),
  ('transportation', 'auto_maintenance', 'Auto Maintenance', 'CarFront', 5),
  ('shopping', 'clothing', 'Clothing', 'Shirt', 1),
  ('shopping', 'electronics', 'Electronics', 'Laptop', 2),
  ('shopping', 'department_and_superstores', 'Department & Superstores', 'Store', 3),
  ('shopping', 'online_marketplaces', 'Online Marketplaces', 'Package', 4),
  ('shopping', 'gifts', 'Gifts', 'Gift', 5),
  ('shopping', 'pet_supplies', 'Pet Supplies', 'PawPrint', 6),
  ('shopping', 'books_and_office', 'Books & Office', 'BookOpen', 7),
  ('entertainment', 'streaming_and_music', 'Streaming & Music', 'Tv', 1),
  ('entertainment', 'video_games', 'Video Games', 'Gamepad2', 2),
  ('entertainment', 'events_and_outings', 'Events & Outings', 'Ticket', 3),
  ('entertainment', 'gambling', 'Gambling', 'Dices', 4),
  ('travel', 'flights', 'Flights', 'PlaneTakeoff', 1),
  ('travel', 'lodging', 'Lodging', 'BedDouble', 2),
  ('travel', 'rental_cars', 'Rental Cars', 'Car', 3),
  ('medical', 'doctor', 'Doctor', 'Stethoscope', 1),
  ('medical', 'dentist', 'Dentist', 'Smile', 2),
  ('medical', 'eye_care', 'Eye Care', 'Eye', 3),
  ('medical', 'pharmacy', 'Pharmacy', 'Pill', 4),
  ('medical', 'veterinary', 'Veterinary', 'Dog', 5),
  ('personal_care', 'fitness', 'Fitness', 'Dumbbell', 1),
  ('personal_care', 'hair_and_beauty', 'Hair & Beauty', 'Scissors', 2),
  ('personal_care', 'laundry', 'Laundry', 'WashingMachine', 3),
  ('home', 'furniture', 'Furniture', 'Sofa', 1),
  ('home', 'hardware_and_repairs', 'Hardware & Repairs', 'Hammer', 2),
  ('services', 'insurance', 'Insurance', 'ShieldCheck', 1),
  ('services', 'childcare', 'Childcare', 'Baby', 2),
  ('services', 'education', 'Education', 'GraduationCap', 3),
  ('services', 'financial_and_legal', 'Financial & Legal', 'Scale', 4),
  ('services', 'shipping_and_storage', 'Shipping & Storage', 'Truck', 5),
  ('loan_payments', 'mortgage', 'Mortgage', 'Key', 1),
  ('loan_payments', 'auto_loan', 'Auto Loan', 'Car', 2),
  ('loan_payments', 'student_loan', 'Student Loan', 'School', 3),
  ('loan_payments', 'personal_loan', 'Personal Loan', 'HandCoins', 4),
  ('loan_payments', 'buy_now_pay_later', 'Buy Now Pay Later', 'CalendarClock', 5),
  ('bank_fees', 'interest_charges', 'Interest Charges', 'Percent', 1),
  ('bank_fees', 'atm_fees', 'ATM Fees', 'BadgeDollarSign', 2),
  ('bank_fees', 'overdraft_and_late_fees', 'Overdraft & Late Fees', 'TriangleAlert', 3),
  ('government_and_nonprofit', 'donations', 'Donations', 'HeartHandshake', 1),
  ('government_and_nonprofit', 'taxes', 'Taxes', 'FileText', 2)
) as v(group_slug, slug, name, icon, sort_order)
join public.categories g on g.slug = v.group_slug and g.parent_id is null;

-- PFC detailed -> our category. Any code not listed (and every *_OTHER) falls
-- back to plaid_category_map, whose entries point at the groups. Service role
-- only: RLS on, no policies, and no grants, which the Phase 6 defaults make the
-- starting point anyway.
create table public.plaid_detailed_map (
  pfc_detailed text primary key,
  category_id uuid not null references public.categories (id)
);

alter table public.plaid_detailed_map enable row level security;

insert into public.plaid_detailed_map (pfc_detailed, category_id)
select v.code, c.id
from (values
  ('INCOME_SALARY', 'paychecks'), ('INCOME_MILITARY', 'paychecks'),
  ('INCOME_CONTRACTOR', 'freelance_and_gig'), ('INCOME_GIG_ECONOMY', 'freelance_and_gig'),
  ('INCOME_INTEREST_EARNED', 'interest_and_dividends'), ('INCOME_DIVIDENDS', 'interest_and_dividends'),
  ('INCOME_RENTAL', 'rental_income'),
  ('INCOME_TAX_REFUND', 'benefits_and_refunds'), ('INCOME_UNEMPLOYMENT', 'benefits_and_refunds'),
  ('INCOME_LONG_TERM_DISABILITY', 'benefits_and_refunds'), ('INCOME_RETIREMENT_PENSION', 'benefits_and_refunds'),
  ('INCOME_CHILD_SUPPORT', 'benefits_and_refunds'),
  ('TRANSFER_IN_ACCOUNT_TRANSFER', 'account_transfers'), ('TRANSFER_IN_DEPOSIT', 'account_transfers'),
  ('TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS', 'account_transfers'), ('TRANSFER_IN_SAVINGS', 'account_transfers'),
  ('TRANSFER_IN_TRANSFER_IN_FROM_APPS', 'account_transfers'), ('TRANSFER_IN_WIRE', 'account_transfers'),
  ('TRANSFER_IN_OTHER_TRANSFER_IN', 'account_transfers'),
  ('TRANSFER_OUT_ACCOUNT_TRANSFER', 'account_transfers'), ('TRANSFER_OUT_CRYPTO', 'account_transfers'),
  ('TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS', 'account_transfers'), ('TRANSFER_OUT_SAVINGS', 'account_transfers'),
  ('TRANSFER_OUT_TRANSFER_OUT_FROM_APPS', 'account_transfers'), ('TRANSFER_OUT_WIRE', 'account_transfers'),
  ('TRANSFER_OUT_WITHDRAWAL', 'account_transfers'), ('TRANSFER_OUT_OTHER_TRANSFER_OUT', 'account_transfers'),
  ('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', 'credit_card_payment'),
  ('LOAN_DISBURSEMENTS_AUTO', 'loan_disbursements'), ('LOAN_DISBURSEMENTS_CASH_ADVANCES', 'loan_disbursements'),
  ('LOAN_DISBURSEMENTS_EWA', 'loan_disbursements'), ('LOAN_DISBURSEMENTS_MORTGAGE', 'loan_disbursements'),
  ('LOAN_DISBURSEMENTS_PERSONAL', 'loan_disbursements'), ('LOAN_DISBURSEMENTS_STUDENT', 'loan_disbursements'),
  ('LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT', 'loan_disbursements'),
  ('FOOD_AND_DRINK_GROCERIES', 'groceries'),
  ('FOOD_AND_DRINK_RESTAURANT', 'restaurants_and_bars'), ('FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', 'restaurants_and_bars'),
  ('FOOD_AND_DRINK_FAST_FOOD', 'fast_food'),
  ('FOOD_AND_DRINK_COFFEE', 'coffee_shops'),
  ('RENT_AND_UTILITIES_RENT', 'rent'),
  ('RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'gas_and_electric'),
  ('RENT_AND_UTILITIES_INTERNET_AND_CABLE', 'internet_and_cable'),
  ('RENT_AND_UTILITIES_TELEPHONE', 'phone'),
  ('RENT_AND_UTILITIES_WATER', 'water_and_waste'), ('RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT', 'water_and_waste'),
  ('TRANSPORTATION_GAS', 'fuel'),
  ('TRANSPORTATION_PARKING', 'parking_and_tolls'), ('TRANSPORTATION_TOLLS', 'parking_and_tolls'),
  ('TRANSPORTATION_PUBLIC_TRANSIT', 'public_transit'),
  ('TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'rideshare_and_taxi'), ('TRANSPORTATION_BIKES_AND_SCOOTERS', 'rideshare_and_taxi'),
  ('GENERAL_SERVICES_AUTOMOTIVE', 'auto_maintenance'),
  ('GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES', 'clothing'),
  ('GENERAL_MERCHANDISE_ELECTRONICS', 'electronics'),
  ('GENERAL_MERCHANDISE_DEPARTMENT_STORES', 'department_and_superstores'),
  ('GENERAL_MERCHANDISE_DISCOUNT_STORES', 'department_and_superstores'),
  ('GENERAL_MERCHANDISE_SUPERSTORES', 'department_and_superstores'),
  ('GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 'online_marketplaces'),
  ('GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES', 'gifts'),
  ('GENERAL_MERCHANDISE_PET_SUPPLIES', 'pet_supplies'),
  ('GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS', 'books_and_office'),
  ('GENERAL_MERCHANDISE_OFFICE_SUPPLIES', 'books_and_office'),
  ('ENTERTAINMENT_TV_AND_MOVIES', 'streaming_and_music'), ('ENTERTAINMENT_MUSIC_AND_AUDIO', 'streaming_and_music'),
  ('ENTERTAINMENT_VIDEO_GAMES', 'video_games'),
  ('ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS', 'events_and_outings'),
  ('ENTERTAINMENT_CASINOS_AND_GAMBLING', 'gambling'),
  ('TRAVEL_FLIGHTS', 'flights'), ('TRAVEL_LODGING', 'lodging'), ('TRAVEL_RENTAL_CARS', 'rental_cars'),
  ('MEDICAL_PRIMARY_CARE', 'doctor'), ('MEDICAL_NURSING_CARE', 'doctor'),
  ('MEDICAL_DENTAL_CARE', 'dentist'),
  ('MEDICAL_EYE_CARE', 'eye_care'),
  ('MEDICAL_PHARMACIES_AND_SUPPLEMENTS', 'pharmacy'),
  ('MEDICAL_VETERINARY_SERVICES', 'veterinary'),
  ('PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', 'fitness'),
  ('PERSONAL_CARE_HAIR_AND_BEAUTY', 'hair_and_beauty'),
  ('PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING', 'laundry'),
  ('HOME_IMPROVEMENT_FURNITURE', 'furniture'),
  ('HOME_IMPROVEMENT_HARDWARE', 'hardware_and_repairs'), ('HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE', 'hardware_and_repairs'),
  ('GENERAL_SERVICES_INSURANCE', 'insurance'),
  ('GENERAL_SERVICES_CHILDCARE', 'childcare'),
  ('GENERAL_SERVICES_EDUCATION', 'education'),
  ('GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING', 'financial_and_legal'),
  ('GENERAL_SERVICES_CONSULTING_AND_LEGAL', 'financial_and_legal'),
  ('GENERAL_SERVICES_POSTAGE_AND_SHIPPING', 'shipping_and_storage'), ('GENERAL_SERVICES_STORAGE', 'shipping_and_storage'),
  ('LOAN_PAYMENTS_MORTGAGE_PAYMENT', 'mortgage'),
  ('LOAN_PAYMENTS_CAR_PAYMENT', 'auto_loan'),
  ('LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT', 'student_loan'),
  ('LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', 'personal_loan'),
  ('LOAN_PAYMENTS_BNPL', 'buy_now_pay_later'),
  ('BANK_FEES_INTEREST_CHARGE', 'interest_charges'),
  ('BANK_FEES_ATM_FEES', 'atm_fees'),
  ('BANK_FEES_OVERDRAFT_FEES', 'overdraft_and_late_fees'), ('BANK_FEES_INSUFFICIENT_FUNDS', 'overdraft_and_late_fees'),
  ('BANK_FEES_LATE_FEES', 'overdraft_and_late_fees'),
  ('GOVERNMENT_AND_NON_PROFIT_DONATIONS', 'donations'),
  ('GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', 'taxes')
) as v(code, slug)
join public.categories c on c.slug = v.slug;

-- A PFC v2 primary the Phase 2 map never had: its 133 rows sat in
-- Uncategorized. Its detailed codes all map to Loan Disbursements above; this
-- catches any future detailed code under it.
insert into public.plaid_category_map (pfc_primary, category_id)
select 'LOAN_DISBURSEMENTS', id from public.categories where slug = 'transfer';

-- One merchant key, the SQL twin of normalizeMerchant(merchant_name ?? name) in
-- _shared/recurring.ts: lowercase letters only, runs of anything else become one
-- space, trimmed. Rules and renames (7c) key on it; the index serves "this
-- user's rows for this merchant". Covered by the existing table-level select.
alter table public.transactions
  add column merchant_key text generated always as (
    btrim(regexp_replace(lower(coalesce(merchant_name, name)), '[^a-z]+', ' ', 'g'))
  ) stored,
  -- Plaid's cross-bank merchant id: groundwork for community categorization.
  -- Filled from now on; older rows fill in only as Plaid re-sends them.
  add column merchant_entity_id text;

create index transactions_user_merchant_key_idx on public.transactions (user_id, merchant_key);

-- Re-resolve every row Plaid categorized: detailed, then primary, then
-- uncategorized — the same precedence syncItem applies. Manual rows are never
-- touched.
update public.transactions t
set category_id = r.resolved
from (
  select t2.id, coalesce(dm.category_id, pm.category_id, u.id) as resolved
  from public.transactions t2
  cross join (select id from public.categories where slug = 'uncategorized') u
  left join public.plaid_detailed_map dm on dm.pfc_detailed = t2.pfc_detailed
  left join public.plaid_category_map pm on pm.pfc_primary = t2.pfc_primary
  where not t2.category_is_manual
) r
where t.id = r.id and t.category_id is distinct from r.resolved;
```

- [ ] **Step 3: Push**

Run (repo root): `npx supabase db push`
Expected: `20260924190000_phase7a_category_groups.sql` applied.

- [ ] **Step 4: Verify.** Run the Step 1 queries again, plus these:

```sh
npx --no-install supabase db query --linked -o csv "select count(*) filter (where parent_id is null) groups, count(*) filter (where parent_id is not null) children, count(*) filter (where parent_id is not null and kind <> (select g.kind from categories g where g.id = categories.parent_id)) kind_mismatch from categories"
npx --no-install supabase db query --linked -o csv "select count(*) detailed_rows from plaid_detailed_map"
npx --no-install supabase db query --linked -o csv "select c.relname, c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('plaid_detailed_map','categories','transactions')"
npx --no-install supabase db query --linked -o csv "select c.slug, count(*) from transactions t join categories c on c.id=t.category_id where t.pfc_primary='LOAN_DISBURSEMENTS' or t.pfc_detailed='LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' group by 1"
```

Expected:
- **Manual rows.** `manual_rows` and `manual_checksum` are identical to Step 1.
- **Uncategorized** drops by `loan_disb`.
- **Tree.** `groups=16, children=61, kind_mismatch=0`, and `detailed_rows=102`.
- **ACLs.** `plaid_detailed_map`'s relacl lists only `postgres` and `service_role`.
- **Reclassified rows.** The last query lists only `loan_disbursements`, `credit_card_payment`, and slugs of manual rows.

- [ ] **Step 5: Parity check** (`merchant_key` in SQL vs `normalizeMerchant` in JS):

```sh
npx --no-install supabase db query --linked -o json "select merchant_name, name, merchant_key from transactions" > "$SCRATCH/mk.json"
node -e "
const rows = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
const list = Array.isArray(rows) ? rows : rows.rows ?? rows.data ?? [];
const norm = (raw) => raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const bad = list.filter((r) => norm(r.merchant_name ?? r.name) !== r.merchant_key);
console.log('rows', list.length, 'mismatches', bad.length, JSON.stringify(bad.slice(0, 3)));
" "$SCRATCH_WIN/mk.json"
```

Expected: `mismatches 0`. `$SCRATCH` and `$SCRATCH_WIN` are the session scratchpad in Git Bash and Windows forms. If the JSON shape differs, print its top-level keys and adapt the `list` line.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260924190000_phase7a_category_groups.sql
git commit -m "feat(db): category groups — 61 finer categories, detailed map, backfill"
```

### Task 2: Server — precedence resolver, detailed map in sync, card-payment exception

**Files:**
- Modify: `supabase/functions/_shared/categorize.ts`
- Modify: `supabase/functions/_shared/categorize.test.ts`
- Modify: `supabase/functions/_shared/recurring.ts` (add `ignoredCategoryIds`)
- Modify: `supabase/functions/_shared/recurring.test.ts`
- Modify: `supabase/functions/_shared/sync.ts` (`SyncContext`, `loadSyncContext`, row mapping)

**Interfaces:**
- Consumes: Task 1's tables.
- Produces:
  - `resolveCategoryId(sources: { rule?: string | null; detailed?: string | null; primary?: string | null }, maps: { detailed: CategoryMap; primary: CategoryMap }, fallbackId: string): string`.
  - `ignoredCategoryIds(categories: { id: string; kind: string; slug: string | null }[]): string[]`.
  - `SyncContext.detailedMap: CategoryMap`.

- [ ] **Step 1: Write failing tests.** In `categorize.test.ts`, replace the three `resolveCategoryId` tests and the `MAP` const with these:

```ts
const MAPS = {
  detailed: { FOOD_AND_DRINK_COFFEE: 'cat-coffee' },
  primary: { FOOD_AND_DRINK: 'cat-food', INCOME: 'cat-income' },
};
const FALLBACK = 'cat-uncategorized';

Deno.test('resolveCategoryId prefers the detailed code', () => {
  assertEquals(
    resolveCategoryId({ detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    'cat-coffee',
  );
});

Deno.test('resolveCategoryId falls to the primary for an unmapped detailed code', () => {
  // e.g. FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK lands on the group itself
  assertEquals(
    resolveCategoryId({ detailed: 'FOOD_AND_DRINK_VENDING_MACHINES', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    'cat-food',
  );
});

Deno.test('resolveCategoryId falls to the primary when there is no detailed code', () => {
  // Older rows can have pfc_detailed null.
  assertEquals(resolveCategoryId({ detailed: null, primary: 'INCOME' }, MAPS, FALLBACK), 'cat-income');
});

Deno.test('resolveCategoryId falls back when nothing maps', () => {
  assertEquals(resolveCategoryId({ primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), FALLBACK);
  assertEquals(resolveCategoryId({}, MAPS, FALLBACK), FALLBACK);
  assertEquals(resolveCategoryId({ detailed: undefined, primary: undefined }, MAPS, FALLBACK), FALLBACK);
});

Deno.test('resolveCategoryId puts a merchant rule above Plaid', () => {
  assertEquals(
    resolveCategoryId({ rule: 'cat-rule', detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    'cat-rule',
  );
});
```

Update the import line to keep `pickCategoryId` and `toSignedAmount`; leave their tests unchanged. Append to `recurring.test.ts`, and add `ignoredCategoryIds` to its import from `./recurring.ts`:

```ts
Deno.test('ignoredCategoryIds is every transfer except card payments', () => {
  const ids = ignoredCategoryIds([
    { id: 'g-transfer', kind: 'transfer', slug: 'transfer' },
    { id: 'c-accounts', kind: 'transfer', slug: 'account_transfers' },
    { id: 'c-card', kind: 'transfer', slug: 'credit_card_payment' },
    { id: 'c-coffee', kind: 'expense', slug: 'coffee_shops' },
    { id: 'c-pay', kind: 'income', slug: 'paychecks' },
  ]);
  // A card payment is a transfer for spending, but still a bill with a due date.
  assertEquals(ids.sort(), ['c-accounts', 'g-transfer']);
});
```

- [ ] **Step 2: Run them to see the failure**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: type errors. `resolveCategoryId`'s signature doesn't match, and `ignoredCategoryIds` is not exported.

- [ ] **Step 3: Implement.** In `categorize.ts`, replace `resolveCategoryId`:

```ts
/**
 * Resolve a transaction's category from its sources, in precedence order:
 * a merchant rule (7c), then Plaid's detailed code, then Plaid's primary code
 * (whose entries point at groups), then the fallback. The ordered sources leave
 * a slot for a future community source between rule and detailed. A manual
 * choice is applied on top by pickCategoryId, so it always wins.
 */
export function resolveCategoryId(
  sources: { rule?: string | null; detailed?: string | null; primary?: string | null },
  maps: { detailed: CategoryMap; primary: CategoryMap },
  fallbackId: string,
): string {
  return (
    sources.rule ||
    (sources.detailed ? maps.detailed[sources.detailed] : undefined) ||
    (sources.primary ? maps.primary[sources.primary] : undefined) ||
    fallbackId
  );
}
```

Update the `CategoryMap` doc comment to "PFC code (primary or detailed) -> our category UUID." In `recurring.ts`, next to `detectStreams`:

```ts
/**
 * The categories detection ignores: every transfer — money moving between
 * your own accounts is not a bill — except Credit Card Payment, which is a
 * transfer for spending purposes but still a recurring bill with a due date.
 */
export function ignoredCategoryIds(categories: { id: string; kind: string; slug: string | null }[]): string[] {
  return categories.filter((c) => c.kind === 'transfer' && c.slug !== 'credit_card_payment').map((c) => c.id);
}
```

In `sync.ts`:
- `SyncContext` gains `detailedMap: CategoryMap`.
- In `loadSyncContext`, load `plaid_detailed_map` (`pfc_detailed, category_id`) the same way as the primary map, throwing `failed to load detailed map: …` on error.
- Replace the transfer query with `admin.from('categories').select('id, kind, slug')`, and set `transferCategoryIds: ignoredCategoryIds(rows ?? [])`, importing it from `./recurring.ts`.
- Keep the field name `transferCategoryIds`, because `refreshRecurring`'s signature uses it, and update its doc comment to "Categories recurring detection ignores (transfers, except card payments)".
- In `syncItem`, destructure `detailedMap`. The row mapping's `incoming` becomes:

```ts
          const incoming = resolveCategoryId(
            {
              detailed: t.personal_finance_category?.detailed,
              primary: t.personal_finance_category?.primary,
            },
            { detailed: detailedMap, primary: categoryMap },
            fallbackId,
          );
```

Also add `merchant_entity_id: t.merchant_entity_id ?? null,` to the row object, after `merchant_name`. Every row always carries the key, which PostgREST requires within one upsert.

- [ ] **Step 4: Run the tests and type checks**

Run: `npx -y deno test supabase/functions/_shared/ && npx -y deno check supabase/functions/plaid-sync-transactions/index.ts supabase/functions/plaid-webhook/index.ts`
Expected: 70 existing tests − 3 removed + 5 new + 1 new = 73 passed, 0 failed, and both files check.

- [ ] **Step 5: Deploy** (the migration is already pushed)

Run: `npx supabase functions deploy plaid-sync-transactions --use-api && npx supabase functions deploy plaid-webhook --use-api`
Expected: both deployed.

- [ ] **Step 6: Smoke test.** Pull to refresh on the emulator's Transactions tab, then:

```sh
npx --no-install supabase db query --linked -o csv "select count(*) filter (where merchant_entity_id is not null) with_entity, max(updated_at) from transactions where user_id='ccbd42ef-cba6-4f05-a100-a83a727255b2'"
```

Expected: no sync error in the app, and `node scripts/emu.mjs logs` is clean. `with_entity` may still be 0, because Sandbox only re-sends modified rows. That is fine; just record it.

- [ ] **Step 7: Commit** — `feat: detailed-code categorization in sync; card payments stay on the bills radar`

### Task 3: App test runner + `lib/categories.ts`

**Files:**
- Modify: `apps/mobile/package.json` (the `test` script)
- Modify: `apps/mobile/tsconfig.json` (`allowImportingTsExtensions`)
- Modify: `apps/mobile/src/lib/queries.ts` (`Category.parent_id`, `useCategories` select)
- Create: `apps/mobile/src/lib/categories.ts`
- Create: `apps/mobile/src/lib/categories.test.ts`

**Interfaces:**
- Produces (from `lib/categories.ts`):
  - `type CategoriesById = Map<string, Category>` and `type CategoryNode = Category & { children: Category[] }`.
  - `buildTree(categories: Category[]): CategoryNode[]`.
  - `groupIdOf(id: string, byId: CategoriesById): string`.
  - `rollupByGroup(amounts: Map<string, number>, byId: CategoriesById): Map<string, number>`.
  - `budgetsReplacedBy(categoryId: string, budgets: Budget[], byId: CategoriesById): Budget[]`.
  - `sectionsByKind(tree: CategoryNode[]): { kind: Category['kind']; groups: CategoryNode[] }[]`.
- Also produces `Category.parent_id: string | null`.
- Deviation from the spec's list, which it names `budgetConflicts`. The UI's actual need is "which budgets does this save replace", so `budgetsReplacedBy` replaces it. A save through it can never create an overlap, so a conflict detector would have nothing to find.

- [ ] **Step 1: Set up the runner.**
  - In `apps/mobile/package.json` scripts add `"test": "node --test src/lib/*.test.ts"`. Node expands the glob itself, so this works under cmd.exe.
  - In `tsconfig.json` `compilerOptions` add `"allowImportingTsExtensions": true`. `expo/tsconfig.base` already sets `noEmit`.
  - In `queries.ts`, `Category` gains `parent_id: string | null;`, and `useCategories` selects `'id, slug, name, kind, icon, color, sort_order, parent_id'`.

- [ ] **Step 2: Write the failing tests** (`src/lib/categories.test.ts`):

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Budget, Category } from './queries';
import { budgetsReplacedBy, buildTree, groupIdOf, rollupByGroup, sectionsByKind } from './categories.ts';

const cat = (id: string, parent_id: string | null, kind: Category['kind'] = 'expense', sort_order = 1): Category => ({
  id, parent_id, kind, sort_order, slug: id, name: id, icon: 'Tag', color: '#000000',
});

const food = cat('food', null, 'expense', 3);
const coffee = cat('coffee', 'food', 'expense', 2);
const groceries = cat('groceries', 'food', 'expense', 1);
const income = cat('income', null, 'income', 1);
const transfer = cat('transfer', null, 'transfer', 2);
const card = cat('card', 'transfer', 'transfer', 1);
const all = [coffee, food, groceries, income, card, transfer];
const byId = new Map(all.map((c) => [c.id, c]));
const budget = (id: string, category_id: string): Budget => ({ id, category_id, amount: 100 });

test('buildTree nests children under groups, both in sort_order', () => {
  const tree = buildTree(all);
  assert.deepEqual(tree.map((g) => g.id), ['income', 'transfer', 'food']);
  assert.deepEqual(tree[2].children.map((c) => c.id), ['groceries', 'coffee']);
});

test('buildTree drops a child whose group is missing', () => {
  assert.deepEqual(buildTree([coffee]), []);
});

test('groupIdOf maps a child to its group and a group to itself', () => {
  assert.equal(groupIdOf('coffee', byId), 'food');
  assert.equal(groupIdOf('food', byId), 'food');
});

test('groupIdOf keeps an unknown id as itself', () => {
  // A stale category cache must never crash a rollup or move money.
  assert.equal(groupIdOf('not-loaded-yet', byId), 'not-loaded-yet');
});

test('rollupByGroup sums a group\'s own rows with its children\'s, negatives included', () => {
  const out = rollupByGroup(new Map([['food', 10], ['coffee', 5], ['groceries', -2], ['unknown', 7]]), byId);
  assert.equal(out.get('food'), 13);
  assert.equal(out.get('unknown'), 7);
  assert.equal(out.has('coffee'), false);
});

test('budgetsReplacedBy: a group budget replaces its children\'s', () => {
  const budgets = [budget('b1', 'coffee'), budget('b2', 'groceries'), budget('b3', 'income')];
  assert.deepEqual(budgetsReplacedBy('food', budgets, byId).map((b) => b.id), ['b1', 'b2']);
});

test('budgetsReplacedBy: a child budget replaces its group\'s, never a sibling\'s', () => {
  const budgets = [budget('b1', 'food'), budget('b2', 'groceries')];
  assert.deepEqual(budgetsReplacedBy('coffee', budgets, byId).map((b) => b.id), ['b1']);
});

test('budgetsReplacedBy: changing an existing budget replaces nothing', () => {
  assert.deepEqual(budgetsReplacedBy('coffee', [budget('b1', 'coffee')], byId), []);
  assert.deepEqual(budgetsReplacedBy('unknown', [budget('b1', 'food')], byId), []);
});

test('sectionsByKind orders expense, income, transfer and drops empty kinds', () => {
  const sections = sectionsByKind(buildTree([food, coffee, transfer, card]));
  assert.deepEqual(sections.map((s) => s.kind), ['expense', 'transfer']);
});
```

- [ ] **Step 3: Run them to see the failure**

Run: `cd apps/mobile && npm test`
Expected: FAIL. `Cannot find module …/categories.ts`.

- [ ] **Step 4: Implement `src/lib/categories.ts`**

```ts
/**
 * The category tree: groups (parent_id null) and their children. Pure, with
 * type-only imports, so `node --test` runs it with no bundler (Node strips the
 * types). Anything the picker, Budgets and Reports need to know about groups
 * lives here.
 */
import type { Budget, Category } from '@/lib/queries';

export type CategoriesById = Map<string, Category>;
export type CategoryNode = Category & { children: Category[] };

const bySortOrder = (a: Category, b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/** Groups in sort_order, each holding its children in sort_order. A child whose group is missing is dropped. */
export function buildTree(categories: Category[]): CategoryNode[] {
  const groups = new Map<string, CategoryNode>();
  for (const c of categories) if (c.parent_id === null) groups.set(c.id, { ...c, children: [] });
  for (const c of categories) if (c.parent_id !== null) groups.get(c.parent_id)?.children.push(c);
  for (const group of groups.values()) group.children.sort(bySortOrder);
  return [...groups.values()].sort(bySortOrder);
}

/**
 * A group's own id, or a child's group. An id we do not know — say, a
 * category cache from before a migration — maps to itself, so it is kept and
 * counted rather than lost.
 */
export function groupIdOf(id: string, byId: CategoriesById): string {
  return byId.get(id)?.parent_id ?? id;
}

/** Per-category amounts summed per group: each group's own rows plus its children's. */
export function rollupByGroup(amounts: Map<string, number>, byId: CategoriesById): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, amount] of amounts) {
    const groupId = groupIdOf(id, byId);
    out.set(groupId, (out.get(groupId) ?? 0) + amount);
  }
  return out;
}

/**
 * The budgets a new budget on `categoryId` replaces, so that a group and its
 * children are never budgeted at once and nothing counts twice. Setting a
 * group's replaces its children's; setting a child's replaces its group's. A
 * sibling's never.
 */
export function budgetsReplacedBy(categoryId: string, budgets: Budget[], byId: CategoriesById): Budget[] {
  const category = byId.get(categoryId);
  if (!category) return [];
  if (category.parent_id === null) {
    return budgets.filter((b) => byId.get(b.category_id)?.parent_id === categoryId);
  }
  return budgets.filter((b) => b.category_id === category.parent_id);
}

const KIND_ORDER: Category['kind'][] = ['expense', 'income', 'transfer'];

/** The picker's sections: expense groups first, then income, then transfers. Empty kinds are dropped. */
export function sectionsByKind(tree: CategoryNode[]): { kind: Category['kind']; groups: CategoryNode[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, groups: tree.filter((g) => g.kind === kind) })).filter(
    (s) => s.groups.length > 0,
  );
}
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `cd apps/mobile && npm test && npm run typecheck && npx expo lint`
Expected: 9 tests pass; typecheck and lint are clean. If typecheck rejects `import … from './categories.ts'`, confirm `allowImportingTsExtensions` is set. If it can't find `node:test` types, `@types/node` is already in node_modules; do not add a dependency without ledgering a ruling.

- [ ] **Step 6: Commit** — `feat: category tree helpers with a zero-dependency test runner`

### Task 4: Reports by group, with a drill-in

**Files:**
- Modify: `apps/mobile/src/lib/reports.ts`
- Create: `apps/mobile/src/lib/reports.test.ts`
- Modify: `apps/mobile/src/app/(tabs)/reports.tsx`

**Interfaces:**
- Consumes: `groupIdOf` and `CategoriesById` from `./categories.ts`.
- Produces:
  - `buildCategorySlices(rows, byId)`, now one slice per **group**.
  - `buildGroupBreakdown(rows: MonthlyTotal[], groupId: string, byId: CategoriesById): CategorySlice[]`.

- [ ] **Step 1: Write the failing tests** (`src/lib/reports.test.ts`):

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Category, MonthlyTotal } from './queries';
import { buildCashFlow, buildCategorySlices, buildGroupBreakdown } from './reports.ts';

const cat = (id: string, parent_id: string | null, kind: Category['kind'] = 'expense'): Category => ({
  id, parent_id, kind, sort_order: 1, slug: id, name: id, icon: 'Tag', color: '#000000',
});
const byId = new Map(
  [cat('food', null), cat('coffee', 'food'), cat('groceries', 'food'), cat('fun', null),
    cat('transfer', null, 'transfer'), cat('card', 'transfer', 'transfer'), cat('income', null, 'income')]
    .map((c) => [c.id, c]),
);
const row = (category_id: string, total: number, month = '2026-09-01'): MonthlyTotal => ({
  month, category_id, iso_currency_code: 'USD', total, transaction_count: 1,
});

test('buildCategorySlices rolls children up into one slice per group', () => {
  const slices = buildCategorySlices([row('coffee', -20), row('groceries', -60), row('food', -20), row('fun', -50)], byId);
  assert.deepEqual(slices.map((s) => [s.id, s.spent]), [['food', 100], ['fun', 50]]);
  assert.equal(slices[0].name, 'food');
});

test('buildCategorySlices leaves out transfer children, card payments included', () => {
  const slices = buildCategorySlices([row('card', -500), row('coffee', -5)], byId);
  assert.deepEqual(slices.map((s) => s.id), ['food']);
});

test('buildGroupBreakdown splits one group, labels its own rows "(general)", and drops refunds', () => {
  const parts = buildGroupBreakdown(
    [row('coffee', -30), row('groceries', 10), row('food', -10), row('fun', -99)],
    'food',
    byId,
  );
  assert.deepEqual(parts.map((p) => [p.id, p.spent, p.name]), [['coffee', 30, 'coffee'], ['food', 10, 'food (general)']]);
  assert.equal(parts.reduce((sum, p) => sum + p.share, 0), 1);
});

test('buildCashFlow keeps a transfer child out of expenses', () => {
  const [month] = buildCashFlow([row('card', -500), row('coffee', -5), row('income', 1000)], ['2026-09-01'], byId);
  assert.deepEqual([month.income, month.expense, month.net], [1000, 5, 995]);
});
```

- [ ] **Step 2: Run them to see the failure**

Run: `cd apps/mobile && npm test`
Expected: FAIL. `buildGroupBreakdown` is not exported, and the first test yields per-category slices.

- [ ] **Step 3: Implement in `reports.ts`.**
  - Replace the local `CategoriesById` export with `import { type CategoriesById, groupIdOf } from './categories.ts';` and `export type { CategoriesById };`.
  - Keep `import type { MonthlyTotal } from '@/lib/queries';`.
  - In `buildCategorySlices`, change `const key = row.category_id ?? NO_CATEGORY;` to `const key = row.category_id ? groupIdOf(row.category_id, categoriesById) : NO_CATEGORY;`.
  - Update its doc comment to say slices are **groups**, each group's own rows plus its children's.
  - Append:

```ts
/**
 * One group's spend split by category, for the Reports drill-in: its children,
 * plus the group itself — "(general)" — for rows categorized at group level,
 * which manual overrides from before Phase 7 and unmapped Plaid codes both are.
 * Biggest first, and non-positive entries (a month of refunds) are dropped, as
 * in the donut; shares are of what remains.
 */
export function buildGroupBreakdown(
  rows: MonthlyTotal[],
  groupId: string,
  categoriesById: CategoriesById,
): CategorySlice[] {
  const spentById = new Map<string, number>();
  for (const row of rows) {
    if (!row.category_id || groupIdOf(row.category_id, categoriesById) !== groupId) continue;
    spentById.set(row.category_id, (spentById.get(row.category_id) ?? 0) + spentFor(row.total));
  }

  const parts = [...spentById]
    .filter(([, spent]) => spent > 0)
    .map(([id, spent]) => {
      const category = categoriesById.get(id);
      const name = category?.name ?? 'Uncategorized';
      return {
        id,
        name: id === groupId ? `${name} (general)` : name,
        color: category?.color ?? '#94A198',
        icon: category?.icon ?? 'CircleDashed',
        spent,
        share: 0,
      };
    })
    .sort((a, b) => b.spent - a.spent);

  const total = parts.reduce((sum, part) => sum + part.spent, 0);
  return total === 0 ? parts : parts.map((part) => ({ ...part, share: part.spent / total }));
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/mobile && npm test`
Expected: 13 pass (9 + 4).

- [ ] **Step 5: The drill-in on `reports.tsx`.** Add `Pressable` to the `react-native` import, `buildGroupBreakdown` to the `@/lib/reports` import, and these hooks after `slices`:

```tsx
  // One group open at a time; it stays open across months and simply shows
  // nothing for a month where that group had no spend.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const breakdown = useMemo(
    () =>
      openGroup
        ? buildGroupBreakdown(totals.filter((t) => t.month === month), openGroup, categoriesById)
        : [],
    [openGroup, totals, month, categoriesById],
  );
```

Replace the `slices.map(...)` list body with:

```tsx
                  {slices.map((slice) => (
                    <View key={slice.id} style={{ gap: Spacing.sm }}>
                      <Pressable
                        onPress={() => setOpenGroup(openGroup === slice.id ? null : slice.id)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: Spacing.sm + 2,
                          opacity: pressed ? 0.7 : 1,
                        })}>
                        <View
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: Radius.full,
                            backgroundColor: colors.elevated,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                          <CategoryIcon name={slice.icon} size={15} color={slice.color} />
                        </View>
                        <AppText variant="label" style={{ flex: 1 }}>
                          {slice.name}
                        </AppText>
                        <AppText variant="caption" tone="dim" style={{ width: 42, textAlign: 'right' }}>
                          {Math.round(slice.share * 100)}%
                        </AppText>
                        <Amount value={slice.spent} size={14} />
                      </Pressable>

                      {openGroup === slice.id
                        ? breakdown.map((part) => (
                            <View key={part.id} style={{ paddingLeft: 30 + Spacing.sm + 2, gap: Spacing.xs }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                                <AppText variant="caption" style={{ flex: 1 }}>
                                  {part.name}
                                </AppText>
                                <AppText variant="caption" tone="dim">
                                  {Math.round(part.share * 100)}%
                                </AppText>
                                <Amount value={part.spent} size={13} />
                              </View>
                              <View
                                style={{
                                  height: 4,
                                  borderRadius: Radius.full,
                                  backgroundColor: colors.elevated,
                                  overflow: 'hidden',
                                }}>
                                <View
                                  style={{
                                    width: `${part.share * 100}%`,
                                    height: '100%',
                                    backgroundColor: part.color,
                                  }}
                                />
                              </View>
                            </View>
                          ))
                        : null}
                    </View>
                  ))}
```

- [ ] **Step 6:** Run `cd apps/mobile && npm test && npm run typecheck && npx expo lint`. Expect all clean.
  - On the emulator, reload the app. This proves Metro resolves `reports.ts`'s `./categories.ts` import.
  - Open Reports and tap Food & Dining. Expect its breakdown lines to appear, and a second tap to close them.
  - Commit: `feat: reports roll up by group, with a per-group breakdown`

### Task 5: Two-level `CategoryPicker`

**Files:**
- Modify: `apps/mobile/src/components/category-picker.tsx`

**Interfaces:**
- Consumes: `buildTree` and `sectionsByKind`.
- The props (`visible, selectedId, onSelect, onClose`) are unchanged, so `transactions.tsx` needs no edit.

- [ ] **Step 1: Implement.** Replace the file's body below the imports. Add `import { useMemo } from 'react';` and `import { buildTree, sectionsByKind } from '@/lib/categories';`, and drop `KIND_ORDER`:

```tsx
const KIND_LABEL: Record<Category['kind'], string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
};

type Props = {
  visible: boolean;
  selectedId: string | null;
  onSelect: (category: Category) => void;
  onClose: () => void;
};

export function CategoryPicker({ visible, selectedId, onSelect, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data: categories = [] } = useCategories();
  const sections = useMemo(() => sectionsByKind(buildTree(categories)), [categories]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View
        style={{
          maxHeight: '75%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: Radius.xl,
          borderTopRightRadius: Radius.xl,
          paddingTop: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.md,
        }}>
        <AppText variant="title" style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
          Category
        </AppText>

        <ScrollView>
          {sections.map(({ kind, groups }) => (
            <View key={kind}>
              <AppText
                variant="caption"
                tone="dim"
                style={{
                  paddingHorizontal: Spacing.md,
                  paddingTop: Spacing.md,
                  paddingBottom: Spacing.xs,
                  textTransform: 'uppercase',
                  letterSpacing: 1.1,
                }}>
                {KIND_LABEL[kind]}
              </AppText>
              {groups.map((group) => (
                <View key={group.id}>
                  {/* A group is itself selectable: "this group, nothing finer". */}
                  <Row category={group} selected={group.id === selectedId} onPress={() => onSelect(group)} />
                  {group.children.map((child) => (
                    <Row
                      key={child.id}
                      category={child}
                      selected={child.id === selectedId}
                      indent
                      onPress={() => onSelect(child)}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({
  category,
  selected,
  indent = false,
  onPress,
}: {
  category: Category;
  selected: boolean;
  indent?: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm + 2,
        paddingHorizontal: Spacing.md,
        paddingLeft: indent ? Spacing.md + 34 + Spacing.sm : Spacing.md,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View
        style={{
          width: indent ? 28 : 34,
          height: indent ? 28 : 34,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <CategoryIcon name={category.icon} size={indent ? 14 : 17} color={category.color} />
      </View>
      <AppText variant={indent ? 'body' : 'label'} style={{ flex: 1 }}>
        {category.name}
      </AppText>
      {selected ? <Check size={18} color={colors.brand} /> : null}
    </Pressable>
  );
}
```
- [ ] **Step 2:** Run `cd apps/mobile && npm run typecheck && npx expo lint`. Then on the emulator, open a transaction's picker: `node scripts/emu.mjs tap Transactions`, tap a row, then `node scripts/emu.mjs ui`.
  - Expect "Food & Dining" followed by Groceries, Restaurants & Bars, Fast Food and Coffee Shops.
  - Selecting "Coffee Shops" changes the row's category label.
  - Revert the change, then reset `category_is_manual` by SQL as in Phase 6.
- [ ] **Step 3: Commit** — `feat: two-level category picker`

### Task 6: Budgets by group or category

**Files:**
- Modify: `apps/mobile/src/components/budget-row.tsx` (an `indent` prop)
- Modify: `apps/mobile/src/app/(tabs)/budgets.tsx`

**Interfaces:**
- Consumes: `buildTree`, `rollupByGroup`, `budgetsReplacedBy`, `useSetBudget`, `useDeleteBudget` (its `mutateAsync` is used) and `spentByCategory`.

- [ ] **Step 1: `BudgetRow`.**
  - Add an optional `indent?: boolean` to `Props`. When set, the outer `Pressable` gets `paddingLeft: Spacing.lg + Spacing.xs`.
  - Add an optional `label?: string` that overrides `category.name`, used for "(general)".
- [ ] **Step 2: Budgets screen.** Replace the derived values and the two sections. The summary card, `MonthStepper`, empty state and `BudgetSheet` wiring stay; `onSave` now calls `save`.

```tsx
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const spent = useMemo(() => spentByCategory(totals), [totals]);
  const spentByGroup = useMemo(() => rollupByGroup(spent, byId), [spent, byId]);
  const budgetByCategory = useMemo(() => new Map(budgets.map((b) => [b.category_id, b])), [budgets]);
  const [showAll, setShowAll] = useState(false);

  // Only expenses are budgetable. Income and transfers — card payments
  // included — are not spending.
  const groups = useMemo(
    () =>
      buildTree(categories)
        .filter((g) => g.kind === 'expense')
        .sort((a, b) => (spentByGroup.get(b.id) ?? 0) - (spentByGroup.get(a.id) ?? 0)),
    [categories, spentByGroup],
  );

  // What a budget's bar measures: a group budget covers its own rows plus its
  // children's, a category budget just its own. No overlap exists, because
  // budgetsReplacedBy removes it on save, so nothing counts twice.
  const spentUnder = (c: Category) => (c.parent_id === null ? spentByGroup.get(c.id) ?? 0 : spent.get(c.id) ?? 0);
  const budgetedCategories = budgets
    .map((b) => byId.get(b.category_id))
    .filter((c): c is Category => c !== undefined && c.kind === 'expense');
  const totalBudgeted = budgetedCategories.reduce((sum, c) => sum + (budgetByCategory.get(c.id)?.amount ?? 0), 0);
  const totalSpent = budgetedCategories.reduce((sum, c) => sum + spentUnder(c), 0);
  const hasAnything = budgets.length > 0 || spent.size > 0;

  const save = (category: Category, amount: number) => {
    const replaced = budgetsReplacedBy(category.id, budgets, byId);
    const write = async () => {
      for (const b of replaced) await deleteBudget.mutateAsync(b.id);
      setBudget.mutate({ categoryId: category.id, amount });
    };
    if (replaced.length === 0) {
      void write();
      return;
    }
    const group = category.parent_id === null ? category : byId.get(category.parent_id);
    Alert.alert(
      category.parent_id === null
        ? `Replace ${replaced.length} category budget${replaced.length === 1 ? '' : 's'} with one for ${category.name}?`
        : `Replace ${group?.name ?? 'the group'}'s budget with one for ${category.name}?`,
      'A group and its categories are never budgeted at once, so nothing counts twice.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: () => void write() },
      ],
    );
  };
```

  Replace the two sections inside `hasAnything ? (<>…</>)`, after the summary `Card`, with:

```tsx
            {budgetedCategories.length > 0 ? (
              <View style={{ gap: Spacing.xs }}>
                <AppText variant="caption" tone="dim" style={sectionLabel}>
                  Budgets
                </AppText>
                {[...budgetedCategories]
                  .sort((a, b) => spentUnder(b) - spentUnder(a))
                  .map((category) => (
                    <BudgetRow
                      key={category.id}
                      category={category}
                      // A category budget names its group, so "Gas" reads as Transportation's.
                      label={
                        category.parent_id === null
                          ? undefined
                          : `${category.name} · ${byId.get(category.parent_id)?.name ?? ''}`
                      }
                      spent={spentUnder(category)}
                      budget={budgetByCategory.get(category.id)?.amount}
                      onPress={() => setEditing(category)}
                    />
                  ))}
              </View>
            ) : null}

            <View style={{ gap: Spacing.xs }}>
              <AppText variant="caption" tone="dim" style={sectionLabel}>
                Not budgeted
              </AppText>
              {groups
                // A group with its own budget covers its children: none of them is budgetable.
                .filter((group) => !budgetByCategory.has(group.id))
                .filter((group) => showAll || (spentByGroup.get(group.id) ?? 0) !== 0)
                .map((group) => (
                  <View key={group.id}>
                    <BudgetRow
                      category={group}
                      spent={spentByGroup.get(group.id) ?? 0}
                      onPress={() => setEditing(group)}
                    />
                    {group.children
                      .filter((child) => !budgetByCategory.has(child.id))
                      .filter((child) => showAll || (spent.get(child.id) ?? 0) !== 0)
                      .sort((a, b) => (spent.get(b.id) ?? 0) - (spent.get(a.id) ?? 0))
                      .map((child) => (
                        <BudgetRow
                          key={child.id}
                          category={child}
                          indent
                          spent={spent.get(child.id) ?? 0}
                          onPress={() => setEditing(child)}
                        />
                      ))}
                  </View>
                ))}
              <Button
                title={showAll ? 'Show only categories with spending' : 'Show all categories'}
                variant="ghost"
                onPress={() => setShowAll(!showAll)}
              />
            </View>
```

  - **Wiring.** `BudgetSheet`'s `onSave` becomes `(amount) => { if (editing) save(editing, amount); setEditing(null); }`. Remove the now-unused `expenses`, `budgeted` and `unbudgeted` values.
  - **Imports.** `Alert` from `react-native`; `Button` from `@/components/ui/button`; and `buildTree, budgetsReplacedBy, rollupByGroup` from `@/lib/categories`.
  - **`BudgetRow` for `label`.** Render `{label ?? category.name}` in place of `{category.name}`.
- [ ] **Step 3:** Run `cd apps/mobile && npm test && npm run typecheck && npx expo lint`. Expect them clean.
- [ ] **Step 4: Emulator.**
  - Budgets lists the existing group budgets: Bills & Utilities, Transportation, Shopping and Medical. Each group's spent equals its rollup, and its children are not offered.
  - Set a budget on "Coffee Shops". Food & Dining has none, so there is no prompt, and the SQL row is its child's id.
  - Then tap the "Food & Dining" group row and save $300. Expect "Replace 1 category budget with one for Food & Dining?". Tap Replace; SQL now has the group budget and no Coffee Shops budget.
  - Then set a budget on "Groceries". Expect "Replace Food & Dining's budget with one for Groceries?". Tap Cancel; nothing changes.
  - Clean up: remove the test budgets through the sheet's Remove button.
- [ ] **Step 5: Commit** — `feat: budgets on a group or a category, never both`

### Task 7: Verification pass

**Files:** none (evidence goes in the ledger).

- [ ] **Step 1:** `npx -y deno test supabase/functions/_shared/` (73 pass), then `cd apps/mobile && npm test && npm run typecheck && npx expo lint` (13 pass).
- [ ] **Step 2: Reports.**
  - The donut lists groups only.
  - Tapping Food & Dining shows its children and "Food & Dining (general)" if any rows sit on the group.
  - The cash flow "Expenses" for September dropped by the card-payment total versus before the migration. Compare the September expense figure against `select sum(-amount) from transactions where pfc_detailed='LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' and date >= '2026-09-01'`.
- [ ] **Step 3: Recurring.**
  - After a pull-to-refresh sync, the card-payment stream is still in Recurring's "Bills & subscriptions", now with the Credit Card Payment icon.
  - SQL: `select r.name, c.slug from recurring_streams r join categories c on c.id = r.category_id where r.user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' and c.kind = 'transfer'` returns only `credit_card_payment` streams.
- [ ] **Step 4: Regression.** Home (hero, chart, Upcoming), the feed with its category labels, recategorize, and the bank screen. Then `node scripts/emu.mjs logs` should be clean.
- [ ] **Step 5:** Ledger every check with its numbers.

### Task 8: Docs and PR

**Files:**
- Modify: `README.md`, where the Phase 7 line becomes "7a done".
- Modify: `CLAUDE.md`:
  - a short convention entry: categories are two levels; resolution precedence is manual > rule > detailed > primary > fallback; `credit_card_payment` is a transfer that recurring still detects; app pure logic runs under `npm test` (`node --test`, pure modules with type-only imports and relative `./x.ts` runtime imports);
  - the Commands block gains `npm test`.
- Modify: the spec's Status line, which becomes "7a built".
- Create: `docs/superpowers/plans/<YYYY-MM-DD>-phase-7a-handoff.md`, using the date it is written. It covers what shipped, the verification numbers, and what 7b needs.

- [ ] **Step 1:** Write the docs. Commit: `docs: Phase 7a handoff`.
- [ ] **Step 2:** `git push origin pedro`, then:

```powershell
gh pr create --repo Kelvinluciano312/Tusky-App --base master --head pedro --title "Phase 7a: category groups" --body-file <scratchpad>/pr-body.md
```

  The PR body ends with the Claude Code attribution line. Never merge it.
