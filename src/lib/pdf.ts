import { extractText, getDocumentProxy } from 'unpdf';

/** Texto corrido do PDF (páginas mescladas). pdf.js desanexa o buffer → clonar. */
export async function extrairTexto(buf: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(buf.slice());
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
