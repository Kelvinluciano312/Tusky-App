/**
 * The only code that talks to the Expo Push API. Callers hand it logical
 * pushes; this applies preferences, quiet hours, dedupe, and drops tokens Expo
 * reports as DeviceNotRegistered.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  planDelivery,
  prefsFrom,
  tokensToDrop,
  type Channel,
  type ExpoTicket,
  type NotifyType,
  type Prefs,
} from './notify.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

export type Outbound = {
  userId: string;
  type: NotifyType;
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
  sound: boolean;
  urgent: boolean;
  channel: Channel;
};

type TokenRow = { token: string; platform: string };
type Ready = { item: Outbound; title: string; body: string; sound: boolean; token: string };

export type DeliverResult = { sent: number; deferred: number; skipped: number };

async function loadPrefs(admin: SupabaseClient, userId: string): Promise<Prefs> {
  const { data, error } = await admin.from('notification_prefs').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return prefsFrom(data as Partial<Prefs> | null);
}

async function hasDedupe(admin: SupabaseClient, userId: string, dedupeKey: string): Promise<boolean> {
  const { data, error } = await admin
    .from('notification_log').select('id').eq('user_id', userId).eq('dedupe_key', dedupeKey).maybeSingle();
  if (error) throw error;
  return !!data;
}

function message(row: Ready) {
  return {
    to: row.token,
    title: row.title,
    body: row.body,
    data: { url: row.item.url },
    sound: row.sound ? 'default' : null,
    priority: row.item.urgent ? 'high' : 'default',
    channelId: row.item.channel,
    collapseId: row.item.dedupeKey.slice(0, 64),
  };
}

async function postExpo(rows: Ready[], fetchFn: typeof fetch): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const res = await fetchFn(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(slice.map(message)),
    });
    if (!res.ok) throw new Error(`expo push ${res.status}`);
    const body = await res.json() as { data?: ExpoTicket[] };
    const data = Array.isArray(body?.data) ? body.data : [];
    tickets.push(...data);
  }
  return tickets;
}

/**
 * Filter and send. A failure here must not escape: callers are syncs, joins,
 * and webhooks that have already done their real work. Returns counts.
 */
