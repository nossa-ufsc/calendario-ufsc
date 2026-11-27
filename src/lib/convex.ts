// Envio ao Convex (backend novo do app): POST {CONVEX_SITE_URL}/ingest/academic-calendar
// com Bearer INGEST_API_KEY, um registro (semestre × campus) por chamada. CONVEX_SITE_URL
// aceita vários deployments separados por vírgula (dev e prod); a mesma chave vale nos dois.
//
// TRANSIÇÃO: o Supabase (via events-admin) continua sendo o destino principal. O
// Convex recebe uma cópia; sem as envs o envio é pulado e uma falha só gera aviso.

import type { SemesterCalendar } from './types';

export async function enviarCalendariosParaConvex(
  calendars: SemesterCalendar[]
): Promise<number | 'sem-config'> {
  const bases = convexSiteUrls();
  const chave = process.env.INGEST_API_KEY;
  if (!bases.length || !chave) return 'sem-config';

  // Um deployment fora do ar não impede o envio aos outros.
  const erros: string[] = [];
  for (const base of bases) {
    try {
      for (const c of calendars) {
        const res = await fetch(`${base}/ingest/academic-calendar`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
          body: JSON.stringify(c),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          throw new Error(
            `(${c.semester} ${c.campus}) HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
          );
        }
      }
    } catch (err) {
      erros.push(`${base}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (erros.length) throw new Error(`Convex /ingest/academic-calendar -> ${erros.join(' | ')}`);
  return calendars.length;
}

function convexSiteUrls(): string[] {
  return (process.env.CONVEX_SITE_URL ?? '')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
