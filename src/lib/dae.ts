// Descobre o PDF do Calendário Acadêmico de Graduação de cada ano na página do DAE.
//
// A página lista, em ordem cronológica inversa, um <a> por versão do calendário:
//   "Calendário Acadêmico de Graduação 2026 – Resolução nº 214/2025/CUn de 28 de outubro de 2025."
//   "Calendário Acadêmico de Graduação 2025 – Resolução nº 196/2024/CUn …, com alterações homologadas …"
// Um mesmo ano pode ter várias versões (o calendário é alterado no meio do ano); a
// PRIMEIRA ocorrência do ano é a mais recente.

import * as cheerio from 'cheerio';
import { fetchHtml } from './http';

export const DAE_URL = 'https://dae.ufsc.br/calendario-academico-de-graduacao/';

export interface CalendarioListado {
  year: number;
  url: string;
  /** Texto do item da lista (contém a resolução e eventuais alterações). */
  titulo: string;
}

export function extrairListagem(html: string, baseUrl = DAE_URL): CalendarioListado[] {
  const $ = cheerio.load(html);
  const vistos = new Set<number>();
  const out: CalendarioListado[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!/\.pdf(\?|$)/i.test(href)) return;
    // Texto do <li>/<p> que contém o link, para pegar "…de Graduação 2026 – Resolução…"
    const container = $(el).closest('li, p');
    const texto = (container.length ? container.text() : $(el).text()).replace(/\s+/g, ' ').trim();
    const m = texto.match(/Calend[áa]rio Acad[êe]mico(?: de Gradua[çc][ãa]o)? (\d{4})/i);
    if (!m) return;
    // Calendários "Suplementar Excepcional" (pandemia) e de campus específico não interessam.
    if (/Suplementar|Excepcional|Campus/i.test(texto)) return;
    const year = Number(m[1]);
    if (vistos.has(year)) return;
    vistos.add(year);
    out.push({ year, url: new URL(href, baseUrl).toString(), titulo: texto });
  });
  return out.sort((a, b) => b.year - a.year);
}

export async function listarCalendarios(): Promise<CalendarioListado[]> {
  const html = await fetchHtml(DAE_URL);
  const lista = extrairListagem(html);
  if (lista.length === 0) throw new Error(`Nenhum calendário encontrado em ${DAE_URL} (layout mudou?)`);
  return lista;
}