export async function deliver(
  admin: SupabaseClient,
  items: Outbound[],
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<DeliverResult> {
  const result: DeliverResult = { sent: 0, deferred: 0, skipped: 0 };
  const ready: Ready[] = [];
  const claimed: Outbound[] = [];

  for (const item of items) {
    try {
      const prefs = await loadPrefs(admin, item.userId);
      const duplicate = await hasDedupe(admin, item.userId, item.dedupeKey);
      const plan = planDelivery({
        type: item.type,
        prefs,
        now,
        duplicate,
        urgent: item.urgent,
        sound: item.sound,
        title: item.title,
        body: item.body,
      });
      if (plan.action === 'skip') {
        result.skipped++;
        continue;
      }
      if (plan.action === 'defer') {
        const { error } = await admin.from('notification_log').insert({
          user_id: item.userId,
          type: item.type,
          dedupe_key: item.dedupeKey,
          title: item.title,
          body: item.body,
          url: item.url,
          sound: item.sound,
          channel: item.channel,
          urgent: item.urgent,
          deliver_after: plan.deliverAfter,
        });
        if (error) {
          result.skipped++;
          if (error.code !== '23505') console.warn(`push defer failed: ${error.message}`);
        } else {
          result.deferred++;
        }
        continue;
      }
      const { data: tokens, error: tokenError } = await admin
        .from('push_tokens').select('token, platform').eq('user_id', item.userId);
      if (tokenError) throw tokenError;
      if (!tokens || tokens.length === 0) {
        result.skipped++;
        continue;
      }
      const { error: claimError } = await admin.from('notification_log').insert({
        user_id: item.userId,
        type: item.type,
        dedupe_key: item.dedupeKey,
        title: item.title,
        body: item.body,
        url: item.url,
        sound: plan.sound,
        channel: item.channel,
        urgent: item.urgent,
        deliver_after: now.toISOString(),
      });
      if (claimError) {
        result.skipped++;
        if (claimError.code !== '23505') console.warn(`push claim failed: ${claimError.message}`);
        continue;
      }
      claimed.push(item);
      for (const token of tokens as TokenRow[]) {
        ready.push({ item, title: plan.title, body: plan.body, sound: plan.sound, token: token.token });
      }
    } catch (err) {
      result.skipped++;
      console.warn(`push skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (ready.length === 0) return result;

  try {
    const tickets = await postExpo(ready, fetchFn);
    const dead = tokensToDrop(ready.map((row) => row.token), tickets);
    if (dead.length > 0) {
      const { error } = await admin.from('push_tokens').delete().in('token', dead);
      if (error) console.warn(`push token prune failed: ${error.message}`);
    }
    const failedTokens = new Set(
      tickets.flatMap((ticket, index) => (ticket?.status === 'error' ? [ready[index]?.token] : [])),
    );
    const sentUsers = new Set<string>();
    ready.forEach((row) => {
      if (!failedTokens.has(row.token)) sentUsers.add(`${row.item.userId}:${row.item.dedupeKey}`);
    });
    for (const item of claimed) {
      const key = `${item.userId}:${item.dedupeKey}`;
      if (!sentUsers.has(key)) continue;
      const { error } = await admin
        .from('notification_log')
        .update({ sent_at: now.toISOString(), deliver_after: null })
        .eq('user_id', item.userId)
        .eq('dedupe_key', item.dedupeKey);
      if (error) console.warn(`push log update failed: ${error.message}`);
      else result.sent++;
    }
  } catch (err) {
    console.warn(`expo push failed: ${err instanceof Error ? err.message : String(err)}`);
    // The claim stays with deliver_after = now, so the hourly flush retries.
  }
  return result;
}

/** Send rows that were deferred for quiet hours or left behind by a failed post. */
export async function flushDue(admin: SupabaseClient, now: Date, fetchFn: typeof fetch = fetch): Promise<DeliverResult> {
  const { data, error } = await admin
    .from('notification_log')
    .select('user_id, type, dedupe_key, title, body, url, sound, channel, urgent')
    .is('sent_at', null)
    .lte('deliver_after', now.toISOString())
    .limit(200);
  if (error) throw error;
  const result: DeliverResult = { sent: 0, deferred: 0, skipped: 0 };
  const ready: Ready[] = [];

  for (const row of data ?? []) {
    const item: Outbound = {
      userId: row.user_id as string,
      type: row.type as NotifyType,
      dedupeKey: row.dedupe_key as string,
      title: row.title as string,
      body: row.body as string,
      url: row.url as string,
      sound: row.sound as boolean,
      urgent: row.urgent as boolean,
      channel: (row.channel as Channel) ?? 'default',
    };
    try {
      const prefs = await loadPrefs(admin, item.userId);
      const plan = planDelivery({
        type: item.type,
        prefs,
        now,
        duplicate: false,
        urgent: item.urgent,
        sound: item.sound,
        title: item.title,
        body: item.body,
      });
      if (plan.action === 'skip') {
        await admin.from('notification_log').delete().eq('user_id', item.userId).eq('dedupe_key', item.dedupeKey);
        result.skipped++;
        continue;
      }
      if (plan.action === 'defer') {
        await admin.from('notification_log').update({ deliver_after: plan.deliverAfter })
          .eq('user_id', item.userId).eq('dedupe_key', item.dedupeKey);
        result.deferred++;
        continue;
      }
      const { data: tokens, error: tokenError } = await admin
        .from('push_tokens').select('token, platform').eq('user_id', item.userId);
      if (tokenError) throw tokenError;
      if (!tokens || tokens.length === 0) {
        result.skipped++;
        continue;
      }
      for (const token of tokens as TokenRow[]) {
        ready.push({ item, title: plan.title, body: plan.body, sound: plan.sound, token: token.token });
      }
    } catch (err) {
      result.skipped++;
      console.warn(`push flush skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (ready.length === 0) return result;
  try {
    const tickets = await postExpo(ready, fetchFn);
    const dead = tokensToDrop(ready.map((row) => row.token), tickets);
    if (dead.length > 0) await admin.from('push_tokens').delete().in('token', dead);
    const failedTokens = new Set(
      tickets.flatMap((ticket, index) => (ticket?.status === 'error' ? [ready[index]?.token] : [])),
    );
    const done = new Set<string>();
    for (const row of ready) {
      const key = `${row.item.userId}:${row.item.dedupeKey}`;
      if (done.has(key) || failedTokens.has(row.token)) continue;
      done.add(key);
      const { error: updateError } = await admin
        .from('notification_log')
        .update({ sent_at: now.toISOString(), deliver_after: null })
        .eq('user_id', row.item.userId)
        .eq('dedupe_key', row.item.dedupeKey);
      if (!updateError) result.sent++;
    }
  } catch (err) {
    console.warn(`expo flush failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

/** Drop log rows older than 90 days. A failure here is not fatal. */
export async function pruneLog(admin: SupabaseClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const { error } = await admin.from('notification_log').delete().lt('created_at', cutoff);
  if (error) console.warn(`notification log prune failed: ${error.message}`);
}
