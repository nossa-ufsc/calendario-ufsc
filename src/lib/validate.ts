// Validação ANTES de publicar: um parse ruim falha o job, nunca sobrescreve o banco.
//
// A prova forte é a SIMULAÇÃO: para cada semestre × campus, percorremos startDate→endDate
// contando seg..sáb, pulando feriados (nacionais + do campus) e dias não letivos, e
// exigimos que a contagem por mês × dia da semana reproduza EXATAMENTE a tabela
// "DIAS LETIVOS" do PDF (num mês compartilhado por dois semestres, a soma dos dois).
// Se bater, início, término, feriados e dias não letivos foram lidos corretamente.
// Além disso conferimos os totais declarados por mês e por semestre.

import { weekday } from './dates';
import { semestresDoParse } from './build';
import { chaveMes, simularDiasLetivos } from './simulate';
import { ParsedCalendar, SIGLA_CAMPUS, SemesterCalendar } from './types';

export interface Problema {
  where: string;
  message: string;
}

export function validar(parsed: ParsedCalendar, cals: SemesterCalendar[]): Problema[] {
  const problemas: Problema[] = [];
  const shapes = semestresDoParse(parsed);
  if (shapes.length === 0) problemas.push({ where: 'geral', message: 'nenhum semestre encontrado' });
  if (!parsed.resolution) problemas.push({ where: 'geral', message: 'resolução não identificada' });

  const simDe = new Map<SemesterCalendar, Record<string, number[]>>();
  for (const cal of cals) {
    const skip = new Set([...cal.holidays, ...cal.nonClassDays].map((x) => x.date));
    simDe.set(cal, simularDiasLetivos(cal.startDate, cal.endDate, skip));
  }

  for (const cal of cals) {
    const where = `${cal.semester}/${cal.campus}`;
    const shape = shapes.find((s) => s.semester === cal.semester)!;
    const sigla = Object.keys(SIGLA_CAMPUS).find((k) => SIGLA_CAMPUS[k] === cal.campus)!;
    const sim = simDe.get(cal)!;

    if (cal.startDate >= cal.endDate) problemas.push({ where, message: `início ${cal.startDate} ≥ término ${cal.endDate}` });
    if (weekday(cal.startDate) === 0) problemas.push({ where, message: `início ${cal.startDate} cai num domingo` });
    if (weekday(cal.endDate) === 0) problemas.push({ where, message: `término ${cal.endDate} cai num domingo` });
    if (cal.weeks < 14 || cal.weeks > 26) problemas.push({ where, message: `semanas fora do esperado: ${cal.weeks}` });
    if (cal.totalClassDays < 85 || cal.totalClassDays > 140) problemas.push({ where, message: `total de dias letivos fora do esperado: ${cal.totalClassDays}` });
    if (cal.recoveryEnd && (cal.recoveryEnd > cal.endDate || cal.recoveryEnd < cal.startDate)) problemas.push({ where, message: `recuperação ${cal.recoveryStart}–${cal.recoveryEnd} fora do semestre` });
    if (cal.recessStart < cal.endDate) problemas.push({ where, message: `recesso ${cal.recessStart} antes do término ${cal.endDate}` });

    // Total declarado no PDF ("TOTAL DE DIAS LETIVOS NO … SEMESTRE")
    const declarado = parsed.declaredTotals[cal.semester]?.[cal.campus];
    if (declarado === undefined) problemas.push({ where, message: 'total declarado do semestre não encontrado' });
    else if (declarado !== cal.totalClassDays) problemas.push({ where, message: `soma das tabelas (${cal.totalClassDays}) ≠ total declarado (${declarado})` });

    // Simulação × tabela, mês a mês
    for (const m of shape.months) {
      const key = chaveMes(m.year, m.month);
      const esperado = m.campi[sigla] ?? [];
      // Mês compartilhado: soma as simulações de todos os semestres deste campus que o incluem.
      const irmaos = cals.filter((c) => c.campus === cal.campus && m.semesters.includes(c.semester));
      const obtido = [0, 0, 0, 0, 0, 0];
      for (const c of irmaos) (simDe.get(c)![key] ?? []).forEach((n, i) => (obtido[i] += n));
      if (esperado.join(',') !== obtido.join(',')) {
        problemas.push({
          where,
          message: `simulação de ${key} não bate: PDF [${esperado.join(' ')}] vs simulado [${obtido.join(' ')}]`,
        });
      }
      // Total do mês declarado para o semestre/campus
      const totMes = m.monthTotals[cal.semester]?.[cal.campus];
      const simMes = (sim[key] ?? []).reduce((a, b) => a + b, 0);
      if (totMes === undefined) problemas.push({ where, message: `total de dias letivos de ${key} não declarado para o campus` });
      else if (totMes !== simMes) problemas.push({ where, message: `total do mês ${key}: declarado ${totMes} vs simulado ${simMes}` });
    }
    for (const key of Object.keys(sim)) {
      if (!shape.months.some((m) => chaveMes(m.year, m.month) === key)) {
        problemas.push({ where, message: `simulação gerou aulas em ${key}, mês fora do semestre` });
      }
    }
  }
  return problemas;
}
