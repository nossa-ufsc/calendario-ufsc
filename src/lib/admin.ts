// Escrita no Supabase via Edge Function `events-admin` (ação `calendar-upsert`,
// autorizada pelo PIPELINE_TOKEN). A service role NUNCA fica neste repo.

import { SemesterCalendar } from './types';

export interface AdminConfig {
  url: string; // https://<ref>.supabase.co/functions/v1/events-admin
  token: string;
}

export function adminConfigDoAmbiente(): AdminConfig | null {
  const url = process.env.EVENTS_ADMIN_URL;
  const token = process.env.EVENTS_ADMIN_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export async function upsertCalendarios(cfg: AdminConfig, calendars: SemesterCalendar[]) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ action: 'calendar-upsert', calendars }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`calendar-upsert falhou: HTTP ${res.status} ${body.slice(0, 500)}`);
  try {
    return JSON.parse(body) as { ok: boolean; upserted: number };
  } catch {
    return { ok: true, upserted: calendars.length };
  }
}
