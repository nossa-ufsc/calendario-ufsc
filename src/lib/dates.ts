// Datas como strings YYYY-MM-DD, aritmética em UTC (sem fuso).

export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function toDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromDate(d: Date): string {
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/** 0=domingo … 6=sábado */
export function weekday(s: string): number {
  return toDate(s).getUTCDay();
}

export function diasNoMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Segunda-feira da semana (semana começando na segunda). */
export function segundaDaSemana(s: string): string {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

/** Semanas de calendário cobertas de `start` a `end` (semana seg→dom). */
export function semanasCobertas(start: string, end: string): number {
  const seg = segundaDaSemana(start);
  const dias = (toDate(end).getTime() - toDate(seg).getTime()) / 86_400_000;
  return Math.floor(dias / 7) + 1;
}

export function* cadaDia(start: string, end: string): Generator<string> {
  for (let d = start; d <= end; d = addDays(d, 1)) yield d;
}
