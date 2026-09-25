# Phase 7 — Categories: groups, custom categories, rules, merchant renaming (design)

Status: approved 2026-09-24. **7a, 7b and 7c built** (latest handoff: `docs/superpowers/plans/2026-09-25-phase-7c-handoff.md`). Build it in three
milestones — 7a, 7b, 7c — each with its own implementation plan (`superpowers:writing-plans`) and its
own PR.

Phase 7 turns the flat category list into something users can shape:

- **Groups and finer categories.** Today's 16 categories become groups over about 60 finer ones from
  Plaid's detailed codes (Groceries, Restaurants & Bars, Coffee Shops…).
- **Built-ins per user.** A user can hide, rename and recolour built-in categories, and add their own.
- **Merchant rules.** "Always categorize this merchant as X" applies to past and future transactions,
  never to ones set by hand.
- **Merchant renaming.** Fix a raw string like "ACH Electronic CreditGUSTO PAY 123456" once, and
  everywhere shows the new name.

It also lays the groundwork for **community categorization** (see its section), without collecting
anything yet.

## What the code and database show (2026-09-24)

- **The categories are flat.** `categories` holds 16 seeded rows. `plaid_category_map` maps PFC
  **primary** codes to them, so `FOOD_AND_DRINK_GROCERIES` and `FOOD_AND_DRINK_COFFEE` are both
  "Food & Dining".
- **Plaid's detailed code is already stored.** `transactions.pfc_detailed` is on every row, so the
  finer mapping needs a backfill, not a re-sync. 46 distinct detailed codes appear in current data.
- **`LOAN_DISBURSEMENTS` is unmapped.** It is a PFC v2 primary, and 133 rows (132 of them
  `LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT`) fall to Uncategorized, which reads −$62,972 in Budgets.
- **Card payments count as spending.** Credit-card payments (`LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`) sit
  in Loan Payments, an expense. Paying the card counts as spending on top of the purchases it pays
  for.
- **One merchant key already exists.** `normalizeMerchant(merchant_name ?? name)` in
  `_shared/recurring.ts` (lowercase letters only) is `recurring_streams.merchant_key`.
- **Plaid gives more than we store.** `Transaction.merchant_entity_id` exists in `plaid@30`, and a
  sync does not store it.
- **Grants fail closed** since Phase 6, so every new table and column needs an explicit grant.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Model | Two levels in the existing `categories` table (`parent_id`). The 16 rows become groups **with ids unchanged** | Existing budgets, manual overrides and stream `category_id`s stay valid with no data migration. A separate groups table would re-key all of them |
| Groups hold transactions | Yes. A transaction may point at a group row, meaning "this group, no finer category" | The 3 existing manual overrides point at today's categories and must never be rewritten. Unmapped detailed codes also land on their group |
| Budgets | On a group **or** a category, never both in one group | Chosen. A group budget covers its own rows and its children's |
| Built-ins | A user can hide, rename and recolour them, stored as per-user overrides | Chosen. Overrides keep one shared id space, which community categorization needs |
| Custom categories | Children of a built-in group only: no custom groups | Every custom label then rolls up to a shared group. YAGNI on custom groups |
| Rules | Apply to past and future transactions, never to `category_is_manual` rows | Chosen |
| Rule storage | Rules re-resolve at write time (sync, plus a retroactive pass); renames resolve at read time | Categories feed budgets and reports in SQL. Names are cosmetic, and a join on the client costs nothing |
| Card payments | "Credit Card Payment" is a transfer-kind child, kept on the bills radar | Chosen, Monarch's model. Spending counts card purchases once, and the bill still shows its due date |
| Precedence | manual > merchant rule > Plaid detailed > Plaid primary > uncategorized | Pure, and pinned by tests. The ordered-source shape leaves a slot for community |
| Tests for app logic | `node --test` with Node 26's native type stripping, no new dependencies | `apps/mobile` has had no runner since Phase 5. Pure modules using only `import type` run as-is |

## Taxonomy

