// CLI: bun src/index.ts [--year 2026] [--pdf caminho.pdf] [--dry-run] [--skip-db] [--all-years]
//
// Fluxo padrão (sem --pdf): lê a listagem do DAE, pega o PDF mais recente do ano
// corrente (e do próximo, se já publicado), extrai o texto, parseia, valida por
// simulação e faz upsert via Edge Function. Também grava data/calendario-<ano>.json
// (snapshot versionado, útil para diff quando o calendário é alterado).

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { adminConfigDoAmbiente, upsertCalendarios } from './lib/admin';
import { listarCalendarios } from './lib/dae';
import { fetchBinary } from './lib/http';
import { extrairTexto } from './lib/pdf';
import { processarTexto } from './lib/pipeline';
import { SemesterCalendar, SourceInfo } from './lib/types';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dryRun = flag('--dry-run');
const skipDb = flag('--skip-db');
const pdfLocal = opt('--pdf');
const anoOpt = opt('--year');
const todosAnos = flag('--all-years');
const fetchedAt = new Date().toISOString();

interface Alvo {
  year: number;
  url: string;
  titulo: string;
  buf: Uint8Array;
}

async function resolverAlvos(): Promise<Alvo[]> {
  if (pdfLocal) {
    const year = Number(anoOpt ?? pdfLocal.match(/(20\d{2})/)?.[1]);
    if (!year) throw new Error('--pdf exige --year (ou o ano no nome do arquivo)');
    const buf = new Uint8Array(await Bun.file(pdfLocal).arrayBuffer());
    return [{ year, url: `file://${pdfLocal}`, titulo: `arquivo local ${pdfLocal}`, buf }];
  }
  const lista = await listarCalendarios();
  const anoAtual = new Date().getUTCFullYear();
  const anosQueremos = anoOpt
    ? [Number(anoOpt)]
    : todosAnos
      ? lista.map((l) => l.year)
      : [anoAtual, anoAtual + 1];
  const alvos: Alvo[] = [];
  for (const year of anosQueremos) {
    const item = lista.find((l) => l.year === year);
    if (!item) {
      console.log(`ℹ Calendário ${year} ainda não publicado no DAE.`);
      continue;
    }
    console.log(`→ ${year}: ${item.titulo}\n  ${item.url}`);
    alvos.push({ ...item, buf: await fetchBinary(item.url) });
  }
  return alvos;
}

async function main() {
  const alvos = await resolverAlvos();
  if (alvos.length === 0) throw new Error('Nenhum calendário para processar');

  const admin = adminConfigDoAmbiente();
  if (!dryRun && !skipDb && !admin) {
    throw new Error('EVENTS_ADMIN_URL/EVENTS_ADMIN_TOKEN ausentes (use --dry-run ou --skip-db)');
  }

  let falhas = 0;
  const publicados: SemesterCalendar[] = [];
  for (const alvo of alvos) {
    const sha256 = createHash('sha256').update(alvo.buf).digest('hex');
    const texto = await extrairTexto(alvo.buf);
    const sourceBase: SourceInfo = { resolution: '', url: alvo.url, sha256, year: alvo.year, fetchedAt };
    const r = processarTexto(texto, sourceBase);
    const calendars = r.calendars.map((c) => ({
      ...c,
      source: { ...c.source, resolution: r.parsed.resolution },
    }));

    console.log(`\n== ${alvo.year} — ${r.parsed.resolution || '(resolução não identificada)'} — variante: ${r.variante} — sha256 ${sha256.slice(0, 12)}`);
    for (const c of calendars) {
      console.log(
        `  ${c.semester} ${c.campus.padEnd(13)} ${c.startDate} → ${c.endDate}  ${String(c.weeks).padStart(2)} sem  seg..sáb [${c.classDaysByWeekday.join(' ')}] = ${c.totalClassDays}  feriados ${c.holidays.length}  não letivos ${c.nonClassDays.length}`
      );
    }
    if (r.problemas.length > 0) {
      falhas++;
      console.error(`✗ ${alvo.year}: ${r.problemas.length} problema(s) de validação — NÃO será publicado:`);
      for (const p of r.problemas) console.error(`   - [${p.where}] ${p.message}`);
      continue;
    }
    console.log(`✓ ${alvo.year}: validação por simulação OK (${calendars.length} registros)`);

    if (!dryRun) {
      await mkdir('data', { recursive: true });
      await writeFile(`data/calendario-${alvo.year}.json`, JSON.stringify(calendars, null, 2) + '\n');
      console.log(`  snapshot: data/calendario-${alvo.year}.json`);
    }
    publicados.push(...calendars);
  }

  if (publicados.length > 0 && !dryRun && !skipDb && admin) {
    const res = await upsertCalendarios(admin, publicados);
    console.log(`\n✓ Supabase: ${res.upserted ?? publicados.length} registro(s) upsertados via events-admin`);
  } else if (publicados.length > 0) {
    console.log(`\n(${dryRun ? '--dry-run' : '--skip-db'}: nada enviado ao Supabase)`);
  }

  if (falhas > 0) {
    console.error(`\n${falhas} calendário(s) falharam na validação.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
