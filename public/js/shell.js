import { h, clear } from './dom.js';
import { icon, brandMark } from './icons.js';
import { api, setCsrfToken } from './api.js';
import { button, badge, withBusy, toast, field, alertBox } from './ui.js';
import { ROLES } from './format.js';

export const session = { user: null, permissions: [] };
export const can = (p) => session.permissions.includes(p);

const NAV = [
  ['Work', [['/', 'Overview', 'overview', 'overview:read', 'overview'], ['/breaks', 'Breaks', 'breaks', 'breaks:read', 'breaks'], ['/review', 'Review queue', 'review', 'proposals:read', 'review']]],
  ['Data', [['/sources', 'Sources', 'sources', 'sources:read', 'sources'], ['/runs', 'Runs', 'runs', 'runs:read', 'runs']]],
  ['Governance', [['/audit', 'Audit log', 'audit', 'audit:read', 'audit'], ['/settings', 'Settings', 'settings', 'settings:read', 'settings']]],
];

export function setSession(data) {
  session.user = data.user;
  session.permissions = data.permissions;
  setCsrfToken(data.csrfToken);
}

/** Builds the application frame and returns { main, setActive }. */
export function renderShell(root, { onSignOut }) {
  clear(root);
  const navLinks = new Map();
  const reviewCount = h('span', { class: 'nav-count', hidden: true });

  const nav = h('nav', { class: 'nav', 'aria-label': 'Primary' }, NAV.map(([label, items]) => {
    const visible = items.filter((i) => can(i[3]));
    return visible.length && h('div', { class: 'nav-group' }, h('div', { class: 'nav-label' }, label), visible.map(([path, text, ic, , key]) => {
      const a = h('a', { class: 'nav-link', href: `#${path}` }, icon(ic), h('span', null, text), key === 'review' && reviewCount);
      navLinks.set(key, a);
      return a;
    }));
  }));

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'BeetleJuice home' }, brandMark(), h('span', { class: 'brand-name' }, 'BeetleJuice')),
    nav, h('div', { class: 'sidebar-foot' }, 'Simulation with synthetic data. Not connected to any financial network.'));

  const shell = h('div', { class: 'shell' });
  const closeNav = () => shell.classList.remove('nav-open');
  const density = () => document.documentElement.dataset.density === 'compact';
  const densityBtn = button({
    label: density() ? 'Rows: compact' : 'Rows: comfortable', variant: 'ghost', small: true, title: 'Switch table row density', hideSm: true,
    onClick: () => {
      const next = density() ? 'comfortable' : 'compact';
      document.documentElement.dataset.density = next;
      try { localStorage.setItem('bj.density', next); } catch { /* storage may be blocked */ }
      densityBtn.querySelector('span').textContent = next === 'compact' ? 'Rows: compact' : 'Rows: comfortable';
    },
  });
  densityBtn.classList.add('hide-sm');
  const signOut = button({ label: 'Sign out', icon: 'logout', variant: 'ghost', small: true, onClick: (e) => withBusy(e.currentTarget, onSignOut) });

  const topbar = h('header', { class: 'topbar' },
    button({ icon: 'menu', variant: 'ghost', ariaLabel: 'Open navigation', onClick: () => shell.classList.add('nav-open') }),
    badge('neutral', 'Synthetic data', 'badge-plain'),
    h('span', { class: 'spacer' }),
    densityBtn,
    h('div', { class: 'user-chip' }, h('span', { class: 'name' }, session.user.displayName), badge('info', ROLES[session.user.role], 'badge-plain hide-sm')),
    signOut);
  topbar.firstChild.classList.add('menu-btn');

  const main = h('main', { id: 'main', tabindex: '-1' });
  shell.append(sidebar, h('div', { class: 'main-col' }, topbar, main));
  shell.append(h('div', { class: 'scrim', hidden: true, onclick: closeNav }));
  const scrim = shell.lastChild;
  new MutationObserver(() => { scrim.hidden = !shell.classList.contains('nav-open'); }).observe(shell, { attributes: true, attributeFilter: ['class'] });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeNav(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
  root.append(shell);

  async function refreshReviewCount() {
    if (!can('proposals:read')) return;
    try {
      const { data } = await api.get('/api/overview');
      reviewCount.hidden = !data.awaitingReview;
      reviewCount.textContent = data.awaitingReview;
      reviewCount.setAttribute('aria-label', `${data.awaitingReview} awaiting review`);
    } catch { /* non-critical */ }
  }

  return {
    main,
    setActive(key) {
      for (const [k, a] of navLinks) { if (k === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
      refreshReviewCount();
    },
    refreshReviewCount,
  };
}

export function renderLogin(root, { message, onSuccess }) {
  clear(root);
  const error = h('div', { 'aria-live': 'polite' });
  if (message) error.append(alertBox('info', null, message));
  const user = h('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false' });
  const pass = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', style: undefined }, 'Sign in');
  const form = h('form', { novalidate: true }, error, field('Username', user), field('Password', pass), submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(error);
    if (!user.value.trim() || !pass.value) { error.append(alertBox('bad', null, 'Enter your username and password.')); return; }
    await withBusy(submit, async () => {
      try {
        const res = await api.post('/api/auth/login', { username: user.value, password: pass.value });
        pass.value = '';
        onSuccess(res.data);
      } catch (err) {
        clear(error).append(alertBox('bad', err.status === 429 ? 'Too many attempts' : 'Sign-in failed', err.message));
        pass.select();
      }
    });
  });

  const points = ['Upload ledger and processor settlement files', 'Match deterministically, with every outcome explained', 'Resolve breaks under maker-checker control', 'Keep an append-only audit history'];
  root.append(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-aside' },
      h('div', { class: 'brand' }, brandMark(), h('span', { class: 'brand-name' }, 'BeetleJuice')),
      h('div', null, h('h1', null, 'Settlement reconciliation, with every difference explained.'),
        h('p', null, 'A back-office workbench for comparing internal ledger records with processor settlements and managing the breaks.'),
        h('ul', null, points.map((p) => h('li', null, icon('check'), p)))),
      h('div', { class: 'fine' }, 'Simulation using synthetic data. Not connected to any financial network.')),
    h('div', { class: 'login-main' }, h('div', { class: 'login-card' },
      h('h2', null, 'Sign in'), h('p', { class: 'muted' }, 'Use your BeetleJuice account.'), form,
      h('p', { class: 'hint', style: undefined }, 'Development builds ship with demo accounts; see the README.')))));
  user.focus();
}

export function renderUnavailable(container, title, text) {
  clear(container).append(h('div', { class: 'empty' }, h('h3', null, title), h('p', null, text), button({ label: 'Go to overview', href: '#/', variant: 'primary' })));
}

export { toast };
