/* Pure interval lane layout shared by Day Timeline and Week overview.
 *
 * layout(blocks, limit, opts) -> [{ lane, laneCount, hidden, nudge }] (same order as `blocks`)
 *   lane     0-based stacking depth inside a cluster of overlapping blocks
 *   hidden   true when lane >= limit  (the grid shows these through a "+N more" chip)
 *   nudge    0-3: how many earlier, still-covering cards start so close to this one that
 *            its title would be hidden. The grid pushes the card down a few px per step
 *            so every title stays readable in the "stacked deck of cards".
 *   opts.minGapMin  minutes of height a title needs (grid passes ~16px / px-per-minute)
 */
(function (root) {
  'use strict';
  function layout(blocks, limit, opts) {
    const cap = Number.isInteger(limit) && limit > 0 ? limit : Infinity;
    const gap = opts && opts.minGapMin > 0 ? opts.minGapMin : 0;
    const sorted = blocks.map((b, i) => ({ ...b, _i: i })).sort((a,b) => a.startMin-b.startMin || a.endMin-b.endMin);
    const result = new Array(blocks.length);
    let cluster = [], clusterEnd = -Infinity;
    function flush() {
      if (!cluster.length) return;
      const laneEnds = [];
      cluster.forEach((b) => {
        let lane = laneEnds.findIndex(end => end <= b.startMin);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(b.endMin); }
        else laneEnds[lane] = b.endMin;
        result[b._i] = { lane, laneCount: laneEnds.length, hidden: lane >= cap, nudge: 0 };
      });
      const laneCount = Math.min(laneEnds.length, cap);
      cluster.forEach(b => { result[b._i].laneCount = laneCount; });
      if (gap) cluster.forEach((b, k) => {
        const r = result[b._i];
        if (r.hidden) return;
        let n = 0;
        for (let j = 0; j < k; j++) {
          const p = cluster[j], pr = result[p._i];
          if (!pr.hidden && p.endMin > b.startMin && b.startMin - p.startMin < gap) n++;
        }
        r.nudge = Math.min(n, 3);
      });
      cluster = []; clusterEnd = -Infinity;
    }
    sorted.forEach(b => {
      if (cluster.length && b.startMin >= clusterEnd) flush();
      cluster.push(b); clusterEnd = Math.max(clusterEnd, b.endMin);
    });
    flush();
    return result;
  }
  root.MCLanes = Object.freeze({ layout });
})(window);
