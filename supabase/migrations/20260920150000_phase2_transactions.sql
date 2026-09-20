-- Phase 2: transactions, curated category taxonomy, and the PFC mapping.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  icon text not null,          -- lucide-react-native icon name
  color text not null,         -- hex; single source of truth for category colour
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "Categories are readable by all signed-in users"
  on public.categories for select
  using (auth.role() = 'authenticated');

grant select on public.categories to authenticated;

insert into public.categories (slug, name, kind, icon, color, sort_order) values
  ('income',                   'Income',                 'income',   'TrendingUp',      '#55C084',  1),
  ('transfer',                 'Transfer',               'transfer', 'ArrowLeftRight',  '#94A198',  2),
  ('food_and_dining',          'Food & Dining',          'expense',  'UtensilsCrossed', '#E07856',  3),
  ('bills_and_utilities',      'Bills & Utilities',      'expense',  'Zap',             '#D9A441',  4),
  ('transportation',           'Transportation',         'expense',  'Car',             '#4E9BD1',  5),
  ('shopping',                 'Shopping',               'expense',  'ShoppingBag',     '#A97ACD',  6),
  ('entertainment',            'Entertainment',          'expense',  'Clapperboard',    '#D96BA0',  7),
  ('travel',                   'Travel',                 'expense',  'Plane',           '#46B3A8',  8),
  ('medical',                  'Medical',                'expense',  'HeartPulse',      '#E05A5A',  9),
  ('personal_care',            'Personal Care',          'expense',  'Sparkles',        '#C98BB8', 10),
  ('home',                     'Home',                   'expense',  'House',           '#8C9F5B', 11),
  ('services',                 'Services',               'expense',  'Wrench',          '#7C8BA1', 12),
  ('loan_payments',            'Loan Payments',          'expense',  'Landmark',        '#B5784B', 13),
  ('bank_fees',                'Bank Fees',              'expense',  'Receipt',         '#9A8C7A', 14),
  ('government_and_nonprofit', 'Government & Nonprofit', 'expense',  'Building2',       '#6F8FA6', 15),
  ('uncategorized',            'Uncategorized',          'expense',  'CircleDashed',    '#94A198', 99);

-- PFC v2 primary -> our category. Many-to-one: both transfer directions collapse.
create table public.plaid_category_map (
  pfc_primary text primary key,
  category_id uuid not null references public.categories (id)
);

alter table public.plaid_category_map enable row level security;

create policy "Category map is readable by all signed-in users"
  on public.plaid_category_map for select
  using (auth.role() = 'authenticated');

grant select on public.plaid_category_map to authenticated;

insert into public.plaid_category_map (pfc_primary, category_id)
select v.pfc, c.id from (values
  ('INCOME',                    'income'),
  ('TRANSFER_IN',               'transfer'),
  ('TRANSFER_OUT',              'transfer'),
  ('FOOD_AND_DRINK',            'food_and_dining'),
  ('RENT_AND_UTILITIES',        'bills_and_utilities'),
  ('TRANSPORTATION',            'transportation'),
  ('GENERAL_MERCHANDISE',       'shopping'),
  ('ENTERTAINMENT',             'entertainment'),
  ('TRAVEL',                    'travel'),
  ('MEDICAL',                   'medical'),
  ('PERSONAL_CARE',             'personal_care'),
  ('HOME_IMPROVEMENT',          'home'),
  ('GENERAL_SERVICES',          'services'),
  ('LOAN_PAYMENTS',             'loan_payments'),
  ('BANK_FEES',                 'bank_fees'),
  ('GOVERNMENT_AND_NON_PROFIT', 'government_and_nonprofit')
) as v(pfc, slug)
join public.categories c on c.slug = v.slug;

-- Sync claim. Service-role only: no grant, so no client policy is needed.
alter table public.plaid_items add column sync_locked_at timestamptz;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  item_id uuid not null references public.plaid_items (id) on delete cascade,
  plaid_transaction_id text not null unique,
  name text not null,
  merchant_name text,
  logo_url text,
  -- SIGN INVERTED from Plaid: positive = money in, negative = money out.
  amount numeric(14, 2) not null,
  iso_currency_code text not null default 'USD',
  date date not null,
  datetime timestamptz,
  pending boolean not null default false,
  pending_transaction_id text,
  payment_channel text,
  pfc_primary text,
  pfc_detailed text,
  pfc_confidence text,
  category_id uuid references public.categories (id),
  category_is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transactions_feed_idx on public.transactions (user_id, date desc, id desc);
create index transactions_account_id_idx on public.transactions (account_id);
create index transactions_item_id_idx on public.transactions (item_id);

create trigger transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;

create policy "Users can view their own transactions"
  on public.transactions for select
  using ((select auth.uid()) = user_id);

create policy "Users can recategorize their own transactions"
  on public.transactions for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select on public.transactions to authenticated;
-- Column-level: a client may recategorize, never rewrite an amount or a date.
grant update (category_id, category_is_manual) on public.transactions to authenticated;
