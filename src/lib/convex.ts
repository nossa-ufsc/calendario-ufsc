// Envio ao Convex (backend novo do app): POST {CONVEX_SITE_URL}/ingest/academic-calendar
// com Bearer INGEST_API_KEY, um registro (semestre × campus) por chamada.
//
// TRANSIÇÃO: o Supabase (via events-admin) continua sendo o destino principal. O
// Convex recebe uma cópia; sem as envs o envio é pulado e uma falha só gera aviso.

import type { SemesterCalendar } from './types';

export async function enviarCalendariosParaConvex(
  calendars: SemesterCalendar[]
): Promise<number | 'sem-config'> {
  const base = process.env.CONVEX_SITE_URL?.replace(/\/$/, '');
  const chave = process.env.INGEST_API_KEY;
  if (!base || !chave) return 'sem-config';

  for (const c of calendars) {
    const res = await fetch(`${base}/ingest/academic-calendar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(
        `Convex /ingest/academic-calendar (${c.semester} ${c.campus}) -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }
  }
  return calendars.length;
}
