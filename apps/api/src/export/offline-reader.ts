/**
 * The offline reader shipped inside an exported book (one self-contained HTML file for phones). Plain JavaScript and
 * CSS, no network: the book data, the UI strings and the fonts are embedded by `buildOfflineHtml`. Logical CSS
 * properties only (RTL-first); every book text was escaped when the HTML fragments were rendered on the server.
 */
export const OFFLINE_CSS = `
:root{--bg:#faf8f4;--surface:#fff;--text:#1f1b16;--muted:#6b6258;--border:#e6e0d6;--accent:#9a3f1c;--accent-soft:#f6e7df;
--mark:#fff1a8;--fs:17px}
:root[data-theme="dark"]{--bg:#161412;--surface:#1f1c19;--text:#ece6dd;--muted:#a79d90;--border:#34302b;--accent:#e08a61;
--accent-soft:#3a2a22;--mark:#5b4a12}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#161412;--surface:#1f1c19;--text:#ece6dd;
--muted:#a79d90;--border:#34302b;--accent:#e08a61;--accent-soft:#3a2a22;--mark:#5b4a12}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font-family:"Vazirmatn Offline",Vazirmatn,system-ui,sans-serif;font-size:var(--fs);line-height:2;
-webkit-text-size-adjust:100%}
button{font:inherit;font-size:14px;line-height:1.4;color:inherit;background:none;border:1px solid var(--border);
border-radius:10px;padding:6px 10px;cursor:pointer;min-height:36px}
button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
header{background:var(--surface);border-block-end:1px solid var(--border);padding:8px 12px;display:flex;gap:6px;
align-items:center;flex-wrap:wrap}
.fab{position:fixed;inset-block-end:16px;inset-inline-end:16px;z-index:6;border-radius:99px;background:var(--surface);
box-shadow:0 2px 10px rgba(0,0,0,.18);padding:8px 14px}
header h1{font-size:15px;margin:0;flex:1 1 100%;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;width:100%}
.modes{display:flex;gap:4px;margin-inline-start:auto}
main{max-width:760px;margin:0 auto;padding:16px 16px 96px}
.crumb{color:var(--muted);font-size:13px;margin:0}
h2.title{font-size:1.35em;line-height:1.7;margin:.2em 0 1em}
.row{margin:0 0 1.1em}
.row .tgt{margin:0}
.row .src{margin:.35em 0 0;color:var(--muted);font-size:.9em;line-height:1.8}
.both .row{border-block-end:1px dashed var(--border);padding-block-end:.9em}
.row.heading .tgt,.row.heading .src:first-child{font-weight:700;font-size:1.12em}
.row.heading:first-child .tgt,.row.heading:first-child .src:first-child{font-size:1.35em;line-height:1.7}
.row.quote{border-inline-start:3px solid var(--border);padding-inline-start:12px}
.row.list_item .tgt::before,.row.list_item .src:first-child::before{content:"• "}
.row.code pre,.row pre{direction:ltr;text-align:left;overflow-x:auto;background:var(--surface);border:1px solid var(--border);
border-radius:8px;padding:10px;font-size:.8em;line-height:1.6;white-space:pre}
.row.caption,.row.footnote{font-size:.85em;color:var(--muted)}
.untranslated{opacity:.85}
.badge{display:inline-block;font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:99px;
padding:0 8px;margin-block-end:4px}
code{font-family:ui-monospace,monospace;font-size:.9em}
sup.fn{font-size:.7em;color:var(--accent)}
a{color:var(--accent)}
mark{background:var(--mark);color:inherit}
.nav{display:flex;gap:8px;justify-content:space-between;margin-top:32px}
.nav button{flex:1}
.drawer{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.35);display:none}
.drawer.open{display:block}
.panel{position:absolute;inset-block:0;inset-inline-start:0;width:min(88vw,420px);background:var(--surface);
overflow-y:auto;padding:12px;box-shadow:0 0 24px rgba(0,0,0,.2)}
.panel h3{margin:.2em 0 .6em;font-size:16px}
.toc button{display:block;width:100%;text-align:start;border:0;border-radius:8px;padding:8px;min-height:auto;line-height:1.7}
.toc button.current{background:var(--accent-soft);color:var(--accent)}
.toc .sub{display:block;font-size:12px;color:var(--muted)}
.search input{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--border);border-radius:10px;
background:var(--bg);color:var(--text)}
.results button{display:block;width:100%;text-align:start;border:0;border-block-end:1px solid var(--border);
border-radius:0;padding:10px 4px;min-height:auto;line-height:1.8}
.results small{display:block;color:var(--muted)}
.gloss dt{font-weight:700;margin-top:10px}
.gloss dd{margin:0;color:var(--muted)}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:40px;line-height:1.8}
.flash{animation:flash 1.6s ease-out}
@keyframes flash{from{background:var(--mark)}to{background:transparent}}
`;

