import { describe, expect, test } from 'bun:test';
import { extrairListagem } from '../src/lib/dae';
import { extrairTexto } from '../src/lib/pdf';
import { processarTexto } from '../src/lib/pipeline';
import { SemesterCalendar, SourceInfo } from '../src/lib/types';

const src = (year: number): SourceInfo => ({ resolution: '', url: 'fixture', sha256: '', year, fetchedAt: '' });
const texto = (year: number) => Bun.file(`${import.meta.dir}/fixtures/calendario-${year}.txt`).text();
const pick = (cals: SemesterCalendar[], semester: string, campus: string) =>
  cals.find((c) => c.semester === semester && c.campus === campus)!;

describe('listagem do DAE', () => {
  test('encontra o PDF mais recente de cada ano', async () => {
    const html = await Bun.file(`${import.meta.dir}/fixtures/dae-listagem.html`).text();
    const lista = extrairListagem(html);
    const anos = lista.map((l) => l.year);
    expect(anos[0]).toBe(2026);
    expect(anos).toContain(2025);
    expect(anos).toContain(2014);
    expect(new Set(anos).size).toBe(anos.length);
    expect(lista[0].url).toMatch(/R214-CUn-2025.*2026\.pdf$/);
    // 2025 teve 3 versões; a primeira listada (mais recente) é a com as duas alterações homologadas
    expect(lista.find((l) => l.year === 2025)!.url).toMatch(/R-206-CUn-2025/);
    // Suplementares excepcionais (pandemia) e "Campus Blumenau 2015" ficam de fora
    expect(lista.filter((l) => l.year === 2015)).toHaveLength(1);
    expect(lista.find((l) => l.year === 2015)!.titulo).not.toMatch(/Blumenau/);
  });
});

describe('calendário 2026', () => {
  test('parseia, valida por simulação e reproduz os totais do PDF', async () => {
    const r = processarTexto(await texto(2026), src(2026));
    expect(r.problemas).toEqual([]);
    expect(r.parsed.resolution).toBe('Resolução nº 214/2025/CUn');
    expect(r.calendars).toHaveLength(10);

    const fln1 = pick(r.calendars, '2026.1', 'florianopolis');
    expect(fln1.startDate).toBe('2026-03-09');
    expect(fln1.endDate).toBe('2026-07-15');
    expect(fln1.weeks).toBe(19);
    expect(fln1.classDaysByWeekday).toEqual([17, 18, 19, 17, 15, 15]);
    expect(fln1.totalClassDays).toBe(101);
    expect(fln1.recoveryStart).toBe('2026-07-09');
    expect(fln1.recoveryEnd).toBe('2026-07-15');
    expect(fln1.recessStart).toBe('2026-07-16');
    expect(fln1.holidays.map((h) => h.date)).toEqual([
      '2026-03-23', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04',
    ]);
    expect(fln1.holidays[0].label).toBe('Aniversário da Cidade');
    expect(fln1.nonClassDays.map((h) => h.date)).toEqual([
      '2026-04-04', '2026-04-20', '2026-05-02', '2026-06-05', '2026-06-06',
    ]);

    // Feriados municipais só valem para o próprio campus
    expect(pick(r.calendars, '2026.1', 'joinville').holidays.map((h) => h.date)).toContain('2026-03-09');
    expect(pick(r.calendars, '2026.1', 'blumenau').holidays.map((h) => h.date)).not.toContain('2026-03-23');
    expect(pick(r.calendars, '2026.1', 'blumenau').totalClassDays).toBe(102);
    expect(pick(r.calendars, '2026.1', 'curitibanos').classDaysByWeekday[3]).toBe(16); // 11/06 quinta

    const fln2 = pick(r.calendars, '2026.2', 'florianopolis');
    expect(fln2.startDate).toBe('2026-08-10');
    expect(fln2.endDate).toBe('2026-12-12');
    expect(fln2.weeks).toBe(18);
    expect(fln2.classDaysByWeekday).toEqual([15, 18, 17, 18, 17, 16]);
    // Sábado do vestibular (05/12) não conta como dia letivo na tabela → vira dia não letivo
    expect(fln2.nonClassDays.map((h) => `${h.date} ${h.label}`)).toEqual([
      '2026-11-21 Dia não letivo',
      '2026-12-05 Vestibular UFSC',
    ]);
    expect(r.variante).toBe('vestibular como dia não letivo');
    expect(pick(r.calendars, '2026.2', 'blumenau').totalClassDays).toBe(100);
  });
});

