// Parser do texto do PDF "Calendário Acadêmico de Graduação" (Resolução do CUn,
// publicado pelo DAE). O layout é estável desde pelo menos 2024:
//
//   MARÇO 2026                      ← cabeçalho do mês (caixinha do calendário)
//   D S T Q Q S S / 01 02 …         ← grade de dias (ignorada)
//   DIAS LETIVOS
//   CAMPI S T Q Q S S
//   ARA 04 04 03 03 03 03           ← dias letivos seg..sáb por campus
//   …
//   Feriados                        ← (2024 não tem esse cabeçalho)
//   09 – Aniversário da Cidade
//   (Campus de Joinville)           ← qualificador de campus (na mesma linha ou na seguinte,
//   Dias não letivos                   às vezes quebrado: "(Campus" / "de Joinville)")
//   04 e 20 – Dias não letivos
//   Total de dias letivos 2026.1    ← diz a que semestre o mês pertence e fecha a caixinha
//
// e, no fluxo de eventos:
//   09 Início do primeiro período letivo semestral de graduação de 2026.
//   11 Início do segundo período letivo semestral de graduação de 2025, exceto para o Campus de
//   Blumenau.                       ← pode quebrar linha
//   18 Campus de Blumenau – Início do segundo período letivo semestral de graduação de 2025.
//   09 a 15 Período de recuperação.
//   16 Início do recesso escolar.
//   05 e 06 COPERVE – Período reservado ao Vestibular UFSC/2027.
//
// O mês dos eventos NÃO é confiável pela posição no texto (layout em duas
// colunas), então o mês de início/término é inferido pelas tabelas de dias
// letivos (primeiro/último mês do semestre com contagem > 0) e tudo é conferido
// depois por simulação em validate.ts.

import { Campus, MonthTable, ParsedCalendar, SemesterAnchor } from './types';

const MESES: Record<string, number> = {
  JANEIRO: 1,
  FEVEREIRO: 2,
  MARÇO: 3,
  MARCO: 3,
  ABRIL: 4,
  MAIO: 5,
  JUNHO: 6,
  JULHO: 7,
  AGOSTO: 8,
  SETEMBRO: 9,
  OUTUBRO: 10,
  NOVEMBRO: 11,
  DEZEMBRO: 12,
};

const NOME_CAMPUS: [RegExp, Campus][] = [
  [/ararangu/i, 'ararangua'],
  [/blumenau/i, 'blumenau'],
  [/curitibanos/i, 'curitibanos'],
  [/florian/i, 'florianopolis'],
  [/joinville/i, 'joinville'],
];

export function campusPorNome(texto: string): Campus | null {
  for (const [re, campus] of NOME_CAMPUS) if (re.test(texto)) return campus;
  return null;
}

/** Normaliza o texto extraído: colapsa espaços, unifica travessões e remove espaços perdidos dentro de anos ("202 5"). */
export function normalizarTexto(texto: string): string[] {
  return texto
    .replace(/ /g, ' ')
    .replace(/[–—]/g, '–')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .map((l) => l.replace(/\b(20\d) (\d)\b/g, '$1$2').replace(/\b(20\d) (\d\.\d)\b/g, '$1$2'))
    .filter((l) => l.length > 0);
}

const RE_MES = /^([A-ZÇ]+) (\d{4})$/;
const RE_LINHA_CAMPUS = /^(ARA|BLU|CBN|FLN|JOI) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2})$/;
const RE_TOTAL_MES = /^Total de dias letivos (\d{4}\.[12])/;
const RE_DIA_ROTULO = /^(\d{1,2})(?: e (\d{1,2}))? ?– ?(.+)$/;
const RE_QUALIFICADOR = /\((Campus[^)]*)\)/i;

const RE_ANCORA =
  /^(\d{1,2}) (?:(Campus(?:-Sede)? de [A-Za-zÀ-ú]+) – )?(In[ií]cio|T[ée]rmino) do (primeiro|segundo) per[ií]odo letivo semestral de gradua[çc][ãa]o de (\d{4})(.*)$/i;
const RE_RECUPERACAO = /^(\d{1,2}) a (\d{1,2}) Per[ií]odo de recupera[çc][ãa]o/i;
const RE_RECESSO = /^(\d{1,2}) In[ií]cio do recesso escolar/i;
const RE_VESTIBULAR = /^(\d{1,2}) e (\d{1,2}) .*COPERVE.*Vestibular/i;
const RE_TOTAL_SEMESTRE = /^TOTAL DE DIAS LETIVOS NO (PRIMEIRO|SEGUNDO) SEMESTRE – (\d{4}\.[12])/i;
const RE_TOTAL_CAMPI = /^([A-Za-zÀ-ú ,]+?) – (\d{2,3})$/;
const RE_RESOLUCAO = /RESOLU[ÇC][ÃA]O(?: NORMATIVA)? N[ºo°.]?\s*(\d+\/[\w\d]+\/[\w\d]+)/i;