Groups are today's rows, with ids, slugs, colours and icons unchanged. Each child inherits its group's
`kind` (by trigger) and its colour (by seed). Any detailed code not listed, and every `*_OTHER` code,
maps to the group row itself.

| Group | Child slug · name · icon | PFC detailed codes |
| --- | --- | --- |
| Income | `paychecks` · Paychecks · Banknote | INCOME_SALARY, INCOME_MILITARY |
| | `freelance_and_gig` · Freelance & Gig · Briefcase | INCOME_CONTRACTOR, INCOME_GIG_ECONOMY |
| | `interest_and_dividends` · Interest & Dividends · PiggyBank | INCOME_INTEREST_EARNED, INCOME_DIVIDENDS |
| | `rental_income` · Rental Income · KeyRound | INCOME_RENTAL |
| | `benefits_and_refunds` · Benefits & Refunds · HandCoins | INCOME_TAX_REFUND, INCOME_UNEMPLOYMENT, INCOME_LONG_TERM_DISABILITY, INCOME_RETIREMENT_PENSION, INCOME_CHILD_SUPPORT |
| Transfer | `account_transfers` · Account Transfers · ArrowLeftRight | every TRANSFER_IN_\* and TRANSFER_OUT_\* |
| | `credit_card_payment` · Credit Card Payment · CreditCard | LOAN_PAYMENTS_CREDIT_CARD_PAYMENT |
| | `loan_disbursements` · Loan Disbursements · HandCoins | every LOAN_DISBURSEMENTS_\* |
| Food & Dining | `groceries` · Groceries · ShoppingCart | FOOD_AND_DRINK_GROCERIES |
| | `restaurants_and_bars` · Restaurants & Bars · UtensilsCrossed | FOOD_AND_DRINK_RESTAURANT, FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR |
| | `fast_food` · Fast Food · Sandwich | FOOD_AND_DRINK_FAST_FOOD |
| | `coffee_shops` · Coffee Shops · Coffee | FOOD_AND_DRINK_COFFEE |
| Bills & Utilities | `rent` · Rent · Building | RENT_AND_UTILITIES_RENT |
| | `gas_and_electric` · Gas & Electric · PlugZap | RENT_AND_UTILITIES_GAS_AND_ELECTRICITY |
| | `internet_and_cable` · Internet & Cable · Wifi | RENT_AND_UTILITIES_INTERNET_AND_CABLE |
| | `phone` · Phone · Smartphone | RENT_AND_UTILITIES_TELEPHONE |
| | `water_and_waste` · Water & Waste · Droplets | RENT_AND_UTILITIES_WATER, RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT |
| Transportation | `fuel` · Gas · Fuel | TRANSPORTATION_GAS |
| | `parking_and_tolls` · Parking & Tolls · SquareParking | TRANSPORTATION_PARKING, TRANSPORTATION_TOLLS |
| | `public_transit` · Public Transit · TrainFront | TRANSPORTATION_PUBLIC_TRANSIT |
| | `rideshare_and_taxi` · Rideshare & Taxi · CarTaxiFront | TRANSPORTATION_TAXIS_AND_RIDE_SHARES, TRANSPORTATION_BIKES_AND_SCOOTERS |
| | `auto_maintenance` · Auto Maintenance · CarFront | GENERAL_SERVICES_AUTOMOTIVE |
| Shopping | `clothing` · Clothing · Shirt | GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES |
| | `electronics` · Electronics · Laptop | GENERAL_MERCHANDISE_ELECTRONICS |
| | `department_and_superstores` · Department & Superstores · Store | GENERAL_MERCHANDISE_DEPARTMENT_STORES, GENERAL_MERCHANDISE_DISCOUNT_STORES, GENERAL_MERCHANDISE_SUPERSTORES |
| | `online_marketplaces` · Online Marketplaces · Package | GENERAL_MERCHANDISE_ONLINE_MARKETPLACES |
| | `gifts` · Gifts · Gift | GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES |
| | `pet_supplies` · Pet Supplies · PawPrint | GENERAL_MERCHANDISE_PET_SUPPLIES |
| | `books_and_office` · Books & Office · BookOpen | GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS, GENERAL_MERCHANDISE_OFFICE_SUPPLIES |
| Entertainment | `streaming_and_music` · Streaming & Music · Tv | ENTERTAINMENT_TV_AND_MOVIES, ENTERTAINMENT_MUSIC_AND_AUDIO |
| | `video_games` · Video Games · Gamepad2 | ENTERTAINMENT_VIDEO_GAMES |
| | `events_and_outings` · Events & Outings · Ticket | ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS |
| | `gambling` · Gambling · Dices | ENTERTAINMENT_CASINOS_AND_GAMBLING |
| Travel | `flights` · Flights · PlaneTakeoff | TRAVEL_FLIGHTS |
| | `lodging` · Lodging · BedDouble | TRAVEL_LODGING |
| | `rental_cars` · Rental Cars · Car | TRAVEL_RENTAL_CARS |
| Medical | `doctor` · Doctor · Stethoscope | MEDICAL_PRIMARY_CARE, MEDICAL_NURSING_CARE |
| | `dentist` · Dentist · Smile | MEDICAL_DENTAL_CARE |
| | `eye_care` · Eye Care · Eye | MEDICAL_EYE_CARE |
| | `pharmacy` · Pharmacy · Pill | MEDICAL_PHARMACIES_AND_SUPPLEMENTS |
| | `veterinary` · Veterinary · Dog | MEDICAL_VETERINARY_SERVICES |
| Personal Care | `fitness` · Fitness · Dumbbell | PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS |
| | `hair_and_beauty` · Hair & Beauty · Scissors | PERSONAL_CARE_HAIR_AND_BEAUTY |
| | `laundry` · Laundry · WashingMachine | PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING |
| Home | `furniture` · Furniture · Sofa | HOME_IMPROVEMENT_FURNITURE |
| | `hardware_and_repairs` · Hardware & Repairs · Hammer | HOME_IMPROVEMENT_HARDWARE, HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE |
| Services | `insurance` · Insurance · ShieldCheck | GENERAL_SERVICES_INSURANCE |
| | `childcare` · Childcare · Baby | GENERAL_SERVICES_CHILDCARE |
| | `education` · Education · GraduationCap | GENERAL_SERVICES_EDUCATION |
| | `financial_and_legal` · Financial & Legal · Scale | GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING, GENERAL_SERVICES_CONSULTING_AND_LEGAL |
| | `shipping_and_storage` · Shipping & Storage · Truck | GENERAL_SERVICES_POSTAGE_AND_SHIPPING, GENERAL_SERVICES_STORAGE |
| Loan Payments | `mortgage` · Mortgage · Key | LOAN_PAYMENTS_MORTGAGE_PAYMENT |
| | `auto_loan` · Auto Loan · Car | LOAN_PAYMENTS_CAR_PAYMENT |
| | `student_loan` · Student Loan · School | LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT |
| | `personal_loan` · Personal Loan · HandCoins | LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT |
| | `buy_now_pay_later` · Buy Now Pay Later · CalendarClock | LOAN_PAYMENTS_BNPL |
| Bank Fees | `interest_charges` · Interest Charges · Percent | BANK_FEES_INTEREST_CHARGE |
| | `atm_fees` · ATM Fees · BadgeDollarSign | BANK_FEES_ATM_FEES |
| | `overdraft_and_late_fees` · Overdraft & Late Fees · TriangleAlert | BANK_FEES_OVERDRAFT_FEES, BANK_FEES_INSUFFICIENT_FUNDS, BANK_FEES_LATE_FEES |
| Government & Nonprofit | `donations` · Donations · HeartHandshake | GOVERNMENT_AND_NON_PROFIT_DONATIONS |
| | `taxes` · Taxes · FileText | GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT |
| Uncategorized | — | `OTHER` / `OTHER_OTHER` fall through to it |

