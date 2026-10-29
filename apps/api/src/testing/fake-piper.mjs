#!/usr/bin/env node
/**
 * A stand-in for the `piper` program in tests: reads text on stdin and writes a tiny but valid WAV to stdout,
 * one sample per character, so the length of the recording follows the length of the text.
 */
let text = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) text += chunk;

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
process.stdout.write(Buffer.concat([header, data]));
