/**
 * CampusRoom — Facility Use Handbook
 *
 * Renders University Administrative Order No. 2026-03 — the reservation rules —
 * as a readable, searchable document. This powers handbook.html; it is NOT
 * loaded by the dashboard.
 *
 * Usage — handbook.html carries the mount point and three scripts, in order:
 *   <div id="crHandbookMount"></div>
 *   <script src="js/vendor/marked.umd.js"></script>
 *   <script src="js/util.js"></script>
 *   <script src="js/handbook.js"></script>
 *
 * SINGLE SOURCE OF TRUTH
 *   The Order's text lives in exactly one place:
 *   public/Business_Rules_Room_Reservations.md. This file fetches it at
 *   runtime and holds NO copy. An earlier version embedded the text, which
 *   meant two copies of a governing document — and they drifted, which is how
 *   an Article nobody had approved reached the screen.
 *
 * MARKDOWN IS PARSED BY marked, NOT BY US
 *   An intermediate version replaced the embedded copy with hand-written
 *   regular expressions. That moved the same risk rather than removing it: a
 *   custom parser that drops a clause, renders a fenced code block as plain
 *   text, or leaks a `**` marker produces exactly the silent divergence this
 *   design exists to prevent. All Markdown→HTML conversion is now done by
 *   marked (see js/vendor/README.md). What remains here is a purely
 *   STRUCTURAL pass over marked's output — splitting on <h2> so the contents
 *   rail, per-article search and deep links work. It parses nothing.
 *
 *   Presentation extras below (the at-a-glance shortcuts, which paragraph gets
 *   a warning rule) key off article ids and add no words to the Order.
 *
 * TRUST BOUNDARY
 *   The Order is a first-party repository file, so marked runs with raw HTML
 *   passthrough (the document contains <br>). If it ever becomes user-editable,
 *   add a sanitiser before rendering.
 */
