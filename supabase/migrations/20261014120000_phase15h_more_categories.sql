-- Phase 15h: more built-in categories where the groups were thin, each with
-- its own icon, and Plaid's detailed codes that belong to them. Children take
-- their group's colour; kind is copied by categories_enforce_tree. They go
-- after each group's existing children. Codes we remap only change rows
-- resolved from now on; nothing already categorized moves.

insert into public.categories (slug, name, kind, icon, color, sort_order, parent_id)
select v.slug, v.name, g.kind, v.icon, g.color,
  coalesce((select max(c.sort_order) from public.categories c where c.parent_id = g.id), 0) + v.ord,
  g.id
from (values
  ('food_and_dining', 'alcohol_and_liquor', 'Alcohol & Liquor', 'Wine', 1),
  ('food_and_dining', 'food_delivery', 'Food Delivery', 'Bike', 2),
  ('home', 'home_services', 'Home Services', 'Wrench', 1),
  ('home', 'lawn_and_garden', 'Lawn & Garden', 'Sprout', 2),
  ('home', 'home_security', 'Home Security', 'ShieldHalf', 3),
  ('home', 'home_goods', 'Home Goods', 'Lamp', 4),
  ('entertainment', 'hobbies', 'Hobbies', 'Palette', 1),
  ('entertainment', 'sports_and_recreation', 'Sports & Recreation', 'Trophy', 2),
  ('bills_and_utilities', 'software_and_apps', 'Software & Apps', 'AppWindow', 1),
  ('personal_care', 'spa_and_wellness', 'Spa & Wellness', 'Flower2', 1),
  ('medical', 'mental_health', 'Mental Health', 'Brain', 1),
  ('medical', 'hospital_and_urgent_care', 'Hospital & Urgent Care', 'Hospital', 2),
  ('shopping', 'sporting_goods', 'Sporting Goods', 'Volleyball', 1),
  ('shopping', 'toys_and_kids', 'Toys & Kids', 'ToyBrick', 2),
  ('shopping', 'jewelry_and_accessories', 'Jewelry & Accessories', 'Gem', 3),
  ('shopping', 'convenience_stores', 'Convenience Stores', 'ShoppingBasket', 4),
  ('shopping', 'tobacco_and_vape', 'Tobacco & Vape', 'Cigarette', 5),
  ('shopping', 'secondhand', 'Secondhand & Thrift', 'Recycle', 6),
  ('transportation', 'bikes_and_scooters', 'Bikes & Scooters', 'Bike', 1),
  ('transportation', 'ev_charging', 'EV Charging', 'BatteryCharging', 2),
  ('transportation', 'registration_and_fees', 'Registration & Fees', 'ClipboardList', 3),
  ('travel', 'activities_and_tours', 'Activities & Tours', 'Map', 1),
  ('government_and_nonprofit', 'fines_and_penalties', 'Fines & Penalties', 'Gavel', 1),
  ('services', 'memberships', 'Memberships', 'IdCard', 1),
  ('income', 'gifts_received', 'Gifts Received', 'Gift', 1),
  ('income', 'selling_items', 'Selling Items', 'Tag', 2),
  ('income', 'reimbursements', 'Reimbursements', 'Receipt', 3),
  ('transfer', 'savings_and_investments', 'Savings & Investments', 'TrendingUp', 1)
) as v(grp, slug, name, icon, ord)
join public.categories g on g.slug = v.grp and g.parent_id is null and g.herd_id is null;

insert into public.plaid_detailed_map (pfc_detailed, category_id)
select v.code, c.id
from (values
  ('FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', 'alcohol_and_liquor'),
  ('HOME_IMPROVEMENT_SECURITY', 'home_security'),
  ('ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS', 'events_and_outings'),
  ('GENERAL_MERCHANDISE_SPORTING_GOODS', 'sporting_goods'),
  ('GENERAL_MERCHANDISE_CONVENIENCE_STORES', 'convenience_stores'),
  ('GENERAL_MERCHANDISE_TOBACCO_AND_VAPE', 'tobacco_and_vape'),
  ('TRANSPORTATION_BIKES_AND_SCOOTERS', 'bikes_and_scooters'),
  ('TRANSFER_IN_SAVINGS', 'savings_and_investments'),
  ('TRANSFER_OUT_SAVINGS', 'savings_and_investments'),
  ('TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS', 'savings_and_investments'),
  ('TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS', 'savings_and_investments')
) as v(code, slug)
join public.categories c on c.slug = v.slug
on conflict (pfc_detailed) do update set category_id = excluded.category_id;
