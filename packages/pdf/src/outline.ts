import { openPdf } from './extract';

/**
 * The outline (bookmarks) of a printed PDF, flattened in document order, with the page each entry points to
 * (ADR-046). The book PDF is printed once, and the pages its headings and figure anchors landed on become the numbers
 * of its table of contents in the second print. Pages are numbered from 1, as a reader counts them.
 */
export async function outlinePages(
  data: Uint8Array,
): Promise<{ pages: number; entries: { title: string; page: number }[] }> {
  // pdf.js refuses a Node Buffer (what a browser's print hands back); a copy is a plain Uint8Array.
  const task = openPdf(Buffer.isBuffer(data) ? new Uint8Array(data) : data);
  try {
    const pdf = await task.promise;
    const entries: { title: string; page: number }[] = [];
    type Item = { title: string; dest: unknown; items?: Item[] };
    const visit = async (items: Item[]) => {
      for (const item of items) {
        let page = 0;
        try {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          const ref = Array.isArray(dest) ? dest[0] : undefined;
          if (typeof ref === 'number') page = ref + 1;
          else if (ref) page = (await pdf.getPageIndex(ref as { num: number; gen: number })) + 1;
        } catch {
          page = 0;
        }
        entries.push({ title: item.title, page });
        if (item.items?.length) await visit(item.items);
      }
    };
    await visit(((await pdf.getOutline()) ?? []) as Item[]);
    return { pages: pdf.numPages, entries };
  } finally {
    await task.destroy();
  }
}