(function () {
  'use strict';

  if (!window.CampusRoomUtil) {
    console.error('[handbook] js/util.js must be loaded before js/handbook.js');
    return;
  }

  const { escapeHtml } = window.CampusRoomUtil;

  const STYLE_ID = 'crHandbookStyles';
  const MOUNT_ID = 'crHandbookMount';
  const SOURCE_URL = 'Business_Rules_Room_Reservations.md';
  // Height of the page's fixed header, so a jumped-to article clears it.
  const HEADER_OFFSET = 76;

  // ---------------------------------------------------------------
  // Presentation config — pointers into the Order, never text from it
  // ---------------------------------------------------------------

  /** [icon, label, blurb, target article id] */
  const AT_A_GLANCE = [
    ['schedule', 'Open 7:30 AM – 9:00 PM', 'Monday to Saturday. Closed Sundays and on listed holidays.', 'v'],
    ['event_busy', 'Cancelling an approved booking', 'File a Cancellation Request — and not on the day itself.', 'x'],
    ['edit_calendar', 'Changing the date or time', 'File a Move Request. One open request at a time.', 'ix'],
    ['school', 'Classes always win', 'A room in class cannot be booked during that slot.', 'vi'],
    ['delete_sweep', 'Removing a booking', 'Hides it from your list only. Staff keep the record.', 'xii'],
    ['person', 'You are accountable', 'One booking, one requestor — including for your guests.', 'xiv']
  ];

  /** Paragraphs to show with a warning rule: { articleId: [leading text, …] }. */
  const FLAGGED = { 'x': ['Section 3.'] };

  // ---------------------------------------------------------------
  // Structural pass over marked's output
  //
  // Classifies by TAG, not by matching rule text, so re-wording the Order
  // cannot break the layout. Splits the document into:
  //   front    — everything before the first <h2> (letterhead, number, title,
  //              the WHEREAS preamble)
  //   articles — one per <h2>
  //   closing  — the APPROVED / BY ORDER block, which follows the last Article
  //              but belongs to the Order as a whole, not to that Article
  // ---------------------------------------------------------------

  /** "ARTICLE IV-A" -> "iv-a" */
  function idFor(numText) {
    return String(numText)
      .replace(/^ARTICLE\s+/i, '')
      .trim().toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function structure(html) {
    const holder = document.createElement('div');
    holder.innerHTML = html;

    const front = [], articles = [], closing = [];
    let current = null;

    Array.from(holder.children).forEach(node => {
      if (node.tagName === 'HR') return;               // we draw our own rules

      if (node.tagName === 'H2') {
        const text = node.textContent.trim();
        const dash = text.indexOf('—');           // em dash
        const num = (dash === -1 ? text : text.slice(0, dash)).trim();
        const heading = dash === -1 ? '' : text.slice(dash + 1).trim();
        const entry = { id: idFor(num), num, heading, nodes: [] };
        articles.push(entry);
        current = entry;
        return;
      }

      if (!current) { front.push(node); return; }

      // "APPROVED, this 20th day of…" closes the Order. Without this it would
      // render as though it were part of the final Article.
      if (!current.isClosing &&
          node.tagName === 'P' && /^APPROVED\b/.test(node.textContent.trim())) {
        current = { nodes: closing, isClosing: true };
      }

      current.nodes.push(node);
    });

    return { front, articles, closing };
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  let DOC = null;       // the structured document
  let root = null;
  let searchInput = null;
  let scrollSpy = null;

  /** Move parsed nodes into a container, preserving marked's markup exactly. */
  function adopt(container, nodes) {
    nodes.forEach(n => container.appendChild(n));
    return container;
  }

  function buildFront() {
    const wrap = document.createElement('div');
    const nodes = DOC.front;

    const h1 = nodes.find(n => n.tagName === 'H1');
    const h3 = nodes.find(n => n.tagName === 'H3');
    const paras = nodes.filter(n => n.tagName === 'P');
    const letterhead = paras[0] || null;
    const preamble = paras.slice(letterhead ? 1 : 0);

    const head = document.createElement('div');
    head.className = 'cr-hb-letterhead';
    head.innerHTML = '<div class="cr-hb-seal" aria-hidden="true">' +
      '<span class="material-symbols-outlined">account_balance</span></div>';
    if (letterhead) {
      letterhead.className = 'cr-hb-inst';
      head.appendChild(letterhead);
    }
    wrap.appendChild(head);

    if (h1) {
      const num = document.createElement('div');
      num.className = 'cr-hb-ordernum';
      num.textContent = h1.textContent.trim();
      wrap.appendChild(num);
    }
    if (h3) {
      const title = document.createElement('h1');
      title.className = 'cr-hb-title';
      title.textContent = h3.textContent.trim();
      wrap.appendChild(title);
    }

    wrap.appendChild(glanceEl());

    if (preamble.length) {
      const pre = document.createElement('div');
      pre.className = 'cr-hb-preamble';
      adopt(pre, preamble);
      wrap.appendChild(pre);
    }
    return wrap;
  }

  function glanceEl() {
    const known = AT_A_GLANCE.filter(([, , , id]) => DOC.articles.some(a => a.id === id));
    const box = document.createElement('div');
    box.className = 'cr-hb-glance';
    box.id = 'cr-hb-glance';
    if (!known.length) { box.hidden = true; return box; }

    box.innerHTML =
      '<h2 class="cr-hb-glance-h">At a glance</h2>' +
      '<div class="cr-hb-glance-grid">' +
      known.map(([icon, title, body, target]) =>
        `<button type="button" class="cr-hb-glance-card" data-goto="${escapeHtml(target)}">
           <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(icon)}</span>
           <span class="cr-hb-glance-t">${escapeHtml(title)}</span>
           <span class="cr-hb-glance-b">${escapeHtml(body)}</span>
         </button>`).join('') +
      '</div><p class="cr-hb-glance-note">A summary for convenience. The Articles below are what govern.</p>';
    return box;
  }

  function articleEl(article) {
    const sec = document.createElement('section');
    sec.className = 'cr-hb-article';
    sec.id = 'cr-hb-' + article.id;
    sec.dataset.article = article.id;

    const num = document.createElement('h2');
    num.className = 'cr-hb-art-num';
    num.textContent = article.num;
    sec.appendChild(num);

    if (article.heading) {
      const h = document.createElement('h3');
      h.className = 'cr-hb-art-heading';
      h.textContent = article.heading;
      sec.appendChild(h);
    }

    adopt(sec, article.nodes);

    // Warning rule on named paragraphs (presentation only).
    (FLAGGED[article.id] || []).forEach(lead => {
      Array.from(sec.querySelectorAll('p')).forEach(p => {
        if (p.textContent.trim().startsWith(lead)) p.classList.add('cr-hb-sec-flag');
      });
    });

    return sec;
  }

  function buildDocument() {
    const page = document.createElement('article');
    page.className = 'cr-hb-page';

    page.appendChild(buildFront());
    DOC.articles.forEach(a => page.appendChild(articleEl(a)));

    if (DOC.closing.length) {
      const close = document.createElement('div');
      close.className = 'cr-hb-approval';
      adopt(close, DOC.closing);
      page.appendChild(close);
    }

    const none = document.createElement('p');
    none.className = 'cr-hb-noresults';
    none.id = 'cr-hb-noresults';
    none.hidden = true;
    none.textContent = 'Nothing in the Order matches that search.';
    page.appendChild(none);

    return page;
  }

  function tocHtml() {
    return DOC.articles.map(a =>
      `<button type="button" class="cr-hb-toc-item" data-goto="${escapeHtml(a.id)}">
         <span class="cr-hb-toc-num">${escapeHtml(a.num.replace(/^ARTICLE\s+/i, ''))}</span>
         <span class="cr-hb-toc-text">${escapeHtml(a.heading)}</span>
       </button>`).join('');
  }

  // ---------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------

  const cssId = v => String(v).replace(/[^a-zA-Z0-9_-]/g, '');

  function goTo(id) {
    if (!root) return;
    const target = root.querySelector('#cr-hb-' + cssId(id));
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    markActive(id);
  }

  function markActive(id) {
    root.querySelectorAll('.cr-hb-toc-item').forEach(b => {
      b.classList.toggle('is-active', b.dataset.goto === id);
    });
  }

  function highlightVisible() {
    if (!root) return;
    const marker = Math.max(HEADER_OFFSET + 24, window.innerHeight * 0.3);
    let current = null;
    let nearest = null;
    let nearestDistance = Infinity;
    root.querySelectorAll('.cr-hb-article').forEach(sec => {
      if (sec.hidden) return;
      const rect = sec.getBoundingClientRect();
      if (rect.top <= marker && rect.bottom > marker) {
        current = sec.dataset.article;
      }
      const distance = Math.abs(rect.top - marker);
      if (distance < nearestDistance) {
        nearest = sec.dataset.article;
        nearestDistance = distance;
      }
    });
    if (current || nearest) markActive(current || nearest);
  }

  /**
   * Filter by article. Matching is on the article's whole text, so a search for
   * "cancel" keeps Article X intact rather than showing loose sentences — the
   * surrounding sections are usually what the reader actually needs.
   */
  function applySearch(term) {
    if (!root) return;
    const q = String(term || '').trim().toLowerCase();
    const chrome = ['.cr-hb-letterhead', '.cr-hb-ordernum', '.cr-hb-title', '.cr-hb-preamble', '.cr-hb-approval', '.cr-hb-glance'];
    let shown = 0;

    root.querySelectorAll('.cr-hb-article').forEach(sec => {
      const hit = !q || sec.textContent.toLowerCase().includes(q);
      sec.hidden = !hit;
      if (hit) shown++;
    });

    chrome.forEach(sel => {
      const el = root.querySelector(sel);
      if (el) el.hidden = !!q;
    });

    root.querySelectorAll('.cr-hb-toc-item').forEach(b => {
      const sec = root.querySelector('#cr-hb-' + cssId(b.dataset.goto));
      b.hidden = !!q && sec && sec.hidden;
    });

    const none = root.querySelector('#cr-hb-noresults');
    if (none) none.hidden = shown !== 0;
  }

  // ---------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------

  function renderState(message, kind) {
    root.innerHTML = `<div class="cr-hb-state cr-hb-state-${kind}">
        <span class="material-symbols-outlined" aria-hidden="true">${kind === 'error' ? 'error' : 'hourglass_top'}</span>
        <p>${escapeHtml(message)}</p>
        ${kind === 'error' ? `<p class="cr-hb-state-sub">You can still read the Order directly: <a href="${SOURCE_URL}">${escapeHtml(SOURCE_URL)}</a></p>` : ''}
      </div>`;
  }

  function renderDocument() {
    root.innerHTML = `
      <div class="cr-hb-toolbar">
        <div class="cr-hb-toolbar-title">
          <span class="material-symbols-outlined" aria-hidden="true">menu_book</span>
          <div>
            <div class="cr-hb-toolbar-h">Facility Use Handbook</div>
            <div class="cr-hb-toolbar-sub" id="crHbOrderNo"></div>
          </div>
        </div>
        <div class="cr-hb-toolbar-tools">
          <div class="cr-hb-search">
            <span class="material-symbols-outlined" aria-hidden="true">search</span>
            <input type="search" id="crHbSearch" placeholder="Search the Order…" aria-label="Search the Order">
          </div>
          <button type="button" class="cr-hb-icon" id="crHbPrint" title="Print the Order" aria-label="Print the Order">
            <span class="material-symbols-outlined">print</span>
          </button>
        </div>
      </div>
      <div class="cr-hb-body">
        <nav class="cr-hb-toc" aria-label="Contents">
          <div class="cr-hb-toc-h">Contents</div>
          ${tocHtml()}
        </nav>
        <div class="cr-hb-doc" id="crHbDoc"></div>
      </div>`;

    root.querySelector('#crHbDoc').appendChild(buildDocument());

    const orderNo = root.querySelector('.cr-hb-ordernum');
    root.querySelector('#crHbOrderNo').textContent = orderNo ? orderNo.textContent : '';

    searchInput = root.querySelector('#crHbSearch');
    root.querySelector('#crHbPrint').addEventListener('click', () => window.print());
    root.addEventListener('click', (e) => {
      const jump = e.target.closest('[data-goto]');
      if (jump) goTo(jump.dataset.goto);
    });
    searchInput.addEventListener('input', () => applySearch(searchInput.value));

    window.addEventListener('scroll', () => {
      window.clearTimeout(scrollSpy);
      scrollSpy = window.setTimeout(highlightVisible, 80);
    }, { passive: true });

    const fragment = (window.location.hash || '').replace(/^#article-/, '');
    if (fragment) window.setTimeout(() => goTo(fragment), 50);
    else if (DOC.articles.length) markActive(DOC.articles[0].id);
  }

  function mount(target) {
    const host = target || document.getElementById(MOUNT_ID);
    if (!host || root) return Promise.resolve();

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    root = host;
    root.classList.add('cr-hb-root');
    renderState('Loading the Order…', 'loading');

    if (!window.marked || typeof window.marked.parse !== 'function') {
      renderState('The Markdown renderer did not load. Check js/vendor/marked.umd.js.', 'error');
      return Promise.resolve();
    }

    // Decoded explicitly: a .md may be served without a charset, and the Order
    // is full of em dashes and curly quotes that would otherwise mojibake.
    return fetch(SOURCE_URL, { credentials: 'same-origin' })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(buf => {
        const markdown = new TextDecoder('utf-8').decode(buf);
        // breaks:true keeps the Order's single-newline lists (the "(i) …"
        // items) on separate lines instead of collapsing them into a run-on.
        const html = window.marked.parse(markdown, { gfm: true, breaks: true });
        DOC = structure(html);
        if (!DOC.articles.length) throw new Error('no articles found in the source document');
        renderDocument();
      })
      .catch(err => {
        console.error('[handbook] could not load the Order:', err);
        renderState('The Order could not be loaded (' + err.message + ').', 'error');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount());
  } else {
    mount();
  }

  // ---------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------

  const CSS = `
    .cr-hb-root { display: block; font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: #1a1c1e; }
    .cr-hb-root *, .cr-hb-root *::before, .cr-hb-root *::after { box-sizing: border-box; }

    .cr-hb-state { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
      padding: 60px 24px; background: #fff; border: 1px solid #e6e3e1; border-radius: 10px; color: #6b635e; }
    .cr-hb-state .material-symbols-outlined { font-size: 34px; }
    .cr-hb-state p { margin: 0; font-size: 13.5px; }
    .cr-hb-state-error { color: #93000a; border-color: #f3c9c6; background: #fdf4f3; }
    .cr-hb-state-sub { font-size: 12.5px; color: #6b635e; }
    .cr-hb-state-sub a { color: #7A1F2B; }

    .cr-hb-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding: 10px 16px; background: #7A1F2B; color: #fff; border-radius: 10px 10px 0 0; }
    .cr-hb-toolbar-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .cr-hb-toolbar-title .material-symbols-outlined { font-size: 26px; }
    .cr-hb-toolbar-h { font-size: 15px; font-weight: 700; line-height: 1.2; }
    .cr-hb-toolbar-sub { font-size: 11.5px; opacity: .82; line-height: 1.3; }
    .cr-hb-toolbar-tools { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

    .cr-hb-search { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,.14);
      border-radius: 6px; padding: 5px 9px; }
    .cr-hb-search .material-symbols-outlined { font-size: 17px; opacity: .85; }
    .cr-hb-search input { background: transparent; border: 0; outline: none; color: #fff; font: 400 13px Inter, sans-serif; width: 190px; }
    .cr-hb-search input::placeholder { color: rgba(255,255,255,.7); }

    .cr-hb-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 0; border-radius: 6px; background: transparent; color: #fff; cursor: pointer; }
    .cr-hb-icon:hover { background: rgba(255,255,255,.16); }
    .cr-hb-icon:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }

    .cr-hb-body { display: flex; align-items: flex-start; background: #fff;
      border: 1px solid #e6e3e1; border-top: 0; border-radius: 0 0 10px 10px; overflow: visible; }

    .cr-hb-toc { width: 236px; flex-shrink: 0; border-right: 1px solid #e6e3e1; background: #faf9f8;
      padding: 12px 8px 24px; position: sticky; top: ${HEADER_OFFSET}px;
      max-height: calc(100vh - ${HEADER_OFFSET}px); overflow-y: auto; align-self: flex-start; }
    .cr-hb-toc-h { font-size: 10.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
      color: #7d7671; padding: 4px 10px 8px; }
    .cr-hb-toc-item { display: flex; gap: 9px; width: 100%; text-align: left; align-items: baseline;
      padding: 7px 10px; border: 0; background: transparent; border-radius: 6px; cursor: pointer;
      font: 400 12.5px/1.35 Inter, sans-serif; color: #44403c; }
    .cr-hb-toc-item:hover { background: #efebe8; }
    .cr-hb-toc-item.is-active { background: #f3e2e4; color: #7A1F2B; font-weight: 600; }
    .cr-hb-toc-item:focus-visible { outline: 2px solid #7A1F2B; outline-offset: -2px; }
    .cr-hb-toc-num { flex-shrink: 0; width: 34px; font-weight: 700; font-size: 11px; color: #9a8f88; letter-spacing: .03em; }
    .cr-hb-toc-item.is-active .cr-hb-toc-num { color: #7A1F2B; }

    .cr-hb-doc { flex: 1; min-width: 0; background: #f1efed; padding: 22px 16px 40px; }
    .cr-hb-page { max-width: 760px; margin: 0 auto; background: #fff; padding: 44px 56px 56px;
      box-shadow: 0 2px 10px rgba(0,0,0,.07); }

    .cr-hb-letterhead { text-align: center; padding-bottom: 14px; }
    .cr-hb-seal { width: 46px; height: 46px; margin: 0 auto 10px; border: 2px solid #7A1F2B; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; color: #7A1F2B; }
    .cr-hb-seal .material-symbols-outlined { font-size: 24px; }
    .cr-hb-inst { font-size: 12px; font-weight: 700; letter-spacing: .06em; margin: 0; line-height: 1.7; }

    .cr-hb-ordernum { text-align: center; font-size: 14px; font-weight: 700; letter-spacing: .04em;
      margin: 20px 0 8px; padding-top: 14px; border-top: 2px solid #1a1c1e; }
    .cr-hb-title { text-align: center; font-size: 13.5px; font-weight: 600; line-height: 1.5;
      margin: 0 0 22px; color: #3a3532; }

    .cr-hb-glance { background: #faf7f3; border: 1px solid #e8e0d6; border-radius: 8px; padding: 14px 16px 12px; margin: 0 0 26px; }
    .cr-hb-glance-h { font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
      color: #8a6d3b; margin: 0 0 10px; }
    .cr-hb-glance-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(198px, 1fr)); gap: 8px; }
    .cr-hb-glance-card { display: grid; grid-template-columns: 20px 1fr; grid-template-rows: auto auto;
      gap: 1px 9px; text-align: left; padding: 9px 10px; border: 1px solid #ece5db; border-radius: 6px;
      background: #fff; cursor: pointer; font-family: inherit; }
    .cr-hb-glance-card:hover { border-color: #d9c9b4; background: #fffdfa; }
    .cr-hb-glance-card:focus-visible { outline: 2px solid #7A1F2B; outline-offset: 1px; }
    .cr-hb-glance-card .material-symbols-outlined { grid-row: 1 / span 2; font-size: 19px; color: #7A1F2B; }
    .cr-hb-glance-t { font-size: 12.5px; font-weight: 700; color: #2b2724; }
    .cr-hb-glance-b { font-size: 11.5px; line-height: 1.4; color: #6b635e; }
    .cr-hb-glance-note { font-size: 11px; color: #8a8079; margin: 10px 0 0; font-style: italic; }

    .cr-hb-preamble p { font-size: 13px; line-height: 1.72; text-align: justify; margin: 0 0 12px; color: #2f2b28; }
    .cr-hb-preamble { margin: 0 0 26px; }

    .cr-hb-article { padding-top: 6px; margin-bottom: 26px; scroll-margin-top: ${HEADER_OFFSET + 12}px; }
    .cr-hb-art-num { font-size: 12.5px; font-weight: 700; letter-spacing: .11em; color: #7A1F2B;
      margin: 0; text-align: center; }
    .cr-hb-art-heading { font-size: 13px; font-weight: 700; letter-spacing: .05em; text-align: center;
      margin: 3px 0 15px; color: #1a1c1e; }
    .cr-hb-article + .cr-hb-article { border-top: 1px solid #ece9e7; padding-top: 22px; }

    /* Body copy produced by marked */
    .cr-hb-article p { font-size: 13px; line-height: 1.72; text-align: justify; margin: 0 0 12px; color: #2f2b28; }
    .cr-hb-article strong { font-weight: 700; }
    .cr-hb-article em { font-style: italic; }
    .cr-hb-article ol, .cr-hb-article ul { margin: 8px 0 12px; padding-left: 30px; }
    .cr-hb-article li { font-size: 13px; line-height: 1.68; margin-bottom: 4px; color: #2f2b28; }
    .cr-hb-article a { color: #7A1F2B; }

    .cr-hb-sec-flag { border-left: 3px solid #b3261e; background: #fdf4f3;
      padding: 9px 12px; border-radius: 0 5px 5px 0; }

    .cr-hb-approval { margin: 32px 0 0; padding-top: 18px; border-top: 1px solid #ece9e7; }
    .cr-hb-approval p { font-size: 12.5px; font-weight: 600; line-height: 1.6; margin: 0 0 18px; }

    .cr-hb-article code { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
      font-size: 11.5px; background: #e9e9ec; padding: 1px 5px; border-radius: 3px; }
    .cr-hb-article pre { background: #1f1f23; color: #e4e4e7; padding: 12px 14px; border-radius: 6px;
      overflow-x: auto; margin: 8px 0 14px; }
    .cr-hb-article pre code { display: block; font-size: 11px; line-height: 1.55;
      background: none; color: inherit; padding: 0; border-radius: 0; white-space: pre; }

    .cr-hb-noresults { text-align: center; font-size: 13px; color: #6b635e; padding: 30px 0; }

    @media (max-width: 1024px) {
      .cr-hb-body { flex-direction: column; }
      .cr-hb-toc { width: 100%; position: static; max-height: none; border-right: 0;
        border-bottom: 1px solid #e6e3e1; display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; }
      .cr-hb-toc-h { width: 100%; padding: 2px 4px 4px; }
      .cr-hb-toc-item { width: auto; padding: 5px 9px; border: 1px solid #e6e3e1; background: #fff; }
      .cr-hb-toc-text { display: none; }
      .cr-hb-toc-num { width: auto; }
      .cr-hb-doc { padding: 12px 8px 32px; }
      .cr-hb-page { padding: 24px 20px 32px; }
      .cr-hb-toolbar { flex-wrap: wrap; }
      .cr-hb-search input { width: 120px; }
    }

    /* Print the Order alone — no app chrome, no contents rail, no summary. */
    @media print {
      body { background: #fff !important; }
      aside, header { display: none !important; }
      body > div { padding-left: 0 !important; }
      main { padding: 0 !important; min-height: 0 !important; }
      .cr-hb-toolbar, .cr-hb-toc, .cr-hb-glance { display: none !important; }
      .cr-hb-body { display: block; border: 0; }
      .cr-hb-doc { background: #fff; padding: 0; }
      .cr-hb-page { max-width: none; box-shadow: none; padding: 0; }
      .cr-hb-article { page-break-inside: avoid; }
      .cr-hb-article[hidden] { display: none; }
      .cr-hb-article pre { background: #f4f4f5; color: #18181b; border: 1px solid #d4d4d8; }
    }
  `;

  window.CampusRoomHandbook = Object.freeze({ mount, goTo, search: applySearch, structure });
})();