function campiExcecao(resto: string): Campus[] {
  const m = resto.match(/exceto (?:para )?(?:[oa]s? )?Camp(?:us|i)(?: de)? ?(.+)/i);
  if (!m) return [];
  const out: Campus[] = [];
  for (const parte of m[1].split(/,| e /)) {
    const c = campusPorNome(parte);
    if (c) out.push(c);
  }
  return out;
}

export function parseCalendario(texto: string, anoEsperado?: number): ParsedCalendar {
  const linhas = normalizarTexto(texto);
  const months: MonthTable[] = [];
  const anchors: SemesterAnchor[] = [];
  const recoveries: { day1: number; day2: number }[] = [];
  const recesses: number[] = [];
  const vestibular: number[][] = [];
  const declaredTotals: ParsedCalendar['declaredTotals'] = {};

  let mesAtual: MonthTable | null = null;
  // Estado dentro da caixinha do mês: 'grade' (antes das linhas de campi) → 'dias'
  // (feriados/dias não letivos) → 'totais' (a partir de "Total de dias letivos", pode
  // haver um bloco por semestre) → null.
  let estado: 'grade' | 'dias' | 'totais' | null = null;
  // Bloco "Total de dias letivos <sem>" em leitura: campi acumulados até achar "– NN".
  let grupoTotal: { semester: string; campi: string } | null = null;
  let resolution = '';

  for (let i = 0; i < linhas.length; i++) {
    let l = linhas[i];

    if (!resolution) {
      const r = l.match(RE_RESOLUCAO);
      if (r) resolution = `Resolução nº ${r[1]}`;
    }

    const mMes = l.match(RE_MES);
    if (mMes && MESES[mMes[1]] !== undefined) {
      mesAtual = {
        year: Number(mMes[2]),
        month: MESES[mMes[1]],
        semesters: [],
        monthTotals: {},
        campi: {},
        holidays: [],
        nonClassDays: [],
      };
      months.push(mesAtual);
      estado = 'grade';
      grupoTotal = null;
      continue;
    }

    // ---- eventos do fluxo (independem do mês corrente) ----
    const mAnc = l.match(RE_ANCORA);
    if (mAnc) {
      const [, dia, soCampus, tipo, ordinal, ano] = mAnc;
      let resto = mAnc[6];
      // "…, exceto para o Campus de" + quebra de linha + "Blumenau."
      if (/exceto/i.test(resto) && campiExcecao(resto).length === 0 && linhas[i + 1]) {
        resto = `${resto} ${linhas[i + 1]}`;
        i++;
      }
      anchors.push({
        ordinal: /primeiro/i.test(ordinal) ? 1 : 2,
        year: Number(ano),
        kind: /in[ií]cio/i.test(tipo) ? 'start' : 'end',
        day: Number(dia),
        onlyCampus: soCampus ? campusPorNome(soCampus) : null,
        exceptCampi: campiExcecao(resto),
      });
      continue;
    }
    const mRec = l.match(RE_RECUPERACAO);
    if (mRec) {
      recoveries.push({ day1: Number(mRec[1]), day2: Number(mRec[2]) });
      continue;
    }
    const mRes = l.match(RE_RECESSO);
    if (mRes) {
      recesses.push(Number(mRes[1]));
      continue;
    }
    const mVest = l.match(RE_VESTIBULAR);
    if (mVest) {
      vestibular.push([Number(mVest[1]), Number(mVest[2])]);
      continue;
    }
    const mTotSem = l.match(RE_TOTAL_SEMESTRE);
    if (mTotSem) {
      const sem = mTotSem[2];
      declaredTotals[sem] = declaredTotals[sem] ?? {};
      // Linhas seguintes: "Araranguá, Curitibanos, Florianópolis e Joinville – 101"
      let j = i + 1;
      while (j < linhas.length) {
        const mt = linhas[j].match(RE_TOTAL_CAMPI);
        if (!mt) break;
        for (const parte of mt[1].split(/,| e /)) {
          const c = campusPorNome(parte);
          if (c) declaredTotals[sem][c] = Number(mt[2]);
        }
        j++;
      }
      i = j - 1;
      continue;
    }

    if (!mesAtual) continue;

    // ---- caixinha do mês ----
    // A linha de um campus pode "vazar" para depois do "Total de dias letivos" (quebra de
    // página: JOI de julho/2026 sai na página seguinte), por isso é aceita em qualquer estado.
    const mCampus = l.match(RE_LINHA_CAMPUS);
    if (mCampus) {
      const sigla = mCampus[1];
      if (!(sigla in mesAtual.campi)) mesAtual.campi[sigla] = mCampus.slice(2, 8).map(Number);
      if (estado === 'grade') estado = 'dias';
      continue;
    }
    if (estado === 'grade') continue;

    const mTot = l.match(RE_TOTAL_MES);
    if (mTot) {
      if (!mesAtual.semesters.includes(mTot[1])) mesAtual.semesters.push(mTot[1]);
      mesAtual.monthTotals[mTot[1]] = mesAtual.monthTotals[mTot[1]] ?? {};
      estado = 'totais';
      grupoTotal = { semester: mTot[1], campi: '' };
      continue;
    }
    if (estado === 'totais') {
      // "Araranguá, Blumenau, Curitibanos" / "– 20" / "Florianópolis e Joinville – 19"
      const mNum = l.match(/^(.*?)\s*–\s*(\d{1,2})$/);
      const corpo = (mNum ? mNum[1] : l).trim();
      const soNomes = corpo === '' || corpo.split(/,| e /).every((x) => campusPorNome(x) !== null || x.trim() === '');
      if (grupoTotal && soNomes && (mNum || corpo !== '')) {
        grupoTotal.campi = `${grupoTotal.campi} ${corpo}`.trim();
        if (mNum) {
          for (const parte of grupoTotal.campi.split(/,| e /)) {
            const c = campusPorNome(parte);
            if (c) mesAtual.monthTotals[grupoTotal.semester][c] = Number(mNum[2]);
          }
          grupoTotal = { semester: grupoTotal.semester, campi: '' };
        }
        continue;
      }
      // Qualquer outra linha encerra a caixinha do mês.
      estado = null;
      grupoTotal = null;
      continue;
    }

    if (/^Feriados?$/i.test(l) || /^Dias? n[ãa]o letivos?$/i.test(l)) continue;

    const mDia = l.match(RE_DIA_ROTULO);
    if (!mDia) continue; // ex.: "(Lei nº 8.112 – art. 236)", "Total de dias…" já tratado

    const dias = [Number(mDia[1])];
    if (mDia[2]) dias.push(Number(mDia[2]));
    let label = mDia[3].trim();

    // Parêntese aberto e não fechado → continua na(s) linha(s) seguinte(s).
    let guarda = 0;
    while ((label.match(/\(/g) ?? []).length > (label.match(/\)/g) ?? []).length && linhas[i + 1] && guarda < 2) {
      label = `${label} ${linhas[i + 1]}`.replace(/- (?=[A-Za-zÀ-ú])/g, '-');
      i++;
      guarda++;
    }
    // Qualificador na linha seguinte: "(Campus de Joinville)"
    const prox = linhas[i + 1] ?? '';
    if (/^\(Campus/i.test(prox)) {
      let q = prox;
      let k = i + 1;
      while (!q.includes(')') && linhas[k + 1] && k - i < 3) {
        k++;
        q = `${q} ${linhas[k]}`;
      }
      label = `${label} ${q}`;
      i = k;
    } else if (
      prox &&
      !RE_DIA_ROTULO.test(prox) &&
      !/^(Dias? n[ãa]o letivos?|Total de dias letivos|Feriados?)/i.test(prox) &&
      !RE_MES.test(prox) &&
      !/^\d/.test(prox) &&
      !/^\(/.test(prox) &&
      !RE_LINHA_CAMPUS.test(prox) &&
      prox.length < 40
    ) {
      // Rótulo em duas linhas ("Dia Nacional de Zumbi e da" / "Consciência Negra")
      label = `${label} ${prox}`;
      i++;
    }

    let campus: Campus | null = null;
    const mQual = label.match(RE_QUALIFICADOR);
    if (mQual) {
      campus = campusPorNome(mQual[1]);
      label = label.replace(RE_QUALIFICADOR, '').replace(/\s+/g, ' ').trim();
    }
    label = label.replace(/\s*–\s*$/, '').trim();

    // O rótulo é a única fonte confiável (em 2024 os feriados aparecem sob "Dias não letivos").
    const naoLetivo = /n[ãa]o letivo/i.test(label);
    for (const day of dias) {
      if (naoLetivo) mesAtual.nonClassDays.push({ day, label });
      else mesAtual.holidays.push({ day, label, campus });
    }
  }

  const year =
    anoEsperado ??
    months.find((m) => m.semesters.length > 0)?.year ??
    (() => {
      throw new Error('Não foi possível determinar o ano do calendário');
    })();

  return { year, resolution, months, anchors, recoveries, recesses, vestibular, declaredTotals };
}
