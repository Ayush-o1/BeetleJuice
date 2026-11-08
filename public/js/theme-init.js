/* Runs synchronously from <head>, before first paint, so a dark-mode user never sees a flash of the light theme.
   Classic script on purpose (no module deferral). It is an external file because the CSP forbids inline script.
   Preference is 'system' | 'light' | 'dark'; the resolved value is always written to <html data-theme>. */
(function () {
  var root = document.documentElement;
  var KEY = 'bj.theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function read() {
    try { var v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch (e) { /* storage blocked */ }
    return 'system';
  }
  function apply(pref) {
    var resolved = pref === 'system' ? (mq && mq.matches ? 'dark' : 'light') : pref;
    root.dataset.theme = resolved;
    root.dataset.themePref = pref;
  }
  apply(read());
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (root.dataset.themePref === 'system') apply('system'); });
  try { var d = localStorage.getItem('bj.density'); if (d === 'compact' || d === 'comfortable') root.dataset.density = d; } catch (e) { /* storage blocked */ }
  window.bjTheme = {
    get: function () { return root.dataset.themePref || 'system'; },
    set: function (pref) {
      try { localStorage.setItem(KEY, pref); } catch (e) { /* storage blocked: still apply for this page view */ }
      apply(pref);
      window.dispatchEvent(new CustomEvent('bj:theme', { detail: pref }));
    },
  };
})();
