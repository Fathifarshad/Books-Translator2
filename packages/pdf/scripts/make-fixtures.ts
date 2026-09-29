/**
 * Generates the synthetic PDF fixtures (SPEC §8.9). All text is original and written for these tests.
 * Run: pnpm fixtures:pdf   (writes fixtures/pdf/*.pdf)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Writer } from './pdf-writer';

const OUT = fileURLToPath(new URL('../../../fixtures/pdf/', import.meta.url));
const SMALL = { width: 360, height: 480, margin: { top: 62, left: 45, right: 45, bottom: 60 } };

/** Outline, running heads, page labels, hyphenation, paragraph + list item across pages, footnote, code, caption. */
async function outlineBook(): Promise<Buffer> {
  const w = new Writer(SMALL);
  const doc = w.doc;
  doc.info.Title = 'Small Machines';
  doc.info.Author = 'Fixture Author';

  // p0 — title page
  w.gap(90);
  w.heading('Small Machines', 24);
  w.heading('A synthetic book for extraction tests', 12, 'Times-Italic');
  w.heading('Fixture Author', 12, 'Times-Roman');

  // p1 — printed contents (the outline also lists it; skipped by default)
  w.newPage();
  w.pageMeta('Small Machines', 'ii');
  doc.outline.addItem('Contents');
  w.heading('Contents', 16);
  w.lines([
    'Chapter 1 Levers and Pulleys ........ 1',
    '1.1 Levers ........ 1',
    '1.2 Pulleys ........ 3',
    'Chapter 2 Gears ........ 4',
    'Index ........ 5',
  ]);

  // p2 — chapter 1 opens (no running head on opening pages)
  w.newPage();
  w.pageMeta(undefined, '1');
  const ch1 = doc.outline.addItem('Chapter 1: Levers and Pulleys');
  w.heading('Chapter 1', 13, 'Times-Roman', 2);
  w.heading('Levers and Pulleys', 20, 'Times-Bold', 10);
  w.para(
    'People have always looked for ways to move heavy things with less effort. The oldest answers are also the simplest ones: a rigid bar, a rope and a wheel. This chapter looks at two of them.',
  );
  ch1.addItem('1.1 Levers');
  w.gap(6);
  w.heading('1.1 Levers', 13, 'Times-Bold', 4);
  w.para(
    'A lever is a rigid bar that turns around a fixed point called the fulcrum. When the fulcrum sits close to the load, a small push on the far end lifts a large weight. The hand moves a long way while the load moves a short way, and the compu~tation behind it is simple enough to do in your head.',
  );
  w.para(
    'Seesaws, crowbars and bottle openers are all levers. A seesaw puts the fulcrum in the middle, so two children of similar weight can balance each other when they sit at equal distances from the middle of the board.',
    { indent: true, breakAfter: 3 },
  );

  // p3 (continuation arrives at the top of this page)
  w.pageMeta('Levers and Pulleys', '2');
  w.para(
    'A crowbar works the other way round: the fulcrum sits near the heavy end, and a long handle turns a modest push into a strong lift.^1 Builders relied on this long before anyone wrote the rule down.',
    { indent: true },
  );
  w.para('Three things decide how well a lever works:', { indent: true });
  w.listItem('•', 'where the fulcrum sits;');
  w.listItem('•', 'how long each arm is; and');
  w.listItem(
    '•',
    'how stiff the bar stays under load, which matters most when the load is heavy and the bar is thin.',
    { breakAfter: 1 },
  );
  // The footnote belongs to page 3, drawn after the list started to flow to page 4.
  doc.switchToPage(3);
  w.footnote('1', 'A famous boast claims that a long enough lever could move the whole Earth.', 392);
  doc.switchToPage(4);

  // p4
  w.pageMeta('Small Machines', '3');
  ch1.addItem('1.2 Pulleys');
  w.gap(4);
  w.heading('1.2 Pulleys', 13, 'Times-Bold', 4);
  w.para(
    'A pulley is a wheel with a groove for a rope. One fixed pulley only changes the direction of the pull, but several pulleys working together share the load between many lengths of rope.',
    { indent: true },
  );
  w.code(['effort = load / ropes', 'if ropes > 1:', '    print("less force, more rope")']);
  w.para('Figure 1.1 — A block and tackle with four supporting ropes.', { font: 'Times-Italic', size: 9 });

  // p5 — chapter 2 opens; a chapter without sections
  w.newPage();
  w.pageMeta(undefined, '4');
  doc.outline.addItem('Chapter 2: Gears');
  w.heading('Chapter 2', 13, 'Times-Roman', 2);
  w.heading('Gears', 20, 'Times-Bold', 10);
  w.para(
    'A gear is a wheel with teeth. When two gears mesh, the smaller one turns faster and the larger one turns with more force, a trade that engineers call *mechanical advantage*.',
  );
  w.para('Modern self-driving carts still depend on gear trains hidden inside their wheels.', { indent: true });
  w.para(
    'Even the small self~driving carts in a warehouse count on gears to turn quick motor spins into slow, strong wheel turns.',
    { indent: true },
  );

  // p6 — index (skipped by default)
  w.newPage();
  w.pageMeta('Small Machines', '5');
  doc.outline.addItem('Index');
  w.heading('Index', 16);
  w.lines(['fulcrum, 1', 'gear, 4', 'lever, 1–2', 'pulley, 3']);

  return w.finish([
    { start: 0, style: 'r' },
    { start: 2, style: 'D' },
  ]);
}

