/**
 * pnpm pdf:inspect <file.pdf> [--pages 10-20] [--html out.html] [--json out.json]
 * Prints detected blocks (type, font size, page, first 80 chars), the structure and the report.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractPdf } from '../extract';
import { inspectHtml } from '../inspect-html';
import { analyze } from '../pipeline';

function parsePages(spec: string | undefined): number[] | undefined {
  if (!spec) return undefined;
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((n) => Number.parseInt(n, 10));
    if (!a) continue;
    for (let p = a; p <= (b ?? a); p++) out.push(p - 1);
  }
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  // pnpm runs package scripts in the package folder; INIT_CWD is where the user typed the command.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const file = process.argv.slice(2).find((a) => a.endsWith('.pdf'));
  if (!file) {
    console.error('usage: pnpm pdf:inspect <file.pdf> [--pages 10-20] [--html out.html] [--json out.json]');
    process.exit(2);
  }
  const path = resolve(cwd, file);
  const data = new Uint8Array(readFileSync(path));
  const pages = parsePages(arg('--pages'));
  const started = Date.now();
  const ex = await extractPdf(data, {
    ...(pages ? { pages } : {}),
    onPage: (d, t) => process.stderr.write(`\rextracting ${d}/${t}`),
  });
  process.stderr.write('\n');
  const result = analyze(ex);

  for (const b of result.blocks) {
    const text = b.text.replace(/\s+/g, ' ').slice(0, 80);
    console.log(
      `p${String(b.page + 1).padStart(4)}${b.pageEnd !== b.page ? `-${b.pageEnd + 1}` : ''}  ${b.type.padEnd(9)} ${b.size.toFixed(1).padStart(5)}${b.bold ? 'b' : ' '}${b.merged ? ` +${b.merged}` : ''}  ${text}`,
    );
  }
  console.log('\n— structure —');
  for (const n of result.nodes) {
    const heading = n.headingIndex !== undefined ? result.segments[n.headingIndex]?.src : n.title;
    console.log(
      `${'  '.repeat(n.depth)}${n.kind}${n.numberLabel ? ` ${n.numberLabel}` : ''}${n.skip ? ' [skip]' : ''}: ${heading} (p${n.pageStart + 1}–${n.pageEnd + 1})`,
    );
  }
  console.log('\n— report —');
  console.log(JSON.stringify(result.report, null, 2));
  console.log(`\n${((Date.now() - started) / 1000).toFixed(1)} s`);

  const html = arg('--html');
  if (html) {
    writeFileSync(resolve(cwd, html), inspectHtml(data, ex, result.blocks));
    console.log(`HTML overlay written to ${html}`);
  }
  const json = arg('--json');
  if (json) {
    const { blocks: _b, ...rest } = result;
    writeFileSync(resolve(cwd, json), JSON.stringify(rest, null, 2));
  }
}

void main();
