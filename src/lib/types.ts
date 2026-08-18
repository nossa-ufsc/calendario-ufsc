// Contrato de saída do pipeline (o mesmo JSON vai para data/calendario.json e,
// via Edge Function, para a tabela `academic_calendars` do Supabase).

export type Campus = 'ararangua' | 'blumenau' | 'curitibanos' | 'florianopolis' | 'joinville';

export const CAMPI: Campus[] = ['ararangua', 'blumenau', 'curitibanos', 'florianopolis', 'joinville'];

/** Sigla usada nas tabelas "DIAS LETIVOS" do PDF → chave do app. */
export const SIGLA_CAMPUS: Record<string, Campus> = {
  ARA: 'ararangua',
  BLU: 'blumenau',
  CBN: 'curitibanos',
  FLN: 'florianopolis',
  JOI: 'joinville',
};

export interface DatedLabel {
  /** YYYY-MM-DD */
  date: string;
  label: string;
}

export interface SemesterCalendar {
  /** Ex.: "2026.1" */
  semester: string;
  campus: Campus;
  /** YYYY-MM-DD — primeiro dia letivo (Início do período letivo semestral de graduação). */
  startDate: string;
  /** YYYY-MM-DD — último dia letivo (Término do período letivo semestral de graduação). */
  endDate: string;
  /** Semanas de calendário cobertas (segunda-feira da semana de início até endDate). */
  weeks: number;
  recoveryStart: string | null;
  recoveryEnd: string | null;
  /** YYYY-MM-DD — primeiro dia do recesso (término + 1 quando não declarado para o campus). */
  recessStart: string;
  /** Dias letivos por dia da semana, seg..sáb (6 posições), somados no semestre. */
  classDaysByWeekday: number[];
  totalClassDays: number;
  /** Feriados que valem para ESTE campus (nacionais + do campus), dentro do semestre. */
  holidays: DatedLabel[];
  /** "Dias não letivos" declarados pelo calendário, dentro do semestre. */
  nonClassDays: DatedLabel[];
  source: SourceInfo;
}

export interface SourceInfo {
  /** Ex.: "Resolução nº 214/2025/CUn" */
  resolution: string;
  url: string;
  sha256: string;
  /** Ano do calendário (o PDF é anual). */
  year: number;
  /** ISO datetime da execução do pipeline. */
  fetchedAt: string;
}

// ---- Estruturas intermediárias do parser ----

export interface MonthTable {
  year: number;
  month: number; // 1-12
  /**
   * Semestres aos quais o mês pertence ("Total de dias letivos 2026.1"). Normalmente
   * um; em anos atípicos (greve de 2024) agosto pertence a 2024.1 E 2024.2, com uma
   * única tabela de dias letivos somando os dois.
   */
  semesters: string[];
  /** Total de dias letivos do mês declarado por semestre e campus (linhas "Florianópolis e Joinville – 19"). */
  monthTotals: Record<string, Partial<Record<Campus, number>>>;
  /** sigla → contagens seg..sáb */
  campi: Record<string, number[]>;
  holidays: { day: number; label: string; campus: Campus | null }[];
  nonClassDays: { day: number; label: string }[];
}

export interface SemesterAnchor {
  /** 'primeiro' | 'segundo' */
  ordinal: 1 | 2;
  year: number;
  kind: 'start' | 'end';
  day: number;
  /** Se a linha se refere a um único campus ("Campus de Blumenau – Início…"). */
  onlyCampus: Campus | null;
  /** Se a linha exclui campi ("…, exceto para o Campus de Blumenau"). */
  exceptCampi: Campus[];
}

export interface ParsedCalendar {
  year: number;
  resolution: string;
  months: MonthTable[];
  anchors: SemesterAnchor[];
  recoveries: { day1: number; day2: number }[];
  recesses: number[];
  /** Dias do vestibular ("NN e NN COPERVE – Período reservado ao Vestibular"), por ocorrência. */
  vestibular: number[][];
  /** Totais declarados: "TOTAL DE DIAS LETIVOS NO PRIMEIRO SEMESTRE – 2026.1" + linhas de campi. */
  declaredTotals: Record<string, Partial<Record<Campus, number>>>;
}
