# calendario-ufsc

Transforma o **Calendário Acadêmico de Graduação da UFSC** (PDF anual do DAE, Resolução do
CUn) em dados estruturados por **semestre × campus** e publica na tabela `academic_calendars`
do Supabase, que o app [Nossa UFSC](https://github.com/nossa-ufsc/mobile) usa para montar o
calendário de aulas (início/término reais, feriados e dias não letivos, dias letivos por dia da
semana para o limite de faltas).

Não existe API/ICS oficial: a única fonte é o PDF listado em
<https://dae.ufsc.br/calendario-academico-de-graduacao/> (o mais recente do ano é o primeiro
da lista — o calendário é alterado no meio do ano com alguma frequência).

## Como roda

GitHub Actions, toda segunda (`.github/workflows/calendario.yml`) ou manualmente
(`workflow_dispatch`, com opção `dry_run` e `year`):

1. lê a listagem do DAE e baixa o PDF mais recente do ano corrente (+ o próximo, se publicado);
2. extrai o texto com `unpdf` e parseia (`src/lib/parse.ts`) — cabeçalhos de mês, tabelas
   "DIAS LETIVOS" (ARA/BLU/CBN/FLN/JOI × seg..sáb), feriados/dias não letivos com
   qualificador de campus, âncoras "Início/Término do período letivo semestral de graduação"
   (inclusive por campus / "exceto para o Campus de …"), recuperação, recesso, vestibular;
3. monta um registro por semestre × campus (`src/lib/build.ts`);
4. **valida por simulação** (`src/lib/validate.ts`): percorre início→término pulando domingos,
   feriados do campus e dias não letivos e exige reproduzir EXATAMENTE a tabela do PDF por
   mês × dia da semana, além do total declarado do semestre. Parse ruim falha o job e nada é
   publicado;
5. upsert via Edge Function `events-admin` (ação `calendar-upsert`, `PIPELINE_TOKEN`) e commit
   do snapshot `data/calendario-<ano>.json` (deploy key SSH = keep-alive dos workflows).

## Contrato (`SemesterCalendar`)

```ts
{
  semester: '2026.1', campus: 'florianopolis',
  startDate: '2026-03-09', endDate: '2026-07-15', weeks: 19,
  recoveryStart: '2026-07-09', recoveryEnd: '2026-07-15', recessStart: '2026-07-16',
  classDaysByWeekday: [17, 18, 19, 17, 15, 15], // seg..sáb
  totalClassDays: 101,
  holidays: [{ date: '2026-03-23', label: 'Aniversário da Cidade' }, …],   // só os do campus
  nonClassDays: [{ date: '2026-04-04', label: 'Dias não letivos' }, …],
  source: { resolution: 'Resolução nº 214/2025/CUn', url, sha256, year: 2026, fetchedAt }
}
```

## Local

```bash
bun install
bun src/index.ts --dry-run                 # listagem do DAE → PDF → parse → validação
bun src/index.ts --pdf caminho.pdf --year 2026 --skip-db
bun test
```

Variáveis para publicar: `EVENTS_ADMIN_URL`, `EVENTS_ADMIN_TOKEN` (secrets do repo).

## Pegadinhas conhecidas

- O texto quebra linhas em lugares ruins ("exceto para o Campus de" ↵ "Blumenau", "(Campus"
  ↵ "de Joinville)", a linha JOI de julho/2026 sai na página seguinte) — o parser é tolerante
  e a simulação pega o que escapar.
- 2024 não tem o cabeçalho "Feriados" (tudo sob "Dias não letivos"); classificação pelo rótulo.
- O sábado do vestibular às vezes conta como dia letivo (2025) e às vezes não (2026); o pipeline
  tenta as duas interpretações e fica com a que reproduz a tabela.
- A tabela "Previsão para os semestres letivos de <ano+1>" na última página NÃO é usada (a
  previsão de 2025 para 2026.1 errou o início em uma semana).