describe('calendário 2025 (com alterações homologadas)', () => {
  test('Blumenau tem início/término próprios no 2º semestre', async () => {
    const r = processarTexto(await texto(2025), src(2025));
    expect(r.problemas).toEqual([]);
    expect(r.variante).toBe('padrão');
    const fln = pick(r.calendars, '2025.2', 'florianopolis');
    const blu = pick(r.calendars, '2025.2', 'blumenau');
    expect(fln.startDate).toBe('2025-08-11');
    expect(fln.endDate).toBe('2025-12-13');
    expect(fln.recessStart).toBe('2025-12-14');
    expect(blu.startDate).toBe('2025-08-18');
    expect(blu.endDate).toBe('2025-12-20');
    expect(blu.recessStart).toBe('2025-12-21');
    expect(blu.totalClassDays).toBe(102);
    expect(fln.totalClassDays).toBe(103);
    expect(pick(r.calendars, '2025.1', 'florianopolis').startDate).toBe('2025-03-10');
    expect(pick(r.calendars, '2025.1', 'florianopolis').endDate).toBe('2025-07-16');
  });
});

describe('calendário 2024 (sem cabeçalho "Feriados", qualificador de campus quebrado)', () => {
  test('versão original (R183/2023)', async () => {
    const t = await Bun.file(`${import.meta.dir}/fixtures/calendario-2024-r183.txt`).text();
    const r = processarTexto(t, src(2024));
    expect(r.problemas).toEqual([]);
    expect(r.parsed.resolution).toBe('Resolução nº 183/2023/CUn');
    const fln1 = pick(r.calendars, '2024.1', 'florianopolis');
    expect(fln1.startDate).toBe('2024-03-11');
    expect(fln1.endDate).toBe('2024-07-13');
    expect(fln1.holidays.map((h) => h.date)).toContain('2024-03-23');
    expect(pick(r.calendars, '2024.1', 'joinville').holidays.map((h) => h.date)).not.toContain('2024-03-23');
    expect(pick(r.calendars, '2024.2', 'florianopolis').endDate).toBe('2024-12-06');
    expect(pick(r.calendars, '2024.2', 'blumenau').holidays.map((h) => h.date)).toContain('2024-09-02');
  });

  test('versão pós-greve (R192/2024): agosto pertence aos dois semestres', async () => {
    const r = processarTexto(await texto(2024), src(2024));
    expect(r.problemas).toEqual([]);
    expect(r.parsed.resolution).toBe('Resolução nº 192/2024/CUn');
    const fln1 = pick(r.calendars, '2024.1', 'florianopolis');
    const fln2 = pick(r.calendars, '2024.2', 'florianopolis');
    expect(fln1.startDate).toBe('2024-03-11');
    expect(fln1.endDate).toBe('2024-08-17');
    expect(fln1.weeks).toBe(23);
    expect(fln1.totalClassDays).toBe(131);
    expect(fln1.recessStart).toBe('2024-08-18');
    expect(fln2.startDate).toBe('2024-08-26');
    expect(fln2.endDate).toBe('2024-12-21');
    expect(fln2.totalClassDays).toBe(95);
    // agosto: tabela do PDF [3 3 3 4 4 4] = 15 (2024.1) + 6 (2024.2), repartidos por simulação
    const ago1 = fln1.classDaysByWeekday.reduce((a, b) => a + b, 0);
    expect(ago1).toBe(131);
    expect(pick(r.calendars, '2024.2', 'blumenau').totalClassDays).toBe(94);
    expect(pick(r.calendars, '2024.1', 'ararangua').totalClassDays).toBe(130);
  });
});

describe('extração do PDF real', () => {
  test('o PDF de 2026 gera o mesmo resultado que a fixture de texto', async () => {
    const buf = new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/calendario-2026.pdf`).arrayBuffer());
    const r = processarTexto(await extrairTexto(buf), src(2026));
    expect(r.problemas).toEqual([]);
    expect(pick(r.calendars, '2026.1', 'florianopolis').startDate).toBe('2026-03-09');
  });
});

describe('robustez', () => {
  test('texto sem semestres falha com problema, não com exceção', () => {
    const r = processarTexto('nada a ver', src(2026));
    expect(r.problemas.length).toBeGreaterThan(0);
    expect(r.calendars).toEqual([]);
  });
  test('tabela adulterada é pega pela simulação', async () => {
    const t = (await texto(2026)).replace('FLN 03 04 03 03 03 03', 'FLN 03 04 03 03 03 04');
    const r = processarTexto(t, src(2026));
    expect(r.problemas.some((p) => p.where === '2026.1/florianopolis' && /simulação/.test(p.message))).toBe(true);
  });
});
