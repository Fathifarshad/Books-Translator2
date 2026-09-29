# Prototype screenshots (`docs/design/`)

The five prototype screenshots described in SPEC §4 are the visual reference for the reader:

| Expected file | What it shows |
|---|---|
| `01-reader-overview.png` | Full layout: TOC (right), Persian + English aligned columns, tutor column (left) with suggestion chips; header with breadcrumb, language pills, prev/next and the Persian-summary button. |
| `02-glossary-tooltip.png` | Hovering an underlined glossary term → card with the English term, the Persian equivalent and a Persian definition. |
| `03-selection-ask.png` | Selecting Persian text → floating «بپرس درباره‌ی این» button above the selection. |
| `04-tutor-context-error.png` | Tutor after "ask about this": quoted selection, the streaming error with «تلاش دوباره», and a source chip pointing at the wrong chapter. |
| `05-reader-chapter-3.png` | Another chapter with long aligned paragraphs; TOC with a different chapter expanded. |

**The image files are not committed yet.** They show pages of a copyrighted book, and the repository must not contain
copyrighted book text (SPEC §2.7, §16). Please add them yourself if the repository stays private, or crop/blur the
book text first.

## Design notes taken from the screenshots (no book text)

- Warm paper background, slightly darker beige panels for the TOC and the tutor, thin warm-grey dividers.
- Terracotta accent for the active TOC row (soft tint + accent text), the progress bar, pressed pills and primary actions.
- TOC: «→ کتابخانه» link, bold book title, muted authors/publisher line, translation counter with a thin bar, a
  rounded search box, collapsible chapters with ◂ chevrons, per-section indicators at the inline end.
- Reader header: small muted breadcrumb, large section title, two pill toggles, «بخش قبل» / «بخش بعد» outline buttons,
  a small outline «چکیده‌ی فارسی این بخش را بساز» button.
- Rows: each Persian paragraph and its English original start at the same height; a vertical hairline between the
  columns; hover tints the whole row; glossary terms have a dotted underline.
- Tutor: bold title, muted context line, welcome sentence, full-width white suggestion chips, composer pinned to the bottom.

These notes drive `apps/web/src/styles/tokens.css` and the Phase 1 components; screenshots of the implementation are in
`docs/screens/phase-1/`.
