// Orquestra parse → montagem → validação para um PDF, tentando as variantes de
// interpretação ambíguas (vestibular) até a simulação bater com as tabelas do PDF.

import { montarCalendarios } from './build';
import { parseCalendario } from './parse';
import { ParsedCalendar, SemesterCalendar, SourceInfo } from './types';
import { Problema, validar } from './validate';

export interface ResultadoPipeline {
  parsed: ParsedCalendar;
  calendars: SemesterCalendar[];
  problemas: Problema[];
  variante: string;
}

export function processarTexto(texto: string, source: SourceInfo): ResultadoPipeline {
  const parsed = parseCalendario(texto, source.year);
  const variantes: { nome: string; vestibularNaoLetivo: boolean }[] = [
    { nome: 'padrão', vestibularNaoLetivo: false },
    { nome: 'vestibular como dia não letivo', vestibularNaoLetivo: true },
  ];
  let melhor: ResultadoPipeline | null = null;
  for (const v of variantes) {
    let calendars: SemesterCalendar[] = [];
    let problemas: Problema[];
    try {
      calendars = montarCalendarios(parsed, source, { vestibularNaoLetivo: v.vestibularNaoLetivo });
      problemas = validar(parsed, calendars);
    } catch (e) {
      problemas = [{ where: 'geral', message: (e as Error).message }];
    }
    const r = { parsed, calendars, problemas, variante: v.nome };
    if (problemas.length === 0) return r;
    if (!melhor || problemas.length < melhor.problemas.length) melhor = r;
  }
  return melhor!;
}