That is 61 children. Every icon above exists in the installed `lucide-react-native` (checked
2026-09-24).

The primary map gains `LOAN_DISBURSEMENTS` → the Transfer group. `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`
moves from the Loan Payments group into Transfer, by its detailed code.

## Milestone 7a — Taxonomy

### 7a — storage: `<ts>_phase7a_category_groups.sql`

```sql
alter table public.categories
  add column parent_id uuid references public.categories (id),
  -- null = built-in. Defaulted so a client insert never names it (7b); seed rows,
  -- inserted by the migration as postgres, get null because auth.uid() is null.
  add column user_id uuid default auth.uid() references auth.users (id) on delete cascade,
  alter column slug drop not null,
  add constraint categories_slug_iff_builtin check ((user_id is null) = (slug is not null));

create index categories_parent_id_idx on public.categories (parent_id);
create index categories_user_id_idx on public.categories (user_id);
```

- **Trigger `categories_enforce_tree`** (BEFORE INSERT OR UPDATE OF `parent_id`, `kind`):
  - A parent must itself have `parent_id is null` **and** `user_id is null`: a built-in group. That
    makes two levels the maximum, and forbids custom groups.
  - Set `new.kind := parent.kind`.
- **RLS.** Replace the select policy with `user_id is null or user_id = (select auth.uid())`. Grants
  are unchanged in 7a (select only).
