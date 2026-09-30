/**
 * «Thinking in Steps» — an ORIGINAL sample book written for this project (no copyrighted text).
 * Authors and publisher are fictional. The Persian translation follows prompts/style/fa.md:
 * first-mention parentheticals per chapter, ZWNJ, Persian digits and punctuation.
 */
import { type BookSpec, caption, code, figure, footnote, h, li, p, q } from './builder';

export const SAMPLE_BOOK_ID = 'bk_sample';

const PAGE_LABELS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];

export const sampleBookSpec: BookSpec = {
  id: SAMPLE_BOOK_ID,
  sourceLang: 'en',
  targetLang: 'fa',
  meta: {
    titles: {
      en: 'Thinking in Steps',
      fa: 'گام‌به‌گام اندیشیدن',
    },
    subtitles: {
      en: 'A Short Introduction to Algorithms',
      fa: 'درآمدی کوتاه بر الگوریتم‌ها',
    },
    authors: ['Laleh Karimi', 'Owen Maddox'],
    publisher: 'Dozabaneh Sample Press',
    year: 2025,
    pageCount: PAGE_LABELS.length,
    pageLabels: PAGE_LABELS,
    brief: {
      fa: 'کتابی آموزشی و عامه‌فهم درباره‌ی تفکر الگوریتمی برای خوانندگانی که پیش‌زمینه‌ی ریاضی ندارند. نویسندگان با لحنی صمیمی و با ضمیر «ما» می‌نویسند و هر مفهوم را از مثال‌های روزمره آغاز می‌کنند. اصطلاحات فنی در نخستین کاربرد هر فصل همراه با معادل انگلیسی در پرانتز می‌آیند.',
    },
  },
  nodes: [
    {
      key: 'preface',
      kind: 'front',
      pages: [4, 5],
      heading: h('Preface', 'پیشگفتار'),
      rows: [
        p(
          'This small book is an invitation. It is written for readers who use computers every day but have never been shown what happens between a question and its answer. We assume no mathematics beyond arithmetic, and we do not ask you to install anything.',
          'این کتاب کوچک یک دعوت‌نامه است. آن را برای خوانندگانی نوشته‌ایم که هر روز با رایانه کار می‌کنند، اما کسی به آن‌ها نشان نداده است که میان یک پرسش و پاسخش چه می‌گذرد. جز حساب ساده، دانش ریاضی دیگری از شما انتظار نداریم و از شما نمی‌خواهیم چیزی نصب کنید.',
        ),
        p(
          'Each chapter moves from everyday examples to a single idea that computer scientists use constantly. Along the way we introduce a few technical terms; when we do, we explain them in plain words first and give the precise meaning second.',
          'هر فصل از مثال‌های روزمره آغاز می‌شود و به ایده‌ای می‌رسد که دانشمندان علوم رایانه پیوسته از آن استفاده می‌کنند. در طول راه چند اصطلاح فنی را معرفی می‌کنیم؛ هر بار ابتدا آن را به زبان ساده توضیح می‌دهیم و سپس معنای دقیقش را می‌گوییم.',
        ),
        p(
          'Read slowly. The goal is not to memorize definitions but to notice that you already think in steps far more often than you realize.',
          'آهسته بخوانید. هدف از بر کردن تعریف‌ها نیست؛ هدف این است که متوجه شوید خیلی بیشتر از آنچه گمان می‌کنید، از پیش گام‌به‌گام فکر می‌کنید.',
        ),
      ],
    },
    {
      key: 'ch1',
      kind: 'chapter',
      numberLabel: '1',
      pages: [6, 16],
      children: [
        {
          key: 'ch1-intro',
          kind: 'chapter_intro',
          pages: [6, 7],
          heading: h('What Is an Algorithm?', 'الگوریتم چیست؟'),
          rows: [
            p(
              'An *algorithm* is a finite sequence of precise steps that turns an input into an output. That definition sounds technical, but the idea is older than any machine. Merchants, cooks and surveyors followed algorithms long before anyone built a computer.',
              '*الگوریتم* (Algorithm) دنباله‌ای متناهی از گام‌های دقیق است که یک ورودی (Input) را به یک خروجی (Output) تبدیل می‌کند. این تعریف فنی به نظر می‌رسد، اما این ایده از هر ماشینی قدیمی‌تر است. بازرگانان، آشپزها و نقشه‌برداران مدت‌ها پیش از ساخته شدن نخستین رایانه از الگوریتم‌ها پیروی می‌کردند.',
            ),
            p(
              'The word itself carries a piece of history. It comes from the name of Muhammad ibn Musa al-Khwarizmi, a ninth-century scholar in Baghdad whose book on calculating with Hindu–Arabic numerals was translated into Latin. European readers turned his name into *algorismus*, and over the centuries the term drifted toward its modern meaning.',
              'خود این واژه تکه‌ای از تاریخ را با خود دارد. واژه‌ی الگوریتم از نام محمد بن موسی خوارزمی (Muhammad ibn Musa al-Khwarizmi) گرفته شده است؛ دانشمندی در بغدادِ قرن نهم میلادی که کتابش درباره‌ی محاسبه با ارقام هندی‌ـ‌عربی به لاتین ترجمه شد. خوانندگان اروپایی نام او را به *algorismus* تبدیل کردند و این اصطلاح در گذر سده‌ها به معنای امروزی‌اش نزدیک شد.',
            ),
            p(
              'In this chapter we look at three questions. What makes a procedure an algorithm rather than a vague suggestion? Why does precision matter so much? And how can we tell whether one algorithm is better than another?',
              'در این فصل به سه پرسش می‌پردازیم: چه چیزی یک رویه را به الگوریتم تبدیل می‌کند، نه به پیشنهادی مبهم؟ چرا دقت تا این اندازه اهمیت دارد؟ و چگونه می‌توان فهمید که یک الگوریتم از دیگری بهتر است؟',
            ),
          ],
        },
        {
          key: 'ch1-recipes',
          kind: 'section',
          pages: [8, 10],
          heading: h('Recipes, Rules, and Procedures', 'دستورپخت‌ها، قاعده‌ها و رویه‌ها'),
          rows: [
            p(
              'A cooking recipe is the classic first example. It lists ingredients (the input), describes a sequence of actions, and promises a dish at the end (the output). Most recipes, however, leave a great deal unsaid. "Season to taste" assumes a cook who already knows what good food tastes like.',
              'دستور پخت غذا نخستین مثال کلاسیک است: مواد لازم را فهرست می‌کند (ورودی)، دنباله‌ای از کارها را شرح می‌دهد و در پایان غذایی را وعده می‌دهد (خروجی). با این حال، بیشتر دستورپخت‌ها چیزهای زیادی را ناگفته می‌گذارند. «به اندازه‌ی دلخواه نمک بزنید» آشپزی را فرض می‌گیرد که از پیش می‌داند غذای خوب چه مزه‌ای دارد.',
            ),
            p(
              'A *procedure* in the computing sense cannot rely on taste. Every step must be something the person or machine carrying it out can do without guessing. Add two numbers. Compare two words. Move to the next item in a list. These are the kinds of steps from which every algorithm is built.',
              '*رویه* (Procedure) به معنای رایانشی‌اش نمی‌تواند به سلیقه تکیه کند. هر گام باید کاری باشد که انجام‌دهنده‌اش، چه انسان و چه ماشین، بتواند بدون حدس زدن انجامش دهد. دو عدد را جمع کن. دو واژه را با هم مقایسه کن. به مورد بعدی فهرست برو. همه‌ی الگوریتم‌ها از چنین گام‌هایی ساخته می‌شوند.',
            ),
            p(
              'Rules differ from procedures in a useful way. A rule tells you what must be true ("never leave the stove unattended"), while a procedure tells you what to do next. Algorithms usually combine both: a sequence of actions plus conditions that decide which action comes next.',
              'قاعده و رویه تفاوتی سودمند با هم دارند. قاعده به شما می‌گوید چه چیزی باید برقرار باشد («هرگز اجاق روشن را به حال خود رها نکنید»)، در حالی که رویه می‌گوید گام بعدی چیست. الگوریتم‌ها معمولاً هر دو را با هم دارند: دنباله‌ای از کارها به‌علاوه‌ی شرط‌هایی که تعیین می‌کنند کار بعدی کدام است.',
            ),
            p(
              'Finally, an algorithm must stop. A procedure that loops forever, such as "keep stirring," may be useful in a kitchen with a human watching, but it never delivers an output on its own. Termination is part of the definition, not an afterthought.',
              'سرانجام، الگوریتم باید به پایان برسد. رویه‌ای که تا ابد تکرار می‌شود، مانند «همین‌طور هم بزنید»، شاید در آشپزخانه‌ای که انسانی مراقبش است به کار بیاید، اما به‌تنهایی هرگز خروجی‌ای به دست نمی‌دهد. پایان‌پذیری (Termination) بخشی از تعریف الگوریتم است، نه نکته‌ای فرعی.',
            ),
          ],
        },
        {
          key: 'ch1-precision',
          kind: 'section',
          pages: [11, 13],
          heading: h('Precision: Saying Exactly What You Mean', 'دقت: همان را بگویید که منظورتان است'),
          rows: [
            p(
              'Human language is wonderfully flexible and dangerously ambiguous. The sentence "Meet the new students\' teacher at noon" can mean that the students are new or that the teacher is. People resolve such *ambiguity* from context; a machine following instructions cannot.',
              'زبان انسان به‌طرز شگفت‌انگیزی انعطاف‌پذیر و به‌طرز خطرناکی مبهم است. جمله‌ی «ظهر با معلم تازه‌ی دانش‌آموزان دیدار کن» روشن نمی‌کند که معلم تازه است یا دانش‌آموزان. انسان‌ها چنین *ابهامی* (Ambiguity) را از روی بافت سخن برطرف می‌کنند؛ ماشینی که دستورها را اجرا می‌کند نمی‌تواند.',
              {
                note: {
                  fa: 'جمله‌ی مثال در متن اصلی ابهامی دستوری دارد که ترجمه‌ی واژه‌به‌واژه آن را از بین می‌برد؛ جمله‌ای فارسی ساختیم که همان نوع ابهام را نشان دهد.',
                },
              },
            ),
            p(
              'To remove ambiguity, algorithm designers write in a restricted style. A precise step has three properties:',
              'طراحان الگوریتم برای از میان بردن ابهام، به سبکی محدود و حساب‌شده می‌نویسند. هر گام دقیق سه ویژگی دارد:',
            ),
            li('it names exactly which data it uses;', 'دقیقاً مشخص می‌کند از کدام داده‌ها استفاده می‌کند؛'),
            li(
              'it describes one action that can be carried out mechanically;',
              'یک کار را شرح می‌دهد که می‌توان آن را به‌طور مکانیکی انجام داد؛',
              {
                flags: {
                  fa: [
                    {
                      code: 'low_confidence',
                      severity: 'low',
                      reason:
                        'برای «mechanically» معادل «بی‌آنکه نیازی به داوری باشد» هم ممکن است روان‌تر باشد؛ بازبینی شود.',
                    },
                  ],
                },
              },
            ),
            li(
              'it says what happens next, including what to do when a condition is not met.',
              'می‌گوید پس از آن چه رخ می‌دهد، از جمله اینکه اگر شرطی برقرار نبود چه باید کرد.',
            ),
            p('A teacher of ours liked to put it this way:', 'یکی از استادان ما دوست داشت این نکته را چنین بیان کند:'),
            q(
              'If you cannot explain a step to a patient friend who takes everything literally, you have not finished designing it.',
              'اگر نمی‌توانید گامی را برای دوستی صبور که همه‌چیز را کلمه‌به‌کلمه می‌فهمد توضیح دهید، هنوز طراحی آن را تمام نکرده‌اید.',
            ),
            p(
              'This is why programmers often begin with *pseudocode*: a halfway language that looks like English but follows the discipline of code. Pseudocode lets us check the logic of an algorithm before we worry about the details of any particular programming language.',
              'به همین دلیل برنامه‌نویسان اغلب کار را با *شبه‌کد* (Pseudocode) آغاز می‌کنند: زبانی میانه که ظاهرش به انگلیسی شبیه است، اما از انضباط کد پیروی می‌کند. شبه‌کد به ما امکان می‌دهد منطق الگوریتم را پیش از درگیر شدن با جزئیات یک زبان برنامه‌نویسی خاص بررسی کنیم.',
            ),
          ],
        },
        {
          key: 'ch1-speed',
          kind: 'section',
          pages: [14, 16],
          heading: h('How Fast Is Fast Enough?', 'چه سرعتی کافی است؟'),
          rows: [
            p(
              'Two algorithms can solve the same problem and still differ enormously in the effort they require. Suppose you need to find a name in a list of 1,000 unsorted names. The simplest method, *linear search*, checks the names one by one from the start.',
              'دو الگوریتم ممکن است یک مسئله را حل کنند و باز هم در میزان تلاشی که لازم دارند تفاوت بسیاری داشته باشند. فرض کنید باید نامی را در فهرستی از ۱٬۰۰۰ نام نامرتب پیدا کنید. ساده‌ترین روش، یعنی *جست‌وجوی خطی* (Linear Search)، نام‌ها را از ابتدا یکی‌یکی بررسی می‌کند.',
            ),
            code(
              [
                'def linear_search(names, target):',
                '    for position, name in enumerate(names):',
                '        if name == target:',
                '            return position',
                '    return None',
              ].join('\n'),
              'python',
            ),
            p(
              'In the worst case, linear search looks at every one of the 1,000 names. If the list were sorted, we could do much better. *Binary search* opens the list in the middle, decides which half must contain the name, and repeats on that half. After about 10 halvings, a list of 1,000 names is down to a single candidate [[fig:1.1]].',
              'در بدترین حالت، جست‌وجوی خطی تک‌تک ۱٬۰۰۰ نام را بررسی می‌کند. اگر فهرست مرتب بود، می‌توانستیم خیلی بهتر عمل کنیم. *جست‌وجوی دودویی* (Binary Search) فهرست را از وسط باز می‌کند، تشخیص می‌دهد نام در کدام نیمه است و همین کار را روی همان نیمه تکرار می‌کند. پس از حدود ۱۰ بار نصف کردن، از فهرستی با ۱٬۰۰۰ نام فقط یک گزینه باقی می‌ماند [[fig:1.1]].',
            ),
            figure('1.1'),
            caption(
              '1.1',
              'Figure 1.1 — Binary search halves the remaining list at every step.',
              'شکل ۱.۱ — جست‌وجوی دودویی در هر گام فهرست باقی‌مانده را نصف می‌کند.',
            ),
            p(
              'This difference is what computer scientists call *efficiency*: how the work an algorithm does grows as its input grows. Doubling the list doubles the work of linear search but adds only one extra step to binary search.',
              'این تفاوت همان چیزی است که دانشمندان علوم رایانه *کارایی* (Efficiency) می‌نامند: اینکه کار یک الگوریتم با بزرگ‌تر شدن ورودی‌اش چگونه رشد می‌کند. دو برابر شدن فهرست، کار جست‌وجوی خطی را دو برابر می‌کند، اما به جست‌وجوی دودویی فقط یک گام اضافه می‌کند.',
            ),
            p(
              'Faster is not always better, though. Binary search needs a sorted list, and sorting has its own cost. Choosing an algorithm means weighing such trade-offs against the problem you actually have.',
              'با این حال، سریع‌تر همیشه بهتر نیست. جست‌وجوی دودویی به فهرست مرتب نیاز دارد و مرتب کردن هم هزینه‌ی خودش را دارد. انتخاب الگوریتم یعنی سنجیدن چنین بده‌بستان‌هایی در برابر مسئله‌ای که واقعاً با آن روبه‌رو هستید.',
            ),
          ],
        },
      ],
    },
    {
      key: 'ch2',
      kind: 'chapter',
      numberLabel: '2',
      pages: [17, 28],
      children: [
        {
          key: 'ch2-intro',
          kind: 'chapter_intro',
          pages: [17, 17],
          heading: h('Representing the World (with Data)', 'بازنمایی جهان (با داده)'),
          rows: [
            p(
              'An algorithm can only work on what it is given. Before any computation begins, someone has to decide how a piece of the world — a temperature, a photograph, a family tree — will be written down as data. That decision is called a *representation*, and it shapes everything that follows.',
              'الگوریتم فقط روی چیزی کار می‌کند که به آن داده شده است. پیش از آغاز هر محاسبه‌ای، کسی باید تصمیم بگیرد که تکه‌ای از جهان — یک دما، یک عکس یا یک شجره‌نامه — چگونه به صورت داده نوشته شود. این تصمیم را *بازنمایی* (Representation) می‌نامند و همه‌ی مراحل بعدی را شکل می‌دهد.',
            ),
            p(
              'A good representation makes the right questions easy. A bad one hides the answer even when the data is complete. In this chapter we start at the smallest unit of data and build up to the structures that organize large collections.',
              'بازنمایی خوب پاسخ دادن به پرسش‌های درست را آسان می‌کند. بازنمایی بد حتی وقتی داده‌ها کامل‌اند پاسخ را پنهان می‌کند. در این فصل از کوچک‌ترین واحد داده آغاز می‌کنیم و گام‌به‌گام به ساختارهایی می‌رسیم که مجموعه‌های بزرگ را سامان می‌دهند.',
            ),
          ],
        },
        {
          key: 'ch2-bits',
          kind: 'section',
          pages: [18, 20],
          heading: h('Bits, Symbols, and Meaning', 'بیت‌ها، نمادها و معنا'),
          rows: [
            p(
              'At the lowest level, a digital computer stores everything as *bits*: values that are either 0 or 1. A single bit can answer one yes-or-no question. Eight bits together, a byte, can distinguish 256 different patterns.',
              'رایانه‌ی رقمی در پایین‌ترین سطح، همه‌چیز را به صورت *بیت* (Bit) ذخیره می‌کند: مقدارهایی که یا ۰ هستند یا ۱. یک بیت به‌تنهایی می‌تواند به یک پرسش بله‌ـ‌خیر پاسخ دهد. هشت بیت در کنار هم، یعنی یک بایت (Byte)، می‌توانند ۲۵۶ الگوی متفاوت را از هم تشخیص دهند.',
            ),
            p(
              "Bits mean nothing by themselves. The pattern `01000001` can be the number 65, the letter A, or part of a pixel's color, depending on the agreement we make about how to read it. Such an agreement is called an *encoding*.[^1]",
              'بیت‌ها به‌خودی‌خود معنایی ندارند. الگوی `01000001` بسته به قراردادی که درباره‌ی شیوه‌ی خواندنش می‌گذاریم، می‌تواند عدد ۶۵، حرف A یا بخشی از رنگ یک پیکسل باشد. به چنین قراردادی *رمزگذاری* (Encoding) می‌گویند.[^1]',
            ),
            p(
              "Text is a good example. Early encodings covered only the English alphabet, which is why older software often garbled Persian or Arabic letters. Modern systems use Unicode, a single catalogue that assigns a number to each of more than a hundred thousand characters from the world's writing systems.",
              'متن نمونه‌ی خوبی است. رمزگذاری‌های نخستین فقط الفبای انگلیسی را پوشش می‌دادند و به همین دلیل نرم‌افزارهای قدیمی حروف فارسی یا عربی را اغلب درهم‌ریخته نشان می‌دادند. سامانه‌های امروزی از یونیکد (Unicode) استفاده می‌کنند؛ فهرستی یگانه که به هر یک از بیش از صد هزار نویسه‌ی نظام‌های نوشتاری جهان عددی اختصاص می‌دهد.',
            ),
            p(
              'The lesson generalizes. Whenever you see data, ask what agreement gives it meaning. Most errors in real systems are not arithmetic mistakes but mismatched agreements between the people who wrote the data and the people who read it.',
              'این درس فراتر از این مثال هم کاربرد دارد. هر جا داده‌ای دیدید، بپرسید کدام قرارداد به آن معنا می‌دهد. بیشتر خطاهای سامانه‌های واقعی اشتباه حسابی نیستند؛ ناهمخوانی قراردادها هستند، میان کسانی که داده را نوشته‌اند و کسانی که آن را می‌خوانند.',
            ),
            footnote(
              '1',
              'The same idea appears in everyday life: a traffic light is a three-symbol encoding that every driver agrees to read the same way.',
              'همین ایده در زندگی روزمره هم دیده می‌شود: چراغ راهنمایی رمزگذاری‌ای سه‌نمادی است که همه‌ی رانندگان پذیرفته‌اند آن را یکسان بخوانند.',
            ),
          ],
        },
        {
          key: 'ch2-structures',
          kind: 'section',
          pages: [21, 24],
          heading: h(
            'Structures That Organize: Lists, Trees, and Tables',
            'ساختارهایی برای سامان‌دادن: فهرست‌ها، درخت‌ها و جدول‌ها',
          ),
          rows: [
            p(
              'Individual values become useful when we arrange them. A *data structure* is a way of organizing data so that certain operations are fast. There is no best structure in general, only structures that suit particular questions.',
              'مقدارهای منفرد وقتی سودمند می‌شوند که آن‌ها را سامان دهیم. *ساختار داده* (Data Structure) شیوه‌ای برای سازمان‌دهی داده‌هاست، به‌گونه‌ای که برخی عملیات سریع انجام شوند. به‌طور کلی بهترین ساختار وجود ندارد؛ فقط ساختارهایی هستند که با پرسش‌های خاصی جور درمی‌آیند.',
            ),
            p(
              'A *list* keeps items in order, like names on an attendance sheet. It is easy to add something at the end and easy to read the items one after another, but finding a particular item may require the linear search we met in Chapter 1.',
              '*فهرست* (List) موردها را به ترتیب نگه می‌دارد، مانند نام‌ها در دفتر حضور و غیاب. افزودن چیزی به انتهای آن آسان است و خواندن موردها یکی پس از دیگری هم آسان است، اما پیدا کردن یک مورد خاص ممکن است به همان جست‌وجوی خطی (Linear Search) نیاز داشته باشد که در فصل ۱ دیدیم.',
            ),
            p(
              'A *tree* arranges items in levels, the way a family tree or the folders on your computer do. Each item can have several children but only one parent, so you can reach any item by following a single path from the top.',
              '*درخت* (Tree) موردها را در سطح‌های مختلف می‌چیند، همان‌طور که شجره‌نامه یا پوشه‌های رایانه‌ی شما چنین‌اند. هر مورد می‌تواند چند فرزند داشته باشد اما فقط یک والد دارد، پس می‌توان با دنبال کردن یک مسیر یکتا از بالا به هر موردی رسید.',
            ),
            p(
              'A *table* lines items up in rows and columns so that each row describes one thing and each column one property. Spreadsheets and databases are built on this idea, which is why a well-designed table can answer questions its authors never anticipated.',
              '*جدول* (Table) موردها را در سطرها و ستون‌ها می‌چیند، به‌طوری که هر سطر یک چیز و هر ستون یک ویژگی را توصیف کند. صفحه‌گسترده‌ها و پایگاه‌های داده بر همین ایده بنا شده‌اند و به همین دلیل جدولی که خوب طراحی شده باشد می‌تواند به پرسش‌هایی پاسخ دهد که سازندگانش هرگز پیش‌بینی نکرده بودند.',
            ),
          ],
        },
        {
          key: 'ch2-abstraction',
          kind: 'section',
          pages: [25, 28],
          heading: h('Abstraction: The Art of Leaving Things Out', 'انتزاع: هنر کنار گذاشتن جزئیات'),
          rows: [
            p(
              'Every representation leaves something out. A map of the subway omits the streets above it; a list of students omits their faces. This deliberate omission is called *abstraction*, and it is one of the most powerful tools in computing.',
              'هر بازنمایی چیزی را کنار می‌گذارد. نقشه‌ی مترو خیابان‌های بالای سرش را نشان نمی‌دهد؛ فهرست دانش‌آموزان هم چهره‌هایشان را. این کنار گذاشتن آگاهانه را *انتزاع* (Abstraction) می‌نامند و یکی از نیرومندترین ابزارهای رایانش است.',
            ),
            p(
              'Abstraction lets us think about one level at a time. When you send a message, you do not think about bits, radio waves or cables; you think about the person who will read it. Each layer of a computer system hides the details of the layer below.',
              'انتزاع به ما امکان می‌دهد هر بار فقط به یک سطح فکر کنیم. وقتی پیامی می‌فرستید، به بیت‌ها، امواج رادیویی یا کابل‌ها فکر نمی‌کنید؛ به کسی فکر می‌کنید که پیام را خواهد خواند. هر لایه از یک سامانه‌ی رایانه‌ای جزئیات لایه‌ی زیرینش را پنهان می‌کند.',
            ),
            p(
              'The same move helps with large problems. Through *decomposition* we split a problem into parts, and through abstraction we give each part a name and a simple description, so that we can use it without remembering how it works inside.',
              'همین حرکت در رویارویی با مسئله‌های بزرگ هم کمک می‌کند. با *تجزیه* (Decomposition) مسئله را به چند بخش تقسیم می‌کنیم و با انتزاع به هر بخش نام و توصیفی ساده می‌دهیم تا بتوانیم بدون به خاطر سپردن سازوکار درونی‌اش از آن استفاده کنیم.',
            ),
            p(
              'Leaving things out is risky, of course. An abstraction that ignores something important will eventually fail, often at the worst moment. Good designers therefore write down what their abstractions assume, so that others can tell when those assumptions no longer hold.',
              'البته کنار گذاشتن چیزها خطر هم دارد. انتزاعی که چیز مهمی را نادیده بگیرد، سرانجام شکست می‌خورد، آن هم اغلب در بدترین لحظه. به همین دلیل طراحان خوب پیش‌فرض‌های انتزاع‌هایشان را مکتوب می‌کنند تا دیگران بتوانند تشخیص دهند چه زمانی آن پیش‌فرض‌ها دیگر برقرار نیستند.',
            ),
          ],
        },
      ],
    },
    {
      key: 'epilogue',
      kind: 'back',
      pages: [29, 29],
      // Starts untranslated so the reader can demo «ترجمه‌ی این بخش را الان انجام بده» with the mock engine.
      status: 'pending',
      heading: h('Epilogue: Where to Go Next', 'سخن پایانی: از اینجا به کجا برویم؟'),
      rows: [
        p(
          'You have now met the core vocabulary of algorithmic thinking: steps, precision, efficiency, representation and abstraction. None of these ideas requires a computer, yet together they explain much of what computers do.',
          'اکنون با واژگان اصلی تفکر الگوریتمی آشنا شده‌اید: گام، دقت، کارایی، بازنمایی و انتزاع. هیچ‌یک از این ایده‌ها به رایانه نیاز ندارد، اما همه با هم بخش بزرگی از کار رایانه‌ها را توضیح می‌دهند.',
        ),
        p(
          'The best next step is practice. Pick a routine task from your week, write it down as precise steps, and ask a friend to follow them literally. The places where your friend hesitates are exactly the places where your algorithm is not yet finished.',
          'بهترین گام بعدی تمرین است. یکی از کارهای روزمره‌ی هفته‌تان را انتخاب کنید، آن را به صورت گام‌های دقیق بنویسید و از دوستی بخواهید کلمه‌به‌کلمه اجرایش کند. هر جا دوستتان مکث کرد، دقیقاً همان‌جاست که الگوریتم شما هنوز کامل نشده است.',
        ),
      ],
    },
  ],
  glossary: [
    {
      key: 'algorithm',
      src: 'algorithm',
      tgt: 'الگوریتم',
      kind: 'concept',
      definition: 'دنباله‌ای متناهی از گام‌های دقیق و بی‌ابهام که ورودی را به خروجی تبدیل می‌کند و سرانجام به پایان می‌رسد.',
    },
    {
      key: 'input',
      src: 'input',
      tgt: 'ورودی',
      kind: 'term',
      definition: 'داده‌ای که الگوریتم کارش را با آن آغاز می‌کند.',
    },
    {
      key: 'output',
      src: 'output',
      tgt: 'خروجی',
      kind: 'term',
      definition: 'نتیجه‌ای که الگوریتم پس از پایان کار تحویل می‌دهد.',
    },
    {
      key: 'procedure',
      src: 'procedure',
      tgt: 'رویه',
      kind: 'concept',
      alternatives: ['روال'],
      definition: 'مجموعه‌ای از کارها با ترتیب مشخص که می‌توان آن‌ها را بدون حدس زدن اجرا کرد.',
    },
    {
      key: 'termination',
      src: 'termination',
      tgt: 'پایان‌پذیری',
      kind: 'concept',
      definition: 'این ویژگی که الگوریتم پس از تعداد متناهی گام متوقف می‌شود و خروجی می‌دهد.',
    },
    {
      key: 'ambiguity',
      src: 'ambiguity',
      tgt: 'ابهام',
      kind: 'concept',
      definition: 'حالتی که یک جمله یا دستور بیش از یک معنا داشته باشد.',
    },
    {
      key: 'pseudocode',
      src: 'pseudocode',
      tgt: 'شبه‌کد',
      kind: 'term',
      definition: 'نوشتن الگوریتم به زبانی نیمه‌رسمی که به زبان طبیعی شبیه است، اما مانند کد دقیق و گام‌به‌گام است.',
    },
    {
      key: 'linear-search',
      src: 'linear search',
      tgt: 'جست‌وجوی خطی',
      kind: 'term',
      definition: 'روشی برای یافتن یک مورد که فهرست را از ابتدا یکی‌یکی بررسی می‌کند.',
    },
    {
      key: 'binary-search',
      src: 'binary search',
      tgt: 'جست‌وجوی دودویی',
      kind: 'term',
      definition: 'روشی برای جست‌وجو در فهرست مرتب که در هر گام نیمی از فهرست باقی‌مانده را کنار می‌گذارد.',
    },
    {
      key: 'efficiency',
      src: 'efficiency',
      tgt: 'کارایی',
      kind: 'concept',
      definition: 'اینکه کار یک الگوریتم با بزرگ‌تر شدن ورودی‌اش با چه سرعتی رشد می‌کند.',
    },
    {
      key: 'representation',
      src: 'representation',
      tgt: 'بازنمایی',
      kind: 'concept',
      definition: 'تصمیمی درباره‌ی اینکه بخشی از جهان چگونه به صورت داده نوشته شود.',
    },
    {
      key: 'bit',
      src: 'bit',
      tgt: 'بیت',
      kind: 'term',
      definition: 'کوچک‌ترین واحد داده در رایانه‌ی رقمی که فقط یکی از دو مقدار ۰ یا ۱ را می‌گیرد.',
    },
    {
      key: 'byte',
      src: 'byte',
      tgt: 'بایت',
      kind: 'term',
      definition: 'گروهی هشت‌تایی از بیت‌ها که می‌تواند ۲۵۶ الگوی متفاوت را نشان دهد.',
    },
    {
      key: 'encoding',
      src: 'encoding',
      tgt: 'رمزگذاری',
      kind: 'concept',
      definition: 'قراردادی که تعیین می‌کند یک الگوی بیتی چگونه خوانده و تفسیر شود.',
    },
    {
      key: 'unicode',
      src: 'Unicode',
      tgt: 'یونیکد',
      kind: 'term',
      definition: 'استانداردی جهانی که به هر نویسه از نظام‌های نوشتاری جهان عددی یکتا می‌دهد.',
    },
    {
      key: 'data-structure',
      src: 'data structure',
      tgt: 'ساختار داده',
      kind: 'concept',
      definition: 'شیوه‌ای برای سازمان‌دهی داده‌ها تا برخی عملیات سریع و ساده انجام شوند.',
    },
    {
      key: 'list',
      src: 'list',
      tgt: 'فهرست',
      kind: 'term',
      definition: 'ساختاری که موردها را به ترتیب و پشت سر هم نگه می‌دارد.',
    },
    {
      key: 'tree',
      src: 'tree',
      tgt: 'درخت',
      kind: 'term',
      definition: 'ساختاری سطح‌بندی‌شده که در آن هر مورد یک والد دارد و ممکن است چند فرزند داشته باشد.',
    },
    {
      key: 'table',
      src: 'table',
      tgt: 'جدول',
      kind: 'term',
      definition: 'ساختاری از سطرها و ستون‌ها که هر سطر یک چیز و هر ستون یک ویژگی را توصیف می‌کند.',
    },
    {
      key: 'abstraction',
      src: 'abstraction',
      tgt: 'انتزاع',
      kind: 'concept',
      definition: 'کنار گذاشتن آگاهانه‌ی جزئیات تا بتوان در هر لحظه فقط به یک سطح از مسئله فکر کرد.',
    },
    {
      key: 'decomposition',
      src: 'decomposition',
      tgt: 'تجزیه',
      kind: 'concept',
      definition: 'شکستن یک مسئله‌ی بزرگ به بخش‌های کوچک‌تر و ساده‌تر.',
    },
    {
      key: 'khwarizmi',
      src: 'Muhammad ibn Musa al-Khwarizmi',
      tgt: 'محمد بن موسی خوارزمی',
      kind: 'person',
      alternatives: ['خوارزمی'],
      definition: 'ریاضی‌دان و ستاره‌شناس ایرانی قرن نهم میلادی در بغداد که واژه‌ی «الگوریتم» از نام او گرفته شده است.',
    },
  ],
};
