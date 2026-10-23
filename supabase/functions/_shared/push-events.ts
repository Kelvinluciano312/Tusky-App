/**
 * Builds the pushes each product event should send. Failures are logged and
 * swallowed by the callers: a missed notification never fails a sync, a join,
 * or a webhook.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  addDays,
  budgetCopy,
  budgetLevel,
  budgetLevelToSend,
  canSeeAccount,
  changedPrices,
  daysRemaining,
  herdJoinedCopy,
  isLargeOutflow,
  largeCopy,
  overLimitCopy,
  graceCopy,
  pendingExpirationCopy,
  priceCopy,
  questionAnsweredCopy,
  questionAskedCopy,
  reconnectCopy,
  spentAgainstBudget,
  visibleSpend,
  type Prefs,
  type SpendLine,
} from './notify.ts';
import { deliver, type Outbound } from './push-send.ts';

type AccountView = { isPrivate: boolean; connectorId: string };

function asAccount(row: { is_private?: boolean; user_id?: string } | null): AccountView | null {
  if (!row || !row.user_id) return null;
  return { isPrivate: row.is_private === true, connectorId: row.user_id };
}

async function membersOf(admin: SupabaseClient, herdId: string): Promise<string[]> {
  const { data, error } = await admin.from('herd_members').select('user_id').eq('herd_id', herdId);
  if (error) throw error;
  return (data ?? []).map((row) => row.user_id as string);
}

async function nameOf(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
  const name = (data?.display_name as string | undefined)?.trim();
  return name || 'Someone';
}

async function prefsFor(admin: SupabaseClient, userIds: string[]): Promise<Map<string, Partial<Prefs>>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await admin.from('notification_prefs').select('*').in('user_id', userIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.user_id as string, row as Partial<Prefs>]));
}

/** Active -> login_required, once. The winner of the conditional update is the one that pushes. */
export async function noteLoginRequired(
  admin: SupabaseClient,
  itemId: string,
): Promise<{ became: boolean; error: string | null }> {
  const now = new Date();
  const { data, error } = await admin
    .from('plaid_items')
    .update({ status: 'login_required', login_required_at: now.toISOString() })
    .eq('id', itemId)
    .eq('status', 'active')
    .select('id, user_id, institution_name, login_required_at')
    .maybeSingle();
  if (error) return { became: false, error: error.message };
  if (!data) return { became: false, error: null };
  const copy = reconnectCopy((data.institution_name as string | null)?.trim() || 'Your bank');
  await deliver(admin, [{
    userId: data.user_id as string,
    type: 'reconnect',
    dedupeKey: `reconnect:${itemId}:${data.login_required_at}`,
    title: copy.title,
    body: copy.body,
    url: `/bank/${itemId}`,
    sound: true,
    urgent: true,
    channel: 'alerts',
  }], now);
  return { became: true, error: null };
}

/** Heads-up only. Status stays whatever it was. */
export async function notifyPendingExpiration(admin: SupabaseClient, itemId: string): Promise<void> {
  const { data, error } = await admin
    .from('plaid_items')
    .select('id, user_id, institution_name, status')
    .eq('id', itemId)
    .maybeSingle();
  if (error || !data || data.status === 'archived') return;
  const copy = pendingExpirationCopy((data.institution_name as string | null)?.trim() || 'Your bank');
  await deliver(admin, [{
    userId: data.user_id as string,
    type: 'pending_expiration',
    dedupeKey: `pending_exp:${itemId}`,
    title: copy.title,
    body: copy.body,
    url: `/bank/${itemId}`,
    sound: true,
    urgent: false,
    channel: 'alerts',
  }], new Date());
}

export async function notifyHerdJoined(admin: SupabaseClient, herdId: string, joinerId: string): Promise<void> {
  const members = await membersOf(admin, herdId);
  const copy = herdJoinedCopy(await nameOf(admin, joinerId));
  const items: Outbound[] = members.filter((id) => id !== joinerId).map((userId) => ({
    userId,
    type: 'herd_joined',
    dedupeKey: `join:${herdId}:${joinerId}`,
    title: copy.title,
    body: copy.body,
    url: '/herd',
    sound: true,
    urgent: false,
    channel: 'default',
  }));
  if (items.length > 0) await deliver(admin, items, new Date());
}

