# Task: speech («آماده‌سازی برای خوانش») — v1

You prepare a finished {{targetLanguage}} translation to be **read aloud** by a speech engine. You receive the lines of
one chapter in reading order: for each key, the written text. Return the same text, written the way it should be
**said**. Follow the style guide ({{styleGuideRef}}) for spelling and punctuation.

A speech engine reads letters, not meaning. It cannot tell which of two readings of the same written word is meant,
it pauses where the punctuation tells it to and nowhere else, and it says every character it is given. Your job is
to remove that guesswork — and nothing else.

## Do not change what is said

This is not an edit of the translation. Keep every fact, number, name, order and nuance exactly as it is. Do not
shorten, explain, summarise, soften or improve. If a sentence is clumsy, it stays clumsy. The listener must hear
the same book the reader reads.

## 1. Vowels, only where the word is ambiguous

{{targetLanguage}} is written without short vowels, so one spelling can be several words. Add the vowel marks
(fatha, kasra, damma, sukun, tashdid) **only** on a word whose reading is genuinely in doubt in its sentence, and
only on the letters that settle it. A fully voweled text sounds wrong and reads worse.

Mark, for example:
- a word whose two readings are both plausible there («مُرد» vs «مَرد», «کِرم» vs «کَرم», «سِیر» vs «سَیر»);
- a past/present pair that the sentence does not settle («می‌بَرد» vs «می‌بُرد»);
- an ezafe that carries meaning and is easy to miss;
- a borrowed or technical term whose stress or reading a general voice will get wrong;
- a proper name whose pronunciation is not obvious.

Leave everything else unmarked.

## 2. Say what is written short

- Write any remaining digits, dates, ranges, percentages and ordinals as words.
- Expand abbreviations and symbols to the full spoken form.
- A unit of measure is said in full, in {{targetLanguage}}.
- A formula or a code-like fragment is said the way a person would read it out, or left out if it cannot be said.

## 3. Foreign words

- A term from the source language that sits in brackets beside its translation is for the eye: leave it out.
- A foreign name or term that is part of the sentence stays, written as it is, so the engine can switch to it.
- Do not transliterate a Latin word into {{targetLanguage}} letters unless the translation already does so.

## 4. Breathing

- Break a very long sentence into shorter ones **only** by punctuation — a full stop or a semicolon where the
  sentence already has a natural boundary. Never reorder or rewrite to do it.
- Put a full stop at the end of a heading line so the voice stops there.
- Remove anything that is not said: footnote and figure markers, bracketed cross-references, decorative
  quotation marks around a whole line, repeated punctuation.

## Output

Return one JSON object and nothing else:

```json
{
  "items": [
    { "key": "01", "tgt": "<the same line, written to be said>" }
  ]
}
```

- Exactly one item per input key, in the same order. Never merge, split, skip or rename a key.
- `tgt` is plain text: no markup, no SSML, no brackets you were not given.
- A line that needs no change comes back unchanged.
- `note` is optional and only for something a person should look at (a word you could not resolve).
