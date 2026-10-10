/* Pure interval lane layout shared by Day Timeline and Week overview. */
(function (root) {
  'use strict';
  function layout(blocks, limit) {
    const cap = Number.isInteger(limit) && limit > 0 ? limit : Infinity;
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
        result[b._i] = { lane, laneCount: laneEnds.length, hidden: lane >= cap };
      });
      const laneCount = Math.min(laneEnds.length, cap);
      cluster.forEach(b => { result[b._i].laneCount = laneCount; });
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
