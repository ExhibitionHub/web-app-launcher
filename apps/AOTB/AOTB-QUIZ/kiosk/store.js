/*
 * Answer counters. Saved after EVERY answer, so a power cut loses nothing.
 *   - one copy in localStorage (fixed browser profile), one previous copy as backup
 *   - one copy in a file written by the native launcher (when present)
 * At start the copy with the most answers wins. A damaged copy is ignored.
 */
(function (K) {
  'use strict';

  var KEY = 'aotb.quiz.stats.v1';
  var BAK = KEY + '.bak';
  var data = fresh();

  function fresh() {
    return { v: 1, games: 0, q: {} };
  }

  function isCount(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n;
  }

  function clean(o) {
    if (!o || typeof o !== 'object' || o.v !== 1 || !isCount(o.games) || !o.q || typeof o.q !== 'object') return null;
    var out = fresh();
    out.games = o.games;
    for (var id in o.q) {
      if (!Object.prototype.hasOwnProperty.call(o.q, id)) continue;
      var e = o.q[id];
      if (!e || !isCount(e.played) || !isCount(e.correct) || e.correct > e.played) return null;
      out.q[id] = { played: e.played, correct: e.correct };
    }
    return out;
  }

  function total(o) {
    var sum = o.games;
    for (var id in o.q) sum += o.q[id].played;
    return sum;
  }

  function readLocal(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? clean(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  function save() {
    var json = JSON.stringify(data);
    try {
      var previous = window.localStorage.getItem(KEY);
      if (previous && clean(JSON.parse(previous))) window.localStorage.setItem(BAK, previous);
    } catch (e) {
      /* storage unavailable or damaged: keep going with memory and the launcher file */
    }
    try {
      window.localStorage.setItem(KEY, json);
    } catch (e) {
      /* same */
    }
    K.host.post({ t: 'stats', data: data });
  }

  function counts(id, seed) {
    var own = data.q[id] || { played: 0, correct: 0 };
    var s = seed && isCount(seed.played) && isCount(seed.correct) && seed.correct <= seed.played ? seed : { played: 0, correct: 0 };
    return { played: s.played + own.played, correct: s.correct + own.correct };
  }

  K.store = {
    key: KEY,

    init: function (hostStats) {
      var candidates = [clean(hostStats), readLocal(KEY), readLocal(BAK)].filter(Boolean);
      data = candidates.length
        ? candidates.reduce(function (a, b) {
            return total(b) > total(a) ? b : a;
          })
        : fresh();
      save();
    },

    recordAnswer: function (id, correct) {
      var e = data.q[id] || (data.q[id] = { played: 0, correct: 0 });
      e.played += 1;
      if (correct) e.correct += 1;
      save();
    },

    recordGame: function () {
      data.games += 1;
      save();
    },

    games: function () {
      return data.games;
    },

    /** Percent of visitors who got the question right, seed included. null when nothing is known. */
    percent: function (id, seed) {
      var c = counts(id, seed);
      return c.played > 0 ? Math.round((100 * c.correct) / c.played) : null;
    },

    snapshot: function () {
      return JSON.parse(JSON.stringify(data));
    },

    clear: function () {
      data = fresh();
      save();
    },
  };
})((window.Kiosk = window.Kiosk || {}));
