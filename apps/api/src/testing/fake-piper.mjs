#!/usr/bin/env node
/**
 * A stand-in for the `piper` program in tests: reads text on stdin and writes a tiny but valid WAV to the file
 * named by `--output_file`, one sample per character, so the length of the recording follows the length of the
 * text. Like Piper 1.x on Windows, it cannot write to stdout (`-`), and it reads stdin as UTF-8 only in Python's
 * UTF-8 mode.
 */
import { writeFileSync } from 'node:fs';

const at = process.argv.indexOf('--output_file');
const target = at > 0 ? process.argv[at + 1] : undefined;
let text = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) text += chunk;

if (!target || target === '-') {
  process.stderr.write('PermissionError: cannot write a WAV to stdout');
  process.exit(1);
}

if (process.env.PYTHONUTF8 !== '1') {
  process.stderr.write("UnicodeEncodeError: 'utf-8' codec can't encode character '\\udc81': surrogates not allowed");
  process.exit(1);
}

if (process.env.FAKE_PIPER_FAIL) {
  process.stderr.write('fake piper was told to fail');
  process.exit(1);
}

const RATE = 22_050;
const samples = Math.max(1, text.trim().length);
const data = Buffer.alloc(samples * 2); // silence: 16-bit mono
const header = Buffer.alloc(44);
header.write('RIFF', 0, 'latin1');
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8, 'latin1');
header.writeUInt32LE(16, 16); // fmt chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // channels
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36, 'latin1');
header.writeUInt32LE(data.length, 40);
writeFileSync(target, Buffer.concat([header, data]));