export async function notifyGrace(admin: SupabaseClient, userId: string, expiresAt: string | null): Promise<void> {
  const copy = graceCopy();
  await deliver(admin, [{
    userId,
    type: 'billing_issue',
    dedupeKey: `grace:${userId}:${expiresAt ?? 'none'}`,
    title: copy.title,
    body: copy.body,
    url: '/plan',
    sound: true,
    urgent: true,
    channel: 'alerts',
  }], new Date());
}

export async function notifyOverLimit(
  admin: SupabaseClient,
  userIds: string[],
  input: { since: string; maxBanks: number; banksUsed: number; now: Date },
): Promise<void> {
  const copy = overLimitCopy(input.maxBanks, input.banksUsed, daysRemaining(input.since, input.now));
  const items: Outbound[] = userIds.map((userId) => ({
    userId,
    type: 'billing_issue',
    dedupeKey: `over:${userId}:${input.since}`,
    title: copy.title,
    body: copy.body,
    url: '/plan',
    sound: true,
    urgent: true,
    channel: 'alerts',
  }));
  if (items.length > 0) await deliver(admin, items, input.now);
}

export async function onQuestionAsked(admin: SupabaseClient, questionId: string, now: Date): Promise<void> {
  const { data: question, error } = await admin
    .from('transaction_questions')
    .select('id, asked_by, asked_to, body, transaction_id')
    .eq('id', questionId)
    .maybeSingle();
  if (error || !question) return;
  const { data: tx } = await admin
    .from('transactions')
    .select('id, merchant_name, name, amount, account_id')
    .eq('id', question.transaction_id)
    .maybeSingle();
  if (!tx) return;
  const { data: account } = await admin.from('accounts').select('is_private, user_id').eq('id', tx.account_id).maybeSingle();
  const view = asAccount(account);
  if (!view) return;
  const copy = questionAskedCopy({
    askerName: await nameOf(admin, question.asked_by as string),
    askerId: question.asked_by as string,
    merchant: (tx.merchant_name as string | null) || (tx.name as string | null),
    amount: Number(tx.amount),
    body: question.body as string | null,
    transactionId: tx.id as string,
    now,
    canSee: canSeeAccount(question.asked_to as string, view),
  });
  if (!copy) return;
  await deliver(admin, [{
    userId: question.asked_to as string,
    type: 'question_asked',
    dedupeKey: copy.dedupeKey,
    title: copy.title,
    body: copy.body,
    url: copy.url,
    sound: true,
    urgent: false,
    channel: 'default',
  }], now);
}

export async function onQuestionAnswered(admin: SupabaseClient, transactionId: string, now: Date): Promise<void> {
  const { data: tx } = await admin
    .from('transactions')
    .select('id, merchant_name, name, account_id, answered_by')
    .eq('id', transactionId)
    .maybeSingle();
  if (!tx?.answered_by) return;
  const { data: question } = await admin
    .from('transaction_questions')
    .select('id, asked_by, asked_to')
    .eq('transaction_id', transactionId)
    .eq('asked_to', tx.answered_by)
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!question) return;
  const { data: account } = await admin.from('accounts').select('is_private, user_id').eq('id', tx.account_id).maybeSingle();
  const view = asAccount(account);
  if (!view) return;
  const copy = questionAnsweredCopy({
    answererName: await nameOf(admin, tx.answered_by as string),
    merchant: (tx.merchant_name as string | null) || (tx.name as string | null),
    transactionId,
    questionId: question.id as string,
    canSee: canSeeAccount(question.asked_by as string, view),
  });
  if (!copy) return;
  await deliver(admin, [{
    userId: question.asked_by as string,
    type: 'question_answered',
    dedupeKey: copy.dedupeKey,
    title: copy.title,
    body: copy.body,
    url: copy.url,
    sound: false,
    urgent: false,
    channel: 'silent',
  }], now);
}

type SyncInput = {
  herdId: string;
  addedPlaidIds: string[];
  accountIds: string[];
  streamsBefore: { id: string; amount_change: number | null }[];
  /** False when recurring detection did not finish, so a stale price is not announced. */
  notifyPrices: boolean;
  now: Date;
};

type SpendRow = {
  category_id: string;
  parent_id: string | null;
  category_name: string | null;
  connector_id: string | null;
  is_private: boolean | null;
  spent: number | string;
};

