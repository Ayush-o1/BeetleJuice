/* The skip link is a plain "#main" anchor so it works without JavaScript, but with a hash router that anchor would be
   read as a route and replace the page with "Not found". This classic script runs from <head>, so it is in place before
   any key can be pressed (a module would load later), and uses delegation because the link is parsed after it. */
document.addEventListener('click', function (e) {
  var link = e.target && e.target.closest ? e.target.closest('a.skip-link') : null;
  if (!link) return;
  e.preventDefault();
  var main = document.getElementById('main');
  if (main) main.focus();
});