export const OFFLINE_JS = `
(function(){
  var B = JSON.parse(document.getElementById('book').textContent);
  var S = JSON.parse(document.getElementById('strings').textContent);
  var KEY = 'dozabaneh-offline:' + B.id;
  var st = { id: B.toc.length ? B.toc[0].id : null, mode: 'tgt', size: 17, theme: 'auto' };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) for (var k in saved) st[k] = saved[k]; } catch (e) {}
  if (!B.sections[st.id]) st.id = B.toc.length ? B.toc[0].id : null;
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  var $ = function(id){ return document.getElementById(id); };
  function t(key, vars){ var s = S[key] || key; for (var v in (vars || {})) s = s.split('{{' + v + '}}').join(vars[v]); return s; }
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function applyPrefs(){
    document.documentElement.style.setProperty('--fs', st.size + 'px');
    if (st.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', st.theme);
    ['tgt','both','src'].forEach(function(m){ $('mode-' + m).setAttribute('aria-pressed', String(st.mode === m)); });
  }

  function rowHtml(r, i){
    var type = r[0], src = r[1], tgt = r[2];
    var srcP = '<p class="src" lang="' + B.lang.src + '" dir="' + B.lang.srcDir + '">' + src + '</p>';
    if (type === 'code') srcP = '<pre dir="ltr">' + src + '</pre>';
    var tgtP = tgt ? '<p class="tgt" lang="' + B.lang.tgt + '" dir="' + B.lang.tgtDir + '">' + tgt + '</p>' : '';
    var body;
    if (st.mode === 'src' || type === 'code') body = srcP.replace('class="src"', 'class="src" style="color:inherit;font-size:1em"');
    else if (st.mode === 'tgt') body = tgt ? tgtP : '<span class="badge">' + esc(S.untranslated) + '</span>' + srcP.replace('class="src"', 'class="src untranslated"');
    else body = (tgt ? tgtP : '<span class="badge">' + esc(S.untranslated) + '</span>') + srcP;
    return '<div class="row ' + type + '" id="r' + i + '">' + body + '</div>';
  }

  function show(id, rowIndex){
    var sec = B.sections[id]; if (!sec) return;
    st.id = id; save();
    var pos = B.order.indexOf(id);
    var prev = B.order[pos - 1], next = B.order[pos + 1];
    // The section's own heading row already shows its title.
    var titled = sec.rows.length && sec.rows[0][0] === 'heading';
    var html = (sec.chapter ? '<p class="crumb">' + sec.chapter + '</p>' : '') +
      (titled ? '' : '<h2 class="title" dir="auto">' + sec.title + '</h2>') +
      '<div class="' + (st.mode === 'both' ? 'both' : '') + '">' + sec.rows.map(rowHtml).join('') + '</div>' +
      '<div class="nav">' +
      (prev ? '<button id="prev">' + esc(S.prev) + '</button>' : '<span></span>') +
      (next ? '<button id="next">' + esc(S.next) + '</button>' : '<span></span>') + '</div>' +
      '<footer>' + esc(t('footer', { date: B.exportedAt })) + '<br>' + esc(S.personalUse) + '</footer>';
    var main = $('main'); main.innerHTML = html;
    if (prev) $('prev').onclick = function(){ show(prev); };
    if (next) $('next').onclick = function(){ show(next); };
    renderToc();
    if (rowIndex !== undefined) {
      var el = $('r' + rowIndex);
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
    } else window.scrollTo(0, 0);
  }

  function renderToc(){
    $('toc').innerHTML = B.toc.map(function(n){
      var pad = 'padding-inline-start:' + (8 + n.depth * 14) + 'px';
      var cls = n.id === st.id ? ' class="current"' : '';
      var dis = B.sections[n.id] ? '' : ' disabled';
      return '<button data-id="' + n.id + '" style="' + pad + '"' + cls + dis + '>' + n.label +
        (n.sub ? '<span class="sub" dir="' + B.lang.srcDir + '">' + n.sub + '</span>' : '') + '</button>';
    }).join('');
  }

  function open(id){ $(id).classList.add('open'); }
  function close(id){ $(id).classList.remove('open'); }

  var plain = null;
  function norm(s){ return s.toLowerCase().replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').replace(/[\\u064B-\\u065F\\u0670\\u200c]/g,'').replace(/\\s+/g,' '); }
  function strip(h){ var d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent || ''; }
  function search(q){
    q = norm(q.trim()); var out = [];
    if (q.length < 2) { $('results').innerHTML = ''; return; }
    if (!plain) { plain = []; B.order.forEach(function(id){ B.sections[id].rows.forEach(function(r, i){
      plain.push({ id: id, i: i, src: strip(r[1]), tgt: strip(r[2]) }); }); }); }
    for (var k = 0; k < plain.length && out.length < 100; k++) {
      var p = plain[k], hit = norm(p.tgt).indexOf(q) >= 0 ? p.tgt : norm(p.src).indexOf(q) >= 0 ? p.src : null;
      if (hit) out.push({ p: p, text: hit });
    }
    $('results').innerHTML = out.length ? out.map(function(o, n){
      return '<button data-n="' + n + '" dir="auto">' + esc(o.text.slice(0, 160)) + '<small>' + esc(B.sections[o.p.id].plainTitle) + '</small></button>';
    }).join('') : '<p>' + esc(S.noResults) + '</p>';
    $('results').onclick = function(e){ var b = e.target.closest('button'); if (!b) return; var o = out[+b.dataset.n];
      close('search-drawer'); show(o.p.id, o.p.i); };
  }

  function init(){
    document.title = B.plainTitle;
    $('book-title').innerHTML = B.title;
    $('mode-tgt').textContent = S.modeTarget; $('mode-both').textContent = S.bilingual; $('mode-src').textContent = S.modeSource;
    ['tgt','both','src'].forEach(function(m){ $('mode-' + m).onclick = function(){ st.mode = m; save(); applyPrefs(); show(st.id); }; });
    $('btn-toc').textContent = S.toc; $('btn-toc').onclick = function(){ open('toc-drawer'); };
    $('fab-toc').textContent = S.toc; $('fab-toc').onclick = function(){ open('toc-drawer'); };
    $('btn-search').textContent = S.search; $('btn-search').onclick = function(){ open('search-drawer'); $('q').focus(); };
    $('btn-gloss').textContent = S.glossary; $('btn-gloss').onclick = function(){ open('gloss-drawer'); };
    $('btn-smaller').textContent = 'A−'; $('btn-smaller').title = S.smaller; $('btn-smaller').setAttribute('aria-label', S.smaller);
    $('btn-larger').textContent = 'A+'; $('btn-larger').title = S.larger; $('btn-larger').setAttribute('aria-label', S.larger);
    $('btn-smaller').onclick = function(){ st.size = Math.max(14, st.size - 1); save(); applyPrefs(); };
    $('btn-larger').onclick = function(){ st.size = Math.min(26, st.size + 1); save(); applyPrefs(); };
    $('btn-theme').textContent = S.theme; $('btn-theme').onclick = function(){
      var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (st.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
      st.theme = dark ? 'light' : 'dark'; save(); applyPrefs(); };
    $('toc-title').textContent = S.toc; $('search-title').textContent = S.search; $('gloss-title').textContent = S.glossary;
    $('q').placeholder = S.searchPlaceholder; $('q').oninput = function(){ search(this.value); };
    $('progress').textContent = t('progress', { done: B.counts.done, total: B.counts.total });
    $('gloss').innerHTML = B.glossary.length ? B.glossary.map(function(g){
      return '<dt><span dir="' + B.lang.tgtDir + '">' + g[1] + '</span> · <span dir="' + B.lang.srcDir + '">' + g[0] + '</span></dt>' +
        (g[2] ? '<dd>' + g[2] + '</dd>' : '');
    }).join('') : '<p>' + esc(S.noGlossary) + '</p>';
    $('toc').onclick = function(e){ var b = e.target.closest('button'); if (!b || b.disabled) return; close('toc-drawer'); show(b.dataset.id); };
    Array.prototype.forEach.call(document.querySelectorAll('.drawer'), function(d){
      d.onclick = function(e){ if (e.target === d) d.classList.remove('open'); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function(b){
      b.textContent = S.close; b.onclick = function(){ close(b.getAttribute('data-close')); };
    });
    applyPrefs();
    if (st.id) show(st.id); else $('main').innerHTML = '<p>' + esc(S.empty) + '</p>';
  }
  init();
})();
`;
