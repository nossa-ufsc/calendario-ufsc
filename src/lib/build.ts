// Monta os registros finais (semestre × campus) a partir do parse bruto.

import { addDays, iso, semanasCobertas, weekday } from './dates';
import { chaveMes, simularDiasLetivos } from './simulate';
import {
  CAMPI,
  Campus,
  DatedLabel,
  MonthTable,
  ParsedCalendar,
  SIGLA_CAMPUS,
  SemesterCalendar,
  SourceInfo,
} from './types';

export interface SemesterShape {
  semester: string;
  ordinal: 1 | 2;
  months: MonthTable[]; // meses com Total de dias letivos = este semestre
  startMonth: MonthTable;
  endMonth: MonthTable;
}

export function semestresDoParse(parsed: ParsedCalendar): SemesterShape[] {
  const out: SemesterShape[] = [];
  for (const ordinal of [1, 2] as const) {
    const semester = `${parsed.year}.${ordinal}`;
    const months = parsed.months.filter((m) => m.semesters.includes(semester));
    if (months.length === 0) continue;
    const comAulas = months.filter((m) => Object.values(m.campi).some((v) => v.some((n) => n > 0)));
    if (comAulas.length === 0) throw new Error(`${semester}: nenhum mês com dias letivos`);
    out.push({
      semester,
      ordinal,
      months,
      startMonth: comAulas[0],
      endMonth: comAulas[comAulas.length - 1],
    });
  }
  return out;
}

function anchorFor(parsed: ParsedCalendar, ordinal: 1 | 2, kind: 'start' | 'end', campus: Campus) {
  const cands = parsed.anchors.filter(
    (a) => a.ordinal === ordinal && a.kind === kind && a.year === parsed.year
  );
  // 1) linha específica do campus vence
  const only = cands.find((a) => a.onlyCampus === campus);
  if (only) return only;
  // 2) linha geral que não exclui este campus
  const geral = cands.find((a) => a.onlyCampus === null && !a.exceptCampi.includes(campus));
  if (geral) return geral;
  return null;
}

export interface BuildOptions {
  /**
   * Trata os dias do vestibular (COPERVE) como dias não letivos. O PDF não os lista
   * na caixinha, mas em alguns anos (2026) o sábado do vestibular NÃO conta como dia
   * letivo na tabela; em outros (2025) conta. O pipeline tenta sem e, se a simulação
   * não bater, tenta com — a tabela é quem manda.
   */
  vestibularNaoLetivo?: boolean;
}

export function montarCalendarios(
  parsed: ParsedCalendar,
  source: SourceInfo,
  opts: BuildOptions = {}
): SemesterCalendar[] {
  const out: SemesterCalendar[] = [];
  const shapes = semestresDoParse(parsed);

  shapes.forEach((shape, idx) => {
    for (const campus of CAMPI) {
      const sigla = Object.keys(SIGLA_CAMPUS).find((k) => SIGLA_CAMPUS[k] === campus)!;
      const start = anchorFor(parsed, shape.ordinal, 'start', campus);
      const end = anchorFor(parsed, shape.ordinal, 'end', campus);
      if (!start) throw new Error(`${shape.semester}/${campus}: início do período letivo não encontrado`);
      if (!end) throw new Error(`${shape.semester}/${campus}: término do período letivo não encontrado`);

      const startDate = iso(shape.startMonth.year, shape.startMonth.month, start.day);
      const endDate = iso(shape.endMonth.year, shape.endMonth.month, end.day);

      const holidays: DatedLabel[] = [];
      const nonClassDays: DatedLabel[] = [];
      for (const m of shape.months) {
        for (const h of m.holidays) {
          if (h.campus && h.campus !== campus) continue;
          const date = iso(m.year, m.month, h.day);
          if (date >= startDate && date <= endDate) holidays.push({ date, label: h.label });
        }
        for (const d of m.nonClassDays) {
          const date = iso(m.year, m.month, d.day);
          if (date >= startDate && date <= endDate) nonClassDays.push({ date, label: d.label });
        }
      }
      if (opts.vestibularNaoLetivo && shape.ordinal === 2) {
        // O vestibular cai no último mês do 2º semestre (dezembro).
        for (const dias of parsed.vestibular) {
          for (const day of dias) {
            const date = iso(shape.endMonth.year, shape.endMonth.month, day);
            if (date >= startDate && date <= endDate) nonClassDays.push({ date, label: 'Vestibular UFSC' });
          }
        }
      }
      // Um mesmo dia pode aparecer duas vezes (feriado nacional + municipal) — dedup por data.
      // Domingos ficam de fora (nunca há aula; "Páscoa" e o domingo do vestibular só poluem).
      const dedup = (xs: DatedLabel[]) => {
        const seen = new Map<string, DatedLabel>();
        for (const x of xs) if (weekday(x.date) !== 0 && !seen.has(x.date)) seen.set(x.date, x);
        return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
      };
      const feriados = dedup(holidays);
      const naoLetivos = dedup(nonClassDays);

      // Dias letivos por dia da semana: a tabela do PDF é a fonte quando o mês é só deste
      // semestre; num mês compartilhado (agosto/2024 pós-greve) a tabela soma os dois
      // semestres e a parte deste é obtida por simulação (validada depois em validate.ts).
      const skip = new Set([...feriados, ...naoLetivos].map((x) => x.date));
      const sim = simularDiasLetivos(startDate, endDate, skip);
      const classDaysByWeekday = [0, 0, 0, 0, 0, 0];
      for (const m of shape.months) {
        const row = m.campi[sigla];
        if (!row) throw new Error(`${shape.semester}/${campus}: sem linha ${sigla} em ${m.month}/${m.year}`);
        const fonte = m.semesters.length === 1 ? row : (sim[chaveMes(m.year, m.month)] ?? [0, 0, 0, 0, 0, 0]);
        fonte.forEach((n, i) => (classDaysByWeekday[i] += n));
      }

      const rec = parsed.recoveries[idx];
      const recoveryStart = rec ? iso(shape.endMonth.year, shape.endMonth.month, rec.day1) : null;
      const recoveryEnd = rec ? iso(shape.endMonth.year, shape.endMonth.month, rec.day2) : null;
      // Recesso: normalmente o dia seguinte ao término. Se o dia declarado não couber
      // logo após o término deste campus (ex.: Blumenau/2025.2 terminou depois dos
      // demais e o recesso declarado "exceto Blumenau" não vale para ele), usa término+1.
      const recessoDia = parsed.recesses[idx];
      let recessStart: string = addDays(endDate, 1);
      if (recessoDia !== undefined) {
        const candidatos = [iso(shape.endMonth.year, shape.endMonth.month, recessoDia)];
        {
          const y = shape.endMonth.month === 12 ? shape.endMonth.year + 1 : shape.endMonth.year;
          const m = shape.endMonth.month === 12 ? 1 : shape.endMonth.month + 1;
          candidatos.push(iso(y, m, recessoDia));
        }
        const ok = candidatos.find((c) => c >= endDate && c <= addDays(endDate, 3));
        if (ok) recessStart = ok;
      }

      out.push({
        semester: shape.semester,
        campus,
        startDate,
        endDate,
        weeks: semanasCobertas(startDate, endDate),
        recoveryStart,
        recoveryEnd,
        recessStart,
        classDaysByWeekday,
        totalClassDays: classDaysByWeekday.reduce((a, b) => a + b, 0),
        holidays: feriados,
        nonClassDays: naoLetivos,
        source,
      });
    }
  });

  return out;
}
