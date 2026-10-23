/**
 * Hourly scheduled pushes. Event-driven ones live in push-events.ts.
 * Quiet hours and preferences are applied by deliver(); this only decides
 * who is due at this local hour.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { balances, nudgeUserIds, type Settlement, type SharedLine, type SettleMember } from './open-balance.ts';
import {
  addDays,
  billCopy,
  budgetsOnTrack,
  digestBody,
  digestDue,
  localParts,
  MORNING_HOUR,
  prefsFrom,
  RECAP_HOUR,
  recapCopy,
  recapFromSpend,
  reconnectReminderCopy,
  SETTLE_HOUR,
  settleCopy,
  trialCopy,
  trialPushDay,
  visibleSpend,
  type Prefs,
  type SpendLine,
} from './notify.ts';
import { loadCategorySpend } from './push-events.ts';
import { deliver, flushDue, pruneLog, type Outbound } from './push-send.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CronReport = {
  sent: number;
  deferred: number;
  skipped: number;
  planned: { userId: string; type: string; dedupeKey: string; title: string }[];
};

type Person = { userId: string; prefs: Prefs; herdId: string; hour: number; weekday: number; ymd: string };

export async function runNotificationsCron(admin: SupabaseClient, now: Date, dryRun: boolean): Promise<CronReport> {
  const report: CronReport = { sent: 0, deferred: 0, skipped: 0, planned: [] };
  if (!dryRun) {
    await pruneLog(admin, now);
    const flushed = await flushDue(admin, now);
    report.sent += flushed.sent;
    report.deferred += flushed.deferred;
    report.skipped += flushed.skipped;
  }

  const people = await loadPeople(admin, now);
  const spendCache = new Map<string, Promise<SpendLine[]>>();
  const spendFor = (herdId: string, start: string, end: string) => {
    const key = `${herdId}:${start}:${end}`;
    let pending = spendCache.get(key);
    if (!pending) {
      pending = loadCategorySpend(admin, herdId, start, end);
      spendCache.set(key, pending);
    }
    return pending;
  };
  const planned: Outbound[] = [];
  const herdLines = new Map<string, Promise<{ lines: SharedLine[]; settlements: Settlement[]; members: SettleMember[] }>>();

  for (const person of people) {
    try {
      planned.push(...await reviewDigest(admin, person, now));
      planned.push(...await weeklyRecap(admin, person, spendFor));
      planned.push(...await settleNudge(admin, person, herdLines));
      planned.push(...await upcomingBills(admin, person));
      planned.push(...await trialEnding(admin, person, now));
    } catch (err) {
      console.warn(`notifications for ${person.userId} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  planned.push(...await reconnectReminders(admin, people, now));

  if (dryRun) {
    report.planned = planned.map((item) => ({
      userId: item.userId, type: item.type, dedupeKey: item.dedupeKey, title: item.title,
    }));
    return report;
  }
  if (planned.length > 0) {
    const result = await deliver(admin, planned, now);
    report.sent += result.sent;
    report.deferred += result.deferred;
    report.skipped += result.skipped;
  }
  return report;
}

async function loadPeople(admin: SupabaseClient, now: Date): Promise<Person[]> {
  const { data: tokens, error } = await admin.from('push_tokens').select('user_id');
  if (error) throw error;
  const userIds = [...new Set((tokens ?? []).map((row) => row.user_id as string))];
  if (userIds.length === 0) return [];
  const [{ data: prefRows, error: prefError }, { data: memberRows, error: memberError }] = await Promise.all([
    admin.from('notification_prefs').select('*').in('user_id', userIds),
    admin.from('herd_members').select('user_id, herd_id, joined_at').in('user_id', userIds),
  ]);
  if (prefError) throw prefError;
  if (memberError) throw memberError;
  const prefs = new Map((prefRows ?? []).map((row) => [row.user_id as string, prefsFrom(row as Partial<Prefs>)]));
  const herds = new Map((memberRows ?? []).map((row) => [row.user_id as string, row.herd_id as string]));
  const people: Person[] = [];
  for (const userId of userIds) {
    const pref = prefs.get(userId) ?? prefsFrom(null);
    if (!pref.timezone) continue;
    const herdId = herds.get(userId);
    if (!herdId) continue;
    let local: { hour: number; weekday: number; ymd: string };
    try {
      local = localParts(now, pref.timezone);
    } catch {
      continue;
    }
    people.push({ userId, prefs: pref, herdId, ...local });
  }
  return people;
}

async function reviewDigest(admin: SupabaseClient, person: Person, now: Date): Promise<Outbound[]> {
  const dedupeKey = `digest:${person.ymd}`;
  const { data: last } = await admin
    .from('notification_log')
    .select('sent_at, dedupe_key')
    .eq('user_id', person.userId)
    .eq('type', 'review_digest')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sentToday = last?.dedupe_key === dedupeKey;
  const since = (last?.sent_at as string | undefined) ?? null;
  const queue = await reviewSnapshot(admin, person, since);
  if (!digestDue({
    enabled: person.prefs.review_digest,
    localHour: person.hour,
    reviewHour: person.prefs.review_hour,
    count: queue.count,
    threshold: person.prefs.review_threshold,
    newSinceLast: since ? queue.fresh : queue.count,
    sentToday,
  })) return [];
  return [{
    userId: person.userId,
    type: 'review_digest',
    dedupeKey,
    title: 'Transactions to review',
    body: digestBody(queue.count, { priority: queue.priority, split: queue.split }),
    url: '/review',
    sound: true,
    urgent: false,
    channel: 'digest',
  }];
}

async function reviewSnapshot(
  admin: SupabaseClient,
  person: Person,
  since: string | null,
): Promise<{ count: number; fresh: number; priority: boolean; split: boolean }> {
  if (!UUID.test(person.userId)) return { count: 0, fresh: 0, priority: false, split: false };
  const filter = `and(reviewed_at.is.null,review_assignee.is.null),review_assignee.eq.${person.userId}`;
  const countOf = async (privateOnly: boolean, createdAfter: string | null) => {
    let query = admin
      .from('transactions')
      .select('id, accounts!inner(hidden, is_private, user_id)', { count: 'exact', head: true })
      .eq('herd_id', person.herdId)
      .eq('pending', false)
      .eq('accounts.hidden', false)
      .or(filter);
    query = privateOnly
      ? query.eq('accounts.is_private', true).eq('accounts.user_id', person.userId)
      : query.eq('accounts.is_private', false);
    if (createdAfter) query = query.gt('created_at', createdAfter);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };
  const [shared, mine, sharedFresh, mineFresh] = await Promise.all([
    countOf(false, null),
    countOf(true, null),
    since ? countOf(false, since) : Promise.resolve(0),
    since ? countOf(true, since) : Promise.resolve(0),
  ]);
  let fresh = sharedFresh + mineFresh;
  if (since) {
    const { count, error } = await admin
      .from('transaction_questions')
      .select('id', { count: 'exact', head: true })
      .eq('asked_to', person.userId)
      .is('resolved_at', null)
      .gt('created_at', since);
    if (error) throw error;
    fresh += count ?? 0;
  }
  const { data: flags, error: flagError } = await admin
    .from('transactions')
    .select('review_priority, split_suggested, accounts!inner(hidden, is_private, user_id)')
    .eq('herd_id', person.herdId)
    .eq('pending', false)
    .eq('accounts.hidden', false)
    .or(filter)
    .order('review_priority', { ascending: false })
    .limit(50);
  if (flagError) throw flagError;
  let priority = false;
  let split = false;
  for (const row of flags ?? []) {
    const account = one(row.accounts) as { is_private?: boolean; user_id?: string } | null;
    if (account?.is_private && account.user_id !== person.userId) continue;
    if ((row.review_priority as number | null) && (row.review_priority as number) >= 1) priority = true;
    if (row.split_suggested === true) split = true;
  }
  return { count: shared + mine, fresh, priority, split };
}

async function weeklyRecap(
  admin: SupabaseClient,
  person: Person,
  spendFor: (herdId: string, start: string, end: string) => Promise<SpendLine[]>,
): Promise<Outbound[]> {
  if (!person.prefs.weekly_recap || person.weekday !== 0 || person.hour !== RECAP_HOUR) return [];
  const start = addDays(person.ymd, -6);
  const end = addDays(person.ymd, 1);
  const rows = visibleSpend(await spendFor(person.herdId, start, end), person.userId);
  const { spent, top } = recapFromSpend(rows);
  const budgets = await budgetTrack(admin, person, spendFor);
  const copy = recapCopy({ spent, top, onTrack: budgets.onTrack, budgets: budgets.total });
  if (!copy) return [];
  return [{
    userId: person.userId,
    type: 'weekly_recap',
    dedupeKey: `recap:${person.ymd}`,
    title: copy.title,
    body: copy.body,
    url: '/budgets',
    sound: true,
    urgent: false,
    channel: 'digest',
  }];
}

async function budgetTrack(
  admin: SupabaseClient,
  person: Person,
  spendFor: (herdId: string, start: string, end: string) => Promise<SpendLine[]>,
): Promise<{ onTrack: number; total: number }> {
  const month = person.ymd.slice(0, 7);
  const monthStart = `${month}-01`;
  const nextMonth = `${addDays(monthStart, 32).slice(0, 7)}-01`;
  const [{ data: budgets, error: budgetError }, rows] = await Promise.all([
    admin.from('budgets').select('category_id, amount, categories(parent_id, kind)').eq('herd_id', person.herdId),
    spendFor(person.herdId, monthStart, nextMonth),
  ]);
  if (budgetError || !budgets) return { onTrack: 0, total: 0 };
  const visible = visibleSpend(rows, person.userId);
  return budgetsOnTrack(budgets.map((budget) => {
    const category = one(budget.categories) as { parent_id?: string | null; kind?: string | null } | null;
    return {
      categoryId: budget.category_id as string,
      parentId: (category?.parent_id as string | null) ?? null,
      amount: Number(budget.amount),
      kind: (category?.kind as string | null) ?? null,
    };
  }), visible);
}

async function settleNudge(
  admin: SupabaseClient,
  person: Person,
  cache: Map<string, Promise<{ lines: SharedLine[]; settlements: Settlement[]; members: SettleMember[] }>>,
): Promise<Outbound[]> {
  if (!person.prefs.settle_nudge || person.weekday !== 0 || person.hour !== SETTLE_HOUR) return [];
  let loaded = cache.get(person.herdId);
  if (!loaded) {
    loaded = loadSettle(admin, person.herdId);
    cache.set(person.herdId, loaded);
  }
  const { lines, settlements, members } = await loaded;
  if (members.length < 2) return [];
  const net = balances(lines, settlements, members);
  const balance = net.get(person.userId) ?? 0;
  if (!nudgeUserIds(net).includes(person.userId)) return [];
  const copy = settleCopy(balance);
  return [{
    userId: person.userId,
    type: 'settle_nudge',
    dedupeKey: `settle:${person.ymd}`,
    title: copy.title,
    body: copy.body,
    url: '/settle',
    sound: true,
    urgent: false,
    channel: 'default',
  }];
}

async function loadSettle(admin: SupabaseClient, herdId: string) {
  const [{ data: memberRows, error: memberError }, { data: txRows, error: txError }, { data: paid, error: paidError }] = await Promise.all([
    admin.from('herd_members').select('user_id, joined_at').eq('herd_id', herdId),
    admin.from('transactions')
      .select('id, date, amount, split, accounts!inner(owner_id, is_private, hidden), categories(kind)')
      .eq('herd_id', herdId)
      .eq('pending', false)
      .not('split', 'is', null),
    admin.from('settlements').select('from_user, to_user, amount').eq('herd_id', herdId),
  ]);
  if (memberError || txError || paidError) throw memberError ?? txError ?? paidError;
  const members: SettleMember[] = (memberRows ?? []).map((row) => ({
    user_id: row.user_id as string,
    joined_at: (row.joined_at as string) || '1970-01-01',
  }));
  const lines: SharedLine[] = [];
  for (const tx of txRows ?? []) {
    const account = one(tx.accounts) as { owner_id?: string | null; is_private?: boolean; hidden?: boolean } | null;
    const category = one(tx.categories) as { kind?: string } | null;
    if (!account || account.hidden || account.is_private) continue;
    if (category?.kind && category.kind !== 'expense') continue;
    lines.push({
      id: tx.id as string,
      date: tx.date as string,
      amount: Number(tx.amount),
      funded_by: (account.owner_id as string | null) ?? null,
      split: tx.split as Record<string, number> | null,
    });
  }
  const settlements: Settlement[] = (paid ?? []).map((row) => ({
    from_user: row.from_user as string,
    to_user: row.to_user as string,
    amount: Number(row.amount),
  }));
  return { lines, settlements, members };
}

async function upcomingBills(admin: SupabaseClient, person: Person): Promise<Outbound[]> {
  if (!person.prefs.upcoming_bill || person.hour !== MORNING_HOUR) return [];
  const tomorrow = addDays(person.ymd, 1);
  const { data, error } = await admin
    .from('recurring_streams')
    .select('id, name, last_amount, next_date, direction, dismissed, account_id, accounts!inner(is_private, user_id, hidden)')
    .eq('herd_id', person.herdId)
    .eq('next_date', tomorrow)
    .eq('dismissed', false)
    .eq('direction', 'outflow');
  if (error) throw error;
  const items: Outbound[] = [];
  for (const stream of data ?? []) {
    const account = one(stream.accounts) as { is_private?: boolean; user_id?: string; hidden?: boolean } | null;
    if (!account || account.hidden) continue;
    if (account.is_private && account.user_id !== person.userId) continue;
    const copy = billCopy((stream.name as string) || 'A bill', Number(stream.last_amount));
    items.push({
      userId: person.userId,
      type: 'upcoming_bill',
      dedupeKey: `bill:${stream.id}:${tomorrow}`,
      title: copy.title,
      body: copy.body,
      url: '/recurring',
      sound: true,
      urgent: false,
      channel: 'default',
    });
  }
  return items;
}

async function trialEnding(admin: SupabaseClient, person: Person, now: Date): Promise<Outbound[]> {
  if (!person.prefs.trial_ending || person.hour !== MORNING_HOUR) return [];
  const { data, error } = await admin
    .from('subscriptions')
    .select('store, status, expires_at')
    .eq('user_id', person.userId)
    .maybeSingle();
  if (error || !data || data.store !== 'trial' || !data.expires_at) return [];
  const day = trialPushDay(data.expires_at as string, now);
  if (!day) return [];
  const copy = trialCopy(day);
  return [{
    userId: person.userId,
    type: 'trial_ending',
    dedupeKey: `trial:${data.expires_at}:${day}`,
    title: copy.title,
    body: copy.body,
    url: '/plan',
    sound: true,
    urgent: false,
    channel: 'default',
  }];
}

async function reconnectReminders(admin: SupabaseClient, people: Person[], now: Date): Promise<Outbound[]> {
  const byUser = new Map(people.map((person) => [person.userId, person]));
  const cutoff = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('plaid_items')
    .select('id, user_id, institution_name, login_required_at')
    .eq('status', 'login_required')
    .lte('login_required_at', cutoff);
  if (error || !data) return [];
  const items: Outbound[] = [];
  for (const item of data) {
    const person = byUser.get(item.user_id as string);
    if (!person || person.hour !== MORNING_HOUR) continue;
    const copy = reconnectReminderCopy((item.institution_name as string | null)?.trim() || 'Your bank');
    items.push({
      userId: person.userId,
      type: 'reconnect',
      dedupeKey: `reconnect-remind:${item.id}:${item.login_required_at}`,
      title: copy.title,
      body: copy.body,
      url: `/bank/${item.id}`,
      sound: true,
      urgent: true,
      channel: 'alerts',
    });
  }
  return items;
}

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return null;
}
