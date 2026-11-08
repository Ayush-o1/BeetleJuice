import { api } from './api.js';
import { h } from './dom.js';
import { startRouter } from './router.js';
import { session, setSession, renderShell, renderLogin, renderUnavailable, toast } from './shell.js';
import './views/overview.js';
import './views/sources.js';
import './views/runs.js';
import './views/breaks.js';
import './views/review.js';
import './views/audit.js';
import './views/settings.js';
import './views/trace.js';

const root = document.getElementById('app');

let loginMessage = null;
let refreshNav = () => {};
window.addEventListener('bj:refresh-nav', () => refreshNav());

function showLogin() {
  renderLogin(root, {
    message: loginMessage,
    onSuccess: (data) => { loginMessage = null; setSession(data); location.hash = '#/'; showApp(); },
  });
  loginMessage = null;
}

function showApp() {
  const shell = renderShell(root, {
    onSignOut: async () => {
      try { await api.post('/api/auth/logout'); } catch { /* session may already be gone */ }
      session.user = null;
      showLogin();
    },
  });
  startRouter({
    container: shell.main,
    resolveUser: () => session,
    onRoute: ({ nav }) => shell.setActive(nav),
    notFound: (c) => renderUnavailable(c, 'Page not found', 'That address does not match anything in BeetleJuice.'),
    forbidden: (c) => renderUnavailable(c, 'Not available for your role', 'Your role does not include access to this page.'),
  });
  refreshNav = shell.refreshReviewCount;
}

window.addEventListener('bj:session-expired', () => {
  if (!session.user) return;
  session.user = null;
  loginMessage = 'Your session has ended. Sign in again to continue.';
  showLogin();
});

(async () => {
  try {
    const res = await api.get('/api/auth/session');
    if (res.data) { setSession(res.data); showApp(); } else showLogin();
  } catch {
    showLogin();
  }
})();

export { h, toast };
