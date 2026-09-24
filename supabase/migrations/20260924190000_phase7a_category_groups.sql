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
