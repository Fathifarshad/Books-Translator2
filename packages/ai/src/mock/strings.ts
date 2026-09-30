/**
 * Fixed phrases used by the deterministic mock engine, per target language. Real engines get their
 * wording from prompts/; the mock only needs enough to exercise the UI end to end.
 */
export interface MockStrings {
  shortAnswer: string;
  simpler: string;
  role: string;
  example: string;
  exampleBody: (term: string) => string;
  deeper: string;
  keyTerm: string;
  check: string;
  checkQuestion: (section: string) => string;
  quizIntro: string;
  quizQuestion: (term: string) => string;
  noPassages: string;
  mockNote: string;
  followups: { simpler: string; example: string; quiz: string; deeper: string };
  summary: { mainIdea: string; keyPoints: string; keyTerms: string; whyItMatters: string };
  quiz: {
    whichTerm: (definition: string) => string;
    trueFalse: (term: string, definition: string) => string;
    tfExplanationTrue: (term: string) => string;
    tfExplanationFalse: (term: string, real: string) => string;
    mcqExplanation: (term: string) => string;
    short: string;
    shortExplanation: string;
  };
  listSeparator: string;
  quote: (s: string) => string;
}

const fa: MockStrings = {
  shortAnswer: 'پاسخ کوتاه:',
  simpler: 'به زبان ساده:',
  role: 'نقش آن در متن:',
  example: 'یک مثال:',
  exampleBody: (term) =>
    `فرض کن می‌خواهی برای دوستی که همه‌چیز را کلمه‌به‌کلمه اجرا می‌کند، «${term}» را در یک کار روزمره مثل مرتب کردن قفسه‌ی کتاب‌ها نشان دهی. هر گام را جدا بنویس و ببین کجا ممکن است دوستت مکث کند.`,
  deeper: 'نکته‌های دقیق‌تر:',
  keyTerm: 'اصطلاح کلیدی:',
  check: 'پرسش برای سنجش فهم:',
  checkQuestion: (section) => `به نظرت چرا این نکته برای بخش «${section}» مهم است؟`,
  quizIntro: 'بیا فهمت را بسنجیم؛ یک پرسش در هر نوبت.',
  quizQuestion: (term) => `با کلمات خودت بگو «${term}» در این بخش به چه معناست و چرا نویسندگان به آن اهمیت می‌دهند؟`,
  noPassages:
    'در متن کتاب بندی پیدا نکردم که به این پرسش پاسخ دهد. شاید بهتر باشد بخش مرتبط را باز کنی و دوباره بپرسی.',
  mockNote: 'این پاسخ را موتور آزمایشی ساخته است؛ با فعال‌سازی API، مدرس هوشمند واقعی پاسخ می‌دهد.',
  followups: {
    simpler: 'ساده‌تر توضیح بده',
    example: 'یک مثال دیگر بزن',
    quiz: 'از همین تکه از من سؤال بپرس',
    deeper: 'عمیق‌تر توضیح بده',
  },
  summary: {
    mainIdea: 'ایده‌ی اصلی',
    keyPoints: 'نکته‌های کلیدی',
    keyTerms: 'اصطلاحات کلیدی',
    whyItMatters: 'چرا مهم است',
  },
  quiz: {
    whichTerm: (d) => `کدام اصطلاح با این تعریف جور است؟ «${d}»`,
    trueFalse: (t, d) => `درست یا نادرست: «${t}» یعنی «${d}»`,
    tfExplanationTrue: (t) => `درست است؛ این همان تعریفی است که کتاب برای «${t}» به کار می‌برد.`,
    tfExplanationFalse: (t, r) => `نادرست است؛ این تعریف به «${r}» مربوط است، نه «${t}».`,
    mcqExplanation: (t) => `این تعریف دقیقاً معنای «${t}» را در این کتاب بیان می‌کند.`,
    short: 'ایده‌ی اصلی این فصل را در دو یا سه جمله با کلمات خودت بنویس.',
    shortExplanation: 'پاسخ خوب ایده‌ی اصلی را بیان می‌کند و دست‌کم دو اصطلاح کلیدی فصل را درست به کار می‌برد.',
  },
  listSeparator: '، ',
  quote: (s) => `«${s}»`,
};

const en: MockStrings = {
  shortAnswer: 'Short answer:',
  simpler: 'In plain words:',
  role: 'Its role in the text:',
  example: 'An example:',
  exampleBody: (term) =>
    `Imagine showing "${term}" to a friend who follows every instruction literally, using an everyday task such as sorting a bookshelf. Write each step separately and notice where your friend would hesitate.`,
  deeper: 'Finer points:',
  keyTerm: 'Key term:',
  check: 'Check your understanding:',
  checkQuestion: (section) => `Why do you think this point matters for “${section}”?`,
  quizIntro: "Let's check your understanding, one question at a time.",
  quizQuestion: (term) =>
    `In your own words, what does “${term}” mean in this section, and why do the authors care about it?`,
  noPassages:
    'I could not find a passage in the book that answers this. Try opening the related section and asking again.',
  mockNote: 'This answer was produced by the mock engine; enable an API engine for the real tutor.',
  followups: {
    simpler: 'Explain it more simply',
    example: 'Give another example',
    quiz: 'Quiz me on this passage',
    deeper: 'Go deeper',
  },
  summary: { mainIdea: 'Main idea', keyPoints: 'Key points', keyTerms: 'Key terms', whyItMatters: 'Why it matters' },
  quiz: {
    whichTerm: (d) => `Which term matches this definition? “${d}”`,
    trueFalse: (t, d) => `True or false: “${t}” means “${d}”`,
    tfExplanationTrue: (t) => `True — this is how the book defines “${t}”.`,
    tfExplanationFalse: (t, r) => `False — this definition belongs to “${r}”, not “${t}”.`,
    mcqExplanation: (t) => `This definition states exactly what “${t}” means in this book.`,
    short: 'Write the main idea of this chapter in two or three sentences of your own.',
    shortExplanation: 'A good answer states the main idea and uses at least two key terms of the chapter correctly.',
  },
  listSeparator: ', ',
  quote: (s) => `“${s}”`,
};

const TABLE: Record<string, MockStrings> = { fa, en };

export function mockStrings(lang: string): MockStrings {
  return TABLE[lang] ?? en;
}
