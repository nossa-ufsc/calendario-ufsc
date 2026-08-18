// Simula os dias letivos de um intervalo: seg..sáb, pulando as datas em `skip`.
// Retorna contagens por mês ("YYYY-MM") × dia da semana (seg..sáb).

import { cadaDia, weekday } from './dates';

export type ContagemMensal = Record<string, number[]>;

export function simularDiasLetivos(start: string, end: string, skip: Set<string>): ContagemMensal {
  const sim: ContagemMensal = {};
  for (const d of cadaDia(start, end)) {
    const wd = weekday(d);
    if (wd === 0 || skip.has(d)) continue;
    const key = d.slice(0, 7);
    sim[key] = sim[key] ?? [0, 0, 0, 0, 0, 0];
    sim[key][wd - 1]++;
  }
  return sim;
}

export const chaveMes = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
