# Persian (fa) translation & editing style guide — v1

Target: publication-quality **standard written Persian (فارسی معیار نوشتاری)** that reads as if an expert Persian
author had written it, while staying fully faithful to the source.

## 1. Fidelity
- Translate every sentence. No omissions, additions, summaries or explanations inside the text.
- Keep the author's argument, emphasis, hedging ("perhaps", "we suspect"), tone and register.
- Keep the authors' "we" as «ما» when they refer to themselves.
- One output segment per input segment; never move content between segments.
- Translator notes go only in the separate `note` field, never inside the text.

## 2. Natural Persian, not translationese (گرته‌برداری)
Prefer natural Persian syntax (usually subject–object–verb). Restructure long English sentences; a very long sentence
may become two sentences inside the same segment.

| Avoid | Prefer |
|---|---|
| «این روش توسط پژوهشگران ارائه شد.» | «پژوهشگران این روش را ارائه کردند.» |
| «این ابزار مورد استفاده قرار می‌گیرد.» | «از این ابزار استفاده می‌شود.» / «این ابزار به کار می‌رود.» |
| «این مسئله حائز اهمیت می‌باشد.» | «این مسئله مهم است.» |
| «داده‌ها بر روی دیسک ذخیره می‌شوند.» | «داده‌ها روی دیسک ذخیره می‌شوند.» |
| «در رابطه با این موضوع» | «درباره‌ی این موضوع» |
| «به منظور حل مسئله» | «برای حل مسئله» |
| «یک سری قواعد» | «چند قاعده» / «مجموعه‌ای از قواعد» |
| «او یک دانشمند بود که…» | «او دانشمندی بود که…» |

- Avoid overusing the passive, «توسط», «می‌باشد», «گردید», «نمود» (prefer «کرد»), and long chains of «که».
- Avoid archaic or needlessly Arabic vocabulary when a common Persian word exists; never use colloquial forms («میشه»، «اینو»).

## 3. Terminology
- Use the batch glossary equivalents exactly; inflect naturally (plural, ezafe).
- Prefer terms established in Persian academic/technical writing; use the Academy (فرهنگستان) equivalent when it is in
  common use; do not coin new words.
- First occurrence in a chapter of an entry marked `first_in_chapter`: «معادل فارسی (English Term)», e.g.
  «انتزاع (Abstraction)». Later occurrences in the same chapter: Persian only.
- Keep Latin script only for what Persian technical writing normally keeps: programming languages, product names, file
  formats, code identifiers.

## 4. Names and titles
- People, places, organizations: the established Persian form when one exists («آلن تورینگ»، «چارلز بابیج»، «آدا لاولیس»);
  otherwise a careful transliteration. First occurrence in each chapter: «آلن تورینگ (Alan Turing)».
- Titles of books and papers: translated title in «» + original in parentheses at first mention:
  «هنر برنامه‌نویسی کامپیوتر» (The Art of Computer Programming).
- Acronyms: keep the Latin acronym and give the Persian expansion at first mention: «واحد پردازش مرکزی (CPU)».

## 5. Punctuation and typography
- Persian comma «،», semicolon «؛», question mark «؟»; quotation marks « » (nested: “ ”).
- No space before punctuation; one space after. No space just inside «» or ().
- ZWNJ (نیم‌فاصله) wherever it belongs: «می‌شود»، «نمی‌توان»، «کتاب‌ها»، «بزرگ‌ترین»، «پیش‌بینی»، «طراحی‌شده»، «به‌کارگیری».
- Ezafe after silent «ه»: «ه‌ی» («ایده‌ی اصلی»، «جنبه‌ی طراحی») unless the batch options say `ezafe: "hamza"` → «ایدهٔ اصلی».
- Always «ی» and «ک» — never Arabic «ي» / «ك».
- Emphasis: keep the source markup (`*…*`); do not add quotation marks for emphasis.

## 6. Numbers, dates, units
- Persian digits in Persian text: «۱۸۰۰»، «۲۵ میلیون»، «۳٫۵ درصد»; thousands separator «٬» («۱٬۲۰۰»).
- Latin digits stay inside code, formulas, URLs, ISBNs and Latin-script runs.
- Keep Gregorian dates as in the source (no conversion to the Solar Hijri calendar):
  "in the 1950s" → «در دهه‌ی ۱۹۵۰»; "the nineteenth century" → «قرن نوزدهم».
- Keep units as in the source.

## 7. Structure-specific rules
- Headings: concise and title-like, no final period.
- List items stay list items; keep the numbering style.
- Captions: «شکل ۳.۱ — …»، «جدول ۲.۴ — …» (keep the source numbering; the dot here is not a decimal separator).
- Quotations from other authors: translate them; keep citation markers.
- Code, formulas, URLs and identifiers: never translate.

## 8. Final self-check before returning
- Every key present? Nothing omitted or added? Numbers identical? Markup tokens preserved?
- Terms consistent with the glossary? Names consistent with earlier chapters?
- Punctuation, ZWNJ and digits per this guide? Does it read naturally aloud?
