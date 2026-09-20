# Vendored third-party libraries

Committed here rather than pulled from a CDN so the handbook page keeps working
offline and on the campus network, and so the exact bytes we ship are the exact
bytes in version control.

## marked.umd.js

| | |
|---|---|
| Library | [marked](https://github.com/markedjs/marked) |
| Version | 18.0.13 |
| Licence | MIT — see `marked.LICENSE` |
| Build | `lib/marked.umd.js` from the npm package, **byte-for-byte unmodified** |
| Used by | `js/handbook.js`, to render `Business_Rules_Room_Reservations.md` |

### Why a library and not our own parser

`handbook.js` originally parsed the Order with hand-written regular
expressions. That is the same class of risk the single-source rewrite was meant
to remove: a custom parser that drops a clause, renders a code fence as plain
text, or leaks a `**` marker produces silent divergence between what the
document says and what people read — the failure simply moves from "two files
disagree" to "the renderer misreads the one file".

marked is tested against the CommonMark and GFM suites. `handbook.js` now uses
it for all Markdown→HTML conversion and keeps only a small **structural** pass
over the resulting DOM (splitting on `<h2>` into Articles for the contents rail
and deep links), which adds no parsing of its own.

### Upgrading

Replace the file with a newer `lib/marked.umd.js`, update the version above,
and re-run the handbook suite — it asserts that every non-empty line of the
Order reaches the rendered page, so a regression in rendering fails the build
rather than going unnoticed.

### Trust boundary

The Order is a first-party file in this repository, so marked runs with raw
HTML passthrough enabled (the document itself contains `<br>`). That is safe
only while the source stays first-party. **If the Order ever becomes editable
by users, add a sanitiser (e.g. DOMPurify) before rendering.**
