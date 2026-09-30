// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fa from './i18n/fa.json';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function files(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : files(path, exts);
    return exts.some((e) => name.endsWith(e)) && !name.includes('.test.') ? [path] : [];
  });
}

const sources = files(SRC, ['.ts', '.tsx']);

/** Code without comments (comments may quote Persian UI terms); keeps line numbers stable. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))
    .replace(/(^|[\s;{}(])\/\/.*$/gm, '$1');
}

describe('project guards', () => {
  it('has no Persian/Arabic-script literals in components (all UI strings via i18n)', () => {
    const offenders = sources.flatMap((f) =>
      code(f)
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /[\u{0600}-\u{06FF}\u{FB50}-\u{FDFF}\u{FE70}-\u{FEFF}]/u.test(line))
        .map(({ i }) => `${relative(SRC, f)}:${i + 1}`),
    );
    expect(offenders).toEqual([]);
  });

  it('uses logical CSS only — no physical left/right utilities or properties (SPEC §3.1)', () => {
    const physicalClass =
      /(?<![\w-])(?:-?m[lr]|p[lr]|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|text-left|text-right|float-left|float-right)-/;
    const physicalCss =
      /(?:margin|padding|border)-(?:left|right)\s*:|(?<![\w-])(?:left|right)\s*:|text-align:\s*(?:left|right)/;
    const offenders = [...sources, ...files(join(SRC, 'styles'), ['.css'])].flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => physicalClass.test(line) || physicalCss.test(line))
        .map(({ i, line }) => `${relative(SRC, f)}:${i + 1}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps every i18n value a non-empty string', () => {
    const walk = (o: unknown, path: string): string[] => {
      if (typeof o === 'string') return o.trim() ? [] : [path];
      if (Array.isArray(o)) return o.flatMap((v, i) => walk(v, `${path}[${i}]`));
      if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => walk(v, path ? `${path}.${k}` : k));
      return [path];
    };
    expect(walk(fa, '')).toEqual([]);
  });

  it('references only i18n keys that exist', () => {
    const keys = new Set<string>();
    const collect = (o: unknown, path: string) => {
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const [k, v] of Object.entries(o)) collect(v, path ? `${path}.${k}` : k);
      } else keys.add(path);
    };
    collect(fa, '');
    const missing = sources.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)]
        .map((m) => m[1] as string)
        .filter((k) => !keys.has(k))
        .map((k) => `${relative(SRC, f)}: ${k}`),
    );
    expect(missing).toEqual([]);
  });
});