/** One page with a spanning title and two columns; a paragraph continues from column 1 into column 2. */
async function twoColumn(): Promise<Buffer> {
  const w = new Writer({ width: 595, height: 842, margin: { top: 70, left: 50, right: 50, bottom: 70 } });
  w.doc.info.Title = 'A Note on Wind';
  w.doc.outline.addItem('A Note on Wind');
  w.heading('A Note on Wind', 20, 'Times-Bold', 12);
  const top = w.y;
  const colW = (w.textWidth - 24) / 2;
  const leftX = w.left;
  const rightX = w.left + colW + 24;
  w.para(
    'Wind is air on the move. It flows from places where the air presses down harder toward places where it presses down less, and the larger the difference, the stronger the wind.',
    { x: leftX, width: colW, indent: true },
  );
  w.para(
    'Near the ground, hills, trees and buildings slow the wind and bend its path. Higher up there is less in the way, which is one reason why tall towers catch steadier',
    { x: leftX, width: colW, indent: true },
  );
  w.y = top;
  w.para('breezes than short ones do on the same afternoon.', { x: rightX, width: colW });
  w.para(
    'Sailors learned to read the wind long before anyone could measure it. They watched clouds, waves and birds, and they passed what they saw from one crew to the next.',
    { x: rightX, width: colW, indent: true },
  );
  w.para(
    'A simple vane shows where the wind comes from, and a cup anemometer shows how fast it blows. Together they turn a feeling on the skin into numbers that can be compared.',
    { x: rightX, width: colW, indent: true },
  );
  return w.finish();
}

/** No outline and no page labels: a printed Contents page and printed page numbers drive the structure. */
async function noOutline(): Promise<Buffer> {
  const w = new Writer(SMALL);
  w.doc.info.Title = 'Weather Notes';
  w.gap(100);
  w.heading('Weather Notes', 24);
  w.heading('Short observations for curious readers', 12, 'Times-Italic');

  w.newPage();
  w.heading('Contents', 16);
  w.lines(['Preface ........ 1', 'Chapter 1 Rain ........ 2', 'Chapter 2 Wind ........ 4']);

  w.newPage();
  w.pageMeta(undefined, '1');
  w.heading('Preface', 18);
  w.para(
    'These notes began as a notebook kept on a windowsill. Every morning the sky looked a little different, and writing it down turned a habit into a small study.',
  );
  w.para('Nothing here needs special instruments. A glass jar, a ribbon and a patient eye are enough to start.', {
    indent: true,
  });

  w.newPage();
  w.pageMeta(undefined, '2');
  w.heading('Chapter 1', 13, 'Times-Roman', 2);
  w.heading('Rain', 20, 'Times-Bold', 10);
  w.para(
    'Rain is water that has travelled a long way. It rose as vapour from seas and fields, cooled high in the air, and gathered into drops heavy enough to fall.',
  );
  w.heading('Where rain comes from', 10.5, 'Times-Bold', 2);
  w.para(
    'Warm air holds more moisture than cold air. When warm, damp air is pushed upward by a hill or by a colder air mass, it cools, and the moisture it can no longer hold becomes',
    { breakAfter: 2 },
  );

  w.pageMeta('Rain', '3');
  w.para('cloud and then rain.');
  w.heading('Measuring rain', 10.5, 'Times-Bold', 2);
  w.para(
    'A straight-sided jar left in an open place collects rain at the same depth as the ground around it. Measuring that depth each morning gives a simple record of how wet the day was.',
  );

  w.newPage();
  w.pageMeta(undefined, '4');
  w.heading('Chapter 2', 13, 'Times-Roman', 2);
  w.heading('Wind', 20, 'Times-Bold', 10);
  w.para(
    'A ribbon tied to a stick is the easiest wind gauge. When it hangs down, the air is calm; when it streams straight out, the wind is strong enough to notice on the face.',
  );

  w.newPage();
  w.pageMeta('Weather Notes', '5');
  w.para(
    'Keeping the same stick in the same place matters more than the stick itself. Comparisons only make sense when the conditions stay the same.',
    { indent: true },
  );
  return w.finish();
}

mkdirSync(OUT, { recursive: true });
for (const [name, make] of [
  ['outline-book', outlineBook],
  ['two-column', twoColumn],
  ['no-outline', noOutline],
] as const) {
  writeFileSync(`${OUT}${name}.pdf`, await make());
  console.log(`fixtures/pdf/${name}.pdf`);
}