/** Expense spend in [start, end), including private rows. Callers filter visibility. */
export async function loadCategorySpend(
  admin: SupabaseClient,
  herdId: string,
  start: string,
  end: string,
): Promise<SpendLine[]> {
  const { data, error } = await admin.rpc('notification_category_spend', {
    p_herd: herdId,
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  return ((data ?? []) as SpendRow[]).map((row) => ({
    categoryId: row.category_id,
    parentId: row.parent_id,
    name: row.category_name ?? 'Other',
    connectorId: row.connector_id ?? '',
    isPrivate: row.is_private === true,
    spent: Number(row.spent),
  }));
}

/** Large purchases, budget levels, and price changes after a successful sync. */
export async function onSyncNotifications(admin: SupabaseClient, input: SyncInput): Promise<void> {
  const members = await membersOf(admin, input.herdId);
  if (members.length === 0) return;
  const prefs = await prefsFor(admin, members);
  const items: Outbound[] = [];
  items.push(...await largeItems(admin, input, members, prefs));
  items.push(...await budgetItems(admin, input, members, prefs));
  if (input.notifyPrices) items.push(...await priceItems(admin, input, members));
  if (items.length > 0) await deliver(admin, items, input.now);
}

async function largeItems(
  admin: SupabaseClient,
  input: SyncInput,
  members: string[],
  prefs: Map<string, Partial<Prefs>>,
): Promise<Outbound[]> {
  if (input.addedPlaidIds.length === 0) return [];
  const data: {
    id: string;
    amount: number | string;
    pending: boolean | null;
    merchant_name: string | null;
    name: string | null;
    account_id: string;
    category_id: string | null;
  }[] = [];
  for (let i = 0; i < input.addedPlaidIds.length; i += 200) {
    const slice = input.addedPlaidIds.slice(i, i + 200);
    const { data: page, error } = await admin
      .from('transactions')
      .select('id, amount, pending, merchant_name, name, account_id, category_id, plaid_transaction_id')
      .in('plaid_transaction_id', slice);
    if (error) return [];
    data.push(...(page ?? []));
  }
  if (data.length === 0) return [];
  const accountIds = [...new Set(data.map((row) => row.account_id as string))];
  const categoryIds = [...new Set(data.map((row) => row.category_id as string).filter(Boolean))];
  const [{ data: accounts }, { data: categories }] = await Promise.all([
    admin.from('accounts').select('id, is_private, user_id').in('id', accountIds),
    categoryIds.length > 0
      ? admin.from('categories').select('id, kind, slug').in('id', categoryIds)
      : Promise.resolve({ data: [] as { id: string; kind: string; slug: string | null }[] }),
  ]);
  const accountById = new Map((accounts ?? []).map((row) => [row.id as string, asAccount(row)]));
  const categoryById = new Map((categories ?? []).map((row) => [row.id as string, row]));
  const out: Outbound[] = [];
  for (const tx of data) {
    const account = accountById.get(tx.account_id as string);
    if (!account) continue;
    const category = categoryById.get(tx.category_id as string);
    const merchant = ((tx.merchant_name as string | null) || (tx.name as string | null) || 'A purchase').trim();
    for (const userId of members) {
      if (!canSeeAccount(userId, account)) continue;
      const row = prefs.get(userId);
      const threshold = typeof row?.large_cents === 'number' ? row.large_cents : 50_000;
      if (row?.large_transaction !== true) continue;
      if (!isLargeOutflow({
        amount: Number(tx.amount),
        pending: tx.pending === true,
        kind: category?.kind ?? null,
        slug: category?.slug ?? null,
        thresholdCents: threshold,
      })) continue;
      const copy = largeCopy(merchant, Number(tx.amount));
      out.push({
        userId,
        type: 'large_transaction',
        dedupeKey: `large:${tx.id}`,
        title: copy.title,
        body: copy.body,
        url: `/transaction/${tx.id}`,
        sound: true,
        urgent: false,
        channel: 'alerts',
      });
    }
  }
  return out;
}

async function budgetItems(
  admin: SupabaseClient,
  input: SyncInput,
  members: string[],
  prefs: Map<string, Partial<Prefs>>,
): Promise<Outbound[]> {
  const month = input.now.toISOString().slice(0, 7);
  const monthStart = `${month}-01`;
  const nextMonth = `${addDays(monthStart, 32).slice(0, 7)}-01`;
  const [{ data: budgets, error: budgetError }, spend] = await Promise.all([
    admin.from('budgets').select('category_id, amount').eq('herd_id', input.herdId),
    loadCategorySpend(admin, input.herdId, monthStart, nextMonth),
  ]);
  if (budgetError || !budgets || budgets.length === 0) return [];
  const shared = visibleSpend(spend, null);
  const categoryIds = budgets.map((row) => row.category_id as string);
  const { data: categories } = await admin.from('categories').select('id, name, kind, parent_id').in('id', categoryIds);
  const categoryById = new Map((categories ?? []).map((row) => [row.id as string, row]));
  const { data: logs } = await admin
    .from('notification_log')
    .select('user_id, dedupe_key')
    .eq('type', 'budget_alert')
    .in('user_id', members);
  const sentByUser = new Map<string, Set<string>>();
  for (const log of logs ?? []) {
    const set = sentByUser.get(log.user_id as string) ?? new Set<string>();
    set.add(log.dedupe_key as string);
    sentByUser.set(log.user_id as string, set);
  }
  const out: Outbound[] = [];
  for (const budget of budgets) {
    const category = categoryById.get(budget.category_id as string);
    if (category?.kind && category.kind !== 'expense') continue;
    const amount = Number(budget.amount);
    const spent = spentAgainstBudget({
      categoryId: budget.category_id as string,
      parentId: (category?.parent_id as string | null) ?? null,
    }, shared);
    const level = budgetLevel(spent, amount);
    if (!level) continue;
    const name = (category?.name as string | undefined) || 'A category';
    for (const userId of members) {
      const pref = prefs.get(userId);
      const choice = budgetLevelToSend(level, {
        budget_80: pref?.budget_80 === true,
        budget_100: pref?.budget_100 !== false,
      }, levelsSent(sentByUser.get(userId), input.herdId, budget.category_id as string, month));
      if (!choice) continue;
      const copy = budgetCopy(name, choice, spent, amount);
      out.push({
        userId,
        type: 'budget_alert',
        dedupeKey: `budget:${input.herdId}:${budget.category_id}:${month}:${choice}`,
        title: copy.title,
        body: copy.body,
        url: '/budgets',
        sound: true,
        urgent: false,
        channel: 'alerts',
      });
    }
  }
  return out;
}

function levelsSent(keys: Set<string> | undefined, herdId: string, categoryId: string, month: string): Set<80 | 100> {
  const sent = new Set<80 | 100>();
  if (!keys) return sent;
  if (keys.has(`budget:${herdId}:${categoryId}:${month}:80`)) sent.add(80);
  if (keys.has(`budget:${herdId}:${categoryId}:${month}:100`)) sent.add(100);
  return sent;
}

async function priceItems(admin: SupabaseClient, input: SyncInput, members: string[]): Promise<Outbound[]> {
  if (input.accountIds.length === 0) return [];
  const { data, error } = await admin
    .from('recurring_streams')
    .select('id, amount_change, name, last_amount, account_id, dismissed')
    .in('account_id', input.accountIds);
  if (error || !data) return [];
  const changed = changedPrices(input.streamsBefore, data.map((row) => ({
    id: row.id as string,
    amount_change: row.amount_change === null ? null : Number(row.amount_change),
    name: row.name as string,
    last_amount: Number(row.last_amount),
    account_id: row.account_id as string,
    dismissed: row.dismissed === true,
  })));
  if (changed.length === 0) return [];
  const accountIds = [...new Set(changed.map((row) => row.account_id).filter((id): id is string => !!id))];
  const { data: accounts } = await admin.from('accounts').select('id, is_private, user_id').in('id', accountIds);
  const accountById = new Map((accounts ?? []).map((row) => [row.id as string, asAccount(row)]));
  const out: Outbound[] = [];
  for (const stream of changed) {
    const account = stream.account_id ? accountById.get(stream.account_id) : null;
    if (!account) continue;
    const copy = priceCopy(stream.name || 'A bill', Number(stream.amount_change), Number(stream.last_amount));
    for (const userId of members) {
      if (!canSeeAccount(userId, account)) continue;
      out.push({
        userId,
        type: 'price_change',
        dedupeKey: `price:${stream.id}:${stream.last_amount}`,
        title: copy.title,
        body: copy.body,
        url: '/recurring',
        sound: true,
        urgent: false,
        channel: 'default',
      });
    }
  }
  return out;
}