- **Seed** the 61 children: `insert … select` from a `values` list joined to the group by slug, with
  `color` copied from the group and `sort_order` 1..n within each group.
- **`plaid_detailed_map`** (`pfc_detailed text primary key, category_id uuid not null references
  categories`). RLS on, no policies, no grants: service role only, like `plaid_category_map`. Seed it
  from the table above.
- **Primary map.** `insert into plaid_category_map ('LOAN_DISBURSEMENTS', <transfer group>)`.
- **`transactions.merchant_key`**:
  `text generated always as (btrim(regexp_replace(lower(coalesce(merchant_name, name)), '[^a-z]+', ' ', 'g'))) stored`,
  with an index on `(user_id, merchant_key)`. It is the SQL twin of `normalizeMerchant`; see
  Verification for the parity check. The existing table-level `select` grant covers the new column.
- **`transactions.merchant_entity_id text`** is nullable, written by sync from now on. Old rows fill
  in only as Plaid re-sends them.
- **Backfill** (in the same migration):

  ```sql
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

  Manual rows are excluded, so they are never rewritten. `recurring_streams.category_id` is derived
  and refreshes on the next sync.

### 7a — server

- **`_shared/categorize.ts`.** Add `DetailedMap`, and

  ```ts
  resolveCategoryId(
    sources: { rule?: string | null; detailed?: string | null; primary?: string | null },
    maps: { detailed: CategoryMap; primary: CategoryMap },
    fallbackId: string,
  ): string
  ```

  It returns the first hit of rule, `maps.detailed[detailed]`, `maps.primary[primary]`, then
  fallback. `pickCategoryId` (manual wins) is unchanged and still applied on top. In 7a, `rule` is
  always absent.
- **`_shared/sync.ts`.**
  - `loadSyncContext` also loads the detailed map.
  - `transferCategoryIds` becomes kind `transfer` **minus** `credit_card_payment`, so recurring keeps
    detecting card bills.
  - The row mapping adds `merchant_entity_id: t.merchant_entity_id ?? null`. PostgREST needs every row
    in one upsert to carry the same keys, so the key is always present.
- **Tests:**
  - precedence (rule beats detailed beats primary beats fallback);
  - an unknown detailed code falls to its primary;
  - `pickCategoryId` still wins over all of them;
  - the transfer-ids exclusion. It is pure: extract `recurringExcludedCategoryIds(categories)`.

### 7a — client

- **`Category`** gains `parent_id: string | null`. `useCategories` selects it.
- **New pure `lib/categories.ts`,** type-only imports:
  - `buildTree(categories)` returns groups in `sort_order`, each with its children.
  - `groupIdOf(id, byId)` returns the id itself for a group, or its `parent_id`.
  - `rollupByGroup(spentByCategory, byId)` returns group id → own rows plus children.
  - `budgetConflicts(budgets, byId)` returns the groups with both a group budget and child budgets.
  - `pickerSections(tree, { selectedId })`, a hook point for hiding in 7b.
- **Test runner.**
  - Add `"test": "node --test src/lib/*.test.ts"` to `apps/mobile/package.json`.
  - Add `allowImportingTsExtensions: true` to tsconfig. The expo base already sets `noEmit`.
  - `lib/categories.test.ts` imports `./categories.ts`.
- **`CategoryPicker`.** Groups appear as selectable header rows, with their children indented beneath.
  The selected one gets a check, as today.
- **Budgets:**
  - One section per expense group.
  - A group **with** a budget shows one row: its rollup against the budget. Its children appear as a
    small breakdown, not budgetable.
  - A group **without** one shows a "Set a budget for {group}" affordance, and its children as
    budgetable rows (today's unbudgeted-discovery behaviour, per child, biggest spender first).
  - **Setting a group budget while children have budgets** asks "Replace N category budgets with one
    for {group}?", then deletes the child budgets and upserts the group's. **Setting a child budget
    while the group has one** asks the mirror question.
  - Totals are computed with `rollupByGroup`, so nothing counts twice.
- **Reports:**
  - The donut and its list are by group, through `rollupByGroup`.
  - Tapping a group opens its breakdown in place: children plus "{Group} (general)" for rows on the
    group itself, as a list with share bars and no second donut. Children share their group's colour.
  - Cash flow is unchanged: `kind` is inherited, so card payments, now transfers, leave it
    automatically.
- **Transaction and recurring rows** need no change: they render the category by id, and children
  have their own name and icon.

## Milestone 7b — Custom categories and built-in overrides

### 7b — storage: `<ts>_phase7b_custom_categories.sql`

```sql
create table public.category_overrides (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  name text check (name is null or length(btrim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, category_id)
);
```

- **Overrides.**
  - A trigger rejects overrides on non-built-in rows: custom rows are edited directly.
  - RLS: own rows only, for select, insert, update and delete.
  - Grants: `select, insert, update, delete` to authenticated. Nothing in it is server-owned, as with
    `budgets`.
- **Custom categories on `categories`:**
  - An insert policy with check `user_id = (select auth.uid()) and parent_id is not null`. The tree
    trigger already pins the parent to a built-in group.
  - Update and delete policies on own rows.
  - Grants: `insert (name, parent_id, icon, color)` and `update (name, icon, color)`. There is **no
    client delete**: deleting goes through the function below.
  - Constraints: `name` 1–40 characters after trimming, and `color` a hex colour.
- **View `user_categories`**: `with (security_invoker = on)` and `where c.user_id is null or
  c.user_id = (select auth.uid())`, per CLAUDE.md. It selects:
  - `id, slug, parent_id, kind, icon, sort_order`;
  - `coalesce(o.name, c.name) as name` and `coalesce(o.color, c.color) as color`;
  - `coalesce(o.hidden, false) as hidden` and `c.user_id is not null as is_custom`.

  Its join is `left join category_overrides o on o.category_id = c.id and o.user_id = (select
  auth.uid())`. It gets a select grant to authenticated.

### 7b — server: `delete-category` (new, JWT-verified)

`POST { category_id }`. It returns 400 on a bad body, 404 when the id is not the caller's custom
category, and 200 `{ ok: true, moved: n }`. In order, as the service role, each step scoped to the
caller:

1. Move `transactions` to the parent group, leaving `category_is_manual` as it is.
2. Move `recurring_streams.category_id` to the parent.
3. Delete the category's budget.
4. Delete the row.

7c adds one more step before the delete: move `merchant_rules` to the parent.

The delete comes last, so a crash leaves a retryable state. The pure planning is Deno-tested.

### 7b — client

- `useCategories` reads `user_categories`, so `Category` gains `hidden` and `is_custom`. Its key stays
  `['categories']`, and every edit invalidates it along with `['reports']` and `['budgets']`.
- Hidden categories drop out of the picker (unless currently selected) and out of Budgets' discovery
  rows. Hiding a group hides its children from the picker. Existing budgets and transactions in a
  hidden category still show.
- **New `/categories` screen** (from Settings), with groups and their children:
  - **Built-in:** rename (a bottom sheet with a TextField, following `budget-sheet.tsx`), recolour
    (the 16 seeded group colours as swatches), and a hide toggle. "Reset" deletes the override.
  - **Custom:** "Add category" under each group (name, icon from a preset list of about 24 lucide
    names, colour), edit, and delete.
  - Delete confirms "Moves its N transactions to {group}", then calls `delete-category`.
- Hook names: `useCategoryOverride`, `useCreateCategory`, `useUpdateCategory` and
  `useDeleteCategory`.

## Milestone 7c — Merchant rules and renaming

### 7c — storage: `<ts>_phase7c_merchant_rules.sql`

```sql
create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_key text not null check (merchant_key ~ '^[a-z]+( [a-z]+)*$'),
  category_id uuid references public.categories (id),
  display_name text check (display_name is null or length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key),
  check (category_id is not null or display_name is not null)
);
```

RLS: select own rows. Grants: `select` to authenticated only. **All writes go through the function**,
so the retroactive pass can never be skipped. `delete-category` gains its rule-moving step here, and
`merchant_rules.category_id` stays `on delete restrict`, so a missed step fails loudly.

### 7c — server

- **`_shared/rules.ts`** (pure, Deno-tested):
  - `validateRuleInput(body)`.
  - `planReresolve(rows, rule, maps, fallbackId)`. It takes the user's non-manual rows for the
    merchant, `{ id, pfc_detailed, pfc_primary, category_id }`, and returns `{ category_id, ids[] }[]`
    for rows whose category changes. It uses the same `resolveCategoryId`.
- **`set-merchant-rule`** (new, JWT-verified). `POST { merchant_key, category_id?, display_name? }`,
  where omitted fields keep their stored value and `null` clears them.
  1. Validate. The category must be visible to the caller (built-in, or their own custom).
  2. Upsert the merged row, or delete it when both fields end up null.
  3. If the category part changed:
     - select the caller's `category_is_manual = false` transactions with that `merchant_key`;
     - `planReresolve`;
     - update in chunks of 100 ids.
     - Deleting the category rule restores Plaid's category.
  4. Return `{ ok: true, updated: n }`.
- **`syncItem`** loads the user's rules once per Item (`merchant_key → category_id`). Per row it passes
  `rule: rules.get(normalizeMerchant(t.merchant_name ?? t.name))` to `resolveCategoryId`.

### 7c — client

- `TRANSACTION_COLUMNS` and `STREAM_COLUMNS` add `merchant_key`.
- `useMerchantRules()` returns a map of `merchant_key → rule`, under key `['merchant_rules']`.
- `displayMerchant(row, rules)` is pure, in `lib/categories.ts` (or `lib/merchants.ts`):
  `display_name ?? merchant_name ?? name` for transactions, and `display_name ?? stream.name` for
  streams. It is used by `TransactionRow`, `RecurringRow` and `UpcomingCard`.
- **New `/transaction/[id]` screen** (tapping a feed row opens it; today a tap opens the picker
  directly):
  - The merchant display name, with "Rename", which opens a sheet that saves `display_name`.
  - The category, which opens `CategoryPicker`. After a change, it asks "Always categorize {merchant}
    as {category}? Applies to past and future ones you haven't set by hand." with the choices **Just
    this one** and **Always**.
  - The account, date, amount and pending state.
- **New `/rules` screen** (from Settings) lists each rule: merchant, rename and category. Tapping a
  rule offers removing the category rule, removing the rename, or deleting both.
- After any rule write, invalidate `['merchant_rules']`, `['transactions']`, `['reports']` and
  `['recurring']`.

## Community categorization: groundwork only

With consent, users' category choices will train Tusky's categorizer, including context such as
amount and time. For example, a small charge at a gas station is probably food, not fuel. **Phase 7
collects and shares nothing.** It only keeps the doors open:

- **One vocabulary.** Built-in ids are global and stable. Renames of built-ins are overrides, never new
  rows, and custom categories must sit under a built-in group. Every label therefore maps onto one
  shared taxonomy.
- **Labels already exist.** A manual row keeps Plaid's original guess (`pfc_detailed`,
  `pfc_confidence`) beside the user's choice. A rule is an explicit merchant-level label.
- **A cross-user merchant key.** `merchant_entity_id` is stored from 7a on. Normalized names vary by
  bank; Plaid's entity id does not.
- **A resolver slot.** The ordered sources in `resolveCategoryId` take a future `community` source
  between `rule` and `detailed`.

The later phase starts with a research spike. Open questions:

- the consent UX and a stored consent record;
- a de-identified label store (no `user_id`; merchant entity, amount band, time of day, Plaid's guess,
  chosen category);
- thresholds for when community beats Plaid;
- whether per-merchant amount bands separate fuel from snacks.

## Known and accepted

- **A group row is itself a category.** The picker shows it as the group's name, and Reports' drill-in
  labels it "{Group} (general)".
- **The backfill moves money between budget lines.** Transactions reclassified from a group into its
  children still roll up to the same group budget. Two exceptions:
  - card payments leave Loan Payments (the double count is fixed);
  - loan disbursements leave Uncategorized.
- **Budget overlap is enforced by the client only.** A race could leave a group and a child both
  budgeted in one group. The rollup still counts each transaction once, but the group total would
  compare against two budgets. It is the user's own data.
- **`merchant_key` parity.** The SQL expression and JS `normalizeMerchant` agree on ASCII. Exotic
  Unicode case folding could differ, so a rule might apply retroactively but not in sync for such a
  merchant. Verification checks for zero mismatches on real data.
- **Renames are per merchant key.** Two different merchants that normalize the same (for example,
  names differing only in digits) share one rename and one rule. That is the recurring detector's
  grouping, and it is intentional.
- **`merchant_entity_id` is empty on old rows** until Plaid re-sends them.
- **No rules on amount, account or description patterns.** Rules match merchants only, for now.

## Deferred

- Community categorization (above).
- Custom groups; splitting a transaction across categories; rule conditions beyond merchant.
- Budget rollover and per-month budgets (Phase 3 left a clean path).

## Verification (build sessions)

Per milestone, with the Phase 6 tooling (`node scripts/emu.mjs`, `supabase db query --linked`, keyed
on `user_id`, never joining `auth.users`).

1. **Automated checks.**
   - `npx -y deno test supabase/functions/_shared/`: the 70 existing tests plus the new ones.
   - In `apps/mobile`: `npm test && npm run typecheck && npx expo lint`.
2. **7a SQL:**
   - Checksum `(id, category_id)` of every `category_is_manual` row before and after the migration:
     the two must be identical.
   - Uncategorized loses the `LOAN_DISBURSEMENTS` rows.
   - `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT` rows now point at `credit_card_payment`.
   - Every relation's ACL is as granted.
   - **Parity:** export `merchant_name, name, merchant_key` to CSV and compare with `normalizeMerchant`
     in node. Expect 0 mismatches.
3. **7a emulator:**
   - The picker shows groups and children.
   - A group budget sums its children.
   - The replace prompt appears both ways.
   - Reports drill into a group.
   - Card payments leave cash flow but stay in Recurring after a sync.
   - Regression: feed, recategorize, net worth chart, bank screen.
4. **7b:**
   - Rename, recolour and hide a built-in (picker, budgets, reports), then reset it.
   - Add a custom category and assign it.
   - Delete it: its transactions move to the group, still manual if they were.
   - Another user's custom category is invisible: check with a user JWT against `user_categories`.
5. **7c:**
   - Rename a merchant: the feed, Recurring and Upcoming show it.
   - "Always" on a recategorize: past non-manual rows follow, and a manual row does not.
   - A sync keeps the rule.
   - Deleting the rule restores Plaid's category.
   - Function 400/404 paths return the right codes.
