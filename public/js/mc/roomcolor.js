/* One stable colour per room type (Section 5).
 *
 * The colour is a CSS class (.mc-rt-0 … .mc-rt-11, .mc-rt-n for "no type"); the palette itself lives in
 * master-calendar.css, so this file only decides WHICH slot a type gets.
 *
 * Stability: a type's slot comes from a hash of its normalised name ("Computer Lab" and "computer lab "
 * are the same type), so it never changes with filters, paging or what is on screen. When two types
 * hash to the same slot, they are resolved in alphabetical order over the full room list, so every
 * viewer sees the same colours.
 */
(function (root) {
  'use strict';
  const SLOTS = 12;
  const norm = t => String(t == null ? '' : t).trim().toLowerCase();
  const slots = new Map();           // normalised type -> slot
  const labels = new Map();          // normalised type -> display spelling (most common)

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h % SLOTS;
  }

  /** Call whenever the full room list is (re)loaded. */
  function register(rooms) {
    const count = new Map();
    (rooms || []).forEach(r => {
      const k = norm(r.room_type);
      if (!k) return;
      const shown = String(r.room_type).trim();
      const c = count.get(k) || { n: 0, sp: new Map() };
      c.n++; c.sp.set(shown, (c.sp.get(shown) || 0) + 1); count.set(k, c);
    });
    slots.clear(); labels.clear();
    const taken = new Set();
    [...count.keys()].sort().forEach(k => {
      let s = hash(k), tries = 0;
      while (taken.has(s) && tries++ < SLOTS) s = (s + 1) % SLOTS;
      taken.add(s); slots.set(k, s);
      labels.set(k, [...count.get(k).sp.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    });
  }

  /** CSS class for a room type (or a group key; '_none' and '' mean "no type"). */
  function cls(type) {
    const k = norm(type);
    if (!k || k === '_none') return 'mc-rt-n';
    if (!slots.has(k)) slots.set(k, hash(k));        // a type that appeared after register(): still stable
    return 'mc-rt-' + slots.get(k);
  }

  /** [{ key, label, cls }] for every registered type, alphabetical, for the legend. */
  function legend() {
    return [...slots.keys()].filter(k => labels.has(k)).sort((a, b) => labels.get(a).localeCompare(labels.get(b)))
      .map(k => ({ key: k, label: labels.get(k), cls: cls(k) }));
  }

  root.MCRoomColor = Object.freeze({ register, cls, legend });
})(window);
