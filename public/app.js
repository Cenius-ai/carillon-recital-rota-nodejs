/** Application shell: session state, client router, nav, route error handling. */

import { el, toast } from './dom.js';
import { api, ApiError } from './api.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderRotaList, renderRecitalForm } from './views/rota.js';
import { renderRecitalDetail } from './views/recital.js';
import { renderPracticeBoard, renderPracticeForm } from './views/practice.js';

const PRODUCT = 'Carillon Recital Rota';

const state = { user: null };

const ROUTES = [
  { pattern: /^\/login$/, view: renderLogin, title: 'Sign in', public: true },
  { pattern: /^\/$/, view: renderDashboard, title: 'Dashboard' },
  { pattern: /^\/rota$/, view: renderRotaList, title: 'Sunday recital rota' },
  { pattern: /^\/rota\/new$/, view: renderRecitalForm, title: 'Add a recital' },
  { pattern: /^\/recitals\/([^/]+)$/, params: ['id'], view: renderRecitalDetail, title: 'Recital programme' },
  { pattern: /^\/practice$/, view: renderPracticeBoard, title: 'Tower practice board' },
  { pattern: /^\/practice\/new$/, view: renderPracticeForm, title: 'Add a practice slot' }
];

let renderId = 0;

function matchRoute(pathname) {
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  for (const route of ROUTES) {
    const matched = trimmed.match(route.pattern);
    if (!matched) continue;
    const params = {};
    const names = route.params || [];
    for (let index = 0; index < names.length; index += 1) {
      params[names[index]] = decodeURIComponent(matched[index + 1]);
    }
    return { route, params };
  }
  return null;
}

function navigate(path, options = {}) {
  const target = path || '/';
  if (options.replace) window.history.replaceState({}, '', target);
  else window.history.pushState({}, '', target);
  renderRoute();
}

/* ------------------------------------------------------------------ */
/* Shell chrome                                                        */
/* ------------------------------------------------------------------ */

function paintSession() {
  const nav = document.getElementById('site-nav');
  const slot = document.getElementById('session-slot');
  if (!nav || !slot) return;

  if (!state.user) {
    nav.hidden = true;
    slot.replaceChildren(
      el('a', { class: 'btn btn--ghost btn--sm', href: '/login', 'data-link': 'true' }, 'Sign in')
    );
    return;
  }

  nav.hidden = false;
  slot.replaceChildren(
    el(
      'div',
      { class: 'session__user' },
      el('span', { class: 'session__name' }, state.user.displayName),
      el('span', { class: 'session__role' }, state.user.role || 'Carillonneur')
    ),
    el(
      'button',
      { type: 'button', class: 'btn btn--ghost btn--sm', onclick: signOut },
      'Sign out'
    )
  );
}

function paintActiveNav(pathname) {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  for (const link of nav.querySelectorAll('a')) {
    const href = link.getAttribute('href');
    const active =
      href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

async function signOut() {
  try {
    await api.logout();
  } catch (error) {
    toast(error.message || 'Could not sign out. Please try again.', 'error');
    return;
  }
  state.user = null;
  paintSession();
  toast('Signed out of the tower.');
  navigate('/login', { replace: true });
}

/* ------------------------------------------------------------------ */
/* Route rendering                                                     */
/* ------------------------------------------------------------------ */

function loadingNode() {
  return el(
    'div',
    { class: 'route-loading', role: 'status' },
    el('p', { class: 'route-loading__line' }, '> loading…')
  );
}

function notFoundView(ctx) {
  return el(
    'div',
    { class: 'page fade-in' },
    el(
      'div',
      { class: 'page__head' },
      el(
        'div',
        { class: 'page__headtext' },
        el('span', { class: 'page__eyebrow' }, 'Error 404'),
        el('h1', { class: 'page__title' }, 'That page is not on the rota.'),
        el(
          'p',
          { class: 'page__lede' },
          'The address you followed does not exist. Start again from the dashboard, the rota, or the practice board.'
        )
      )
    ),
    el(
      'div',
      { class: 'page__actions' },
      el('a', { class: 'btn btn--primary', href: '/', 'data-link': 'true' }, 'Back to dashboard'),
      el('a', { class: 'btn btn--ghost', href: '/rota', 'data-link': 'true' }, 'Open the rota'),
      ctx && ctx.user
        ? el('a', { class: 'btn btn--ghost', href: '/practice', 'data-link': 'true' }, 'Practice board')
        : null
    )
  );
}

function errorView(error, retry) {
  const message =
    error instanceof ApiError
      ? error.message
      : 'An unexpected error stopped this page from loading. Please try again.';
  const notFound = error instanceof ApiError && error.status === 404;
  return el(
    'div',
    { class: 'page fade-in' },
    el(
      'div',
      { class: 'page__head' },
      el(
        'div',
        { class: 'page__headtext' },
        el('span', { class: 'page__eyebrow' }, notFound ? 'Error 404' : 'Error'),
        el('h1', { class: 'page__title' }, notFound ? 'That record could not be found.' : 'This page did not load.'),
        el('p', { class: 'page__lede' }, message)
      )
    ),
    el(
      'div',
      { class: 'page__actions' },
      el('button', { type: 'button', class: 'btn btn--primary', onclick: retry }, 'Try again'),
      el('a', { class: 'btn btn--ghost', href: '/', 'data-link': 'true' }, 'Back to dashboard')
    )
  );
}

async function renderRoute(options = {}) {
  const id = ++renderId;
  const main = document.getElementById('main');
  if (!main) return;

  const pathname = window.location.pathname;
  const matched = matchRoute(pathname);

  // Guard: signed-out visitors are sent to sign-in, with the intended route kept.
  if (matched && !matched.route.public && !state.user) {
    const next = `${pathname}${window.location.search}`;
    window.history.replaceState({}, '', `/login?next=${encodeURIComponent(next)}`);
    renderRoute(options);
    return;
  }

  // Guard: signed-in users never sit on the sign-in screen.
  if (matched && matched.route.public && pathname === '/login' && state.user) {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('/login') ? next : '/';
    window.history.replaceState({}, '', safeNext);
    renderRoute(options);
    return;
  }

  const route = matched ? matched.route : null;
  document.title = route ? `${route.title} · ${PRODUCT}` : `Page not found · ${PRODUCT}`;
  paintActiveNav(pathname);

  main.replaceChildren(loadingNode());

  const ctx = {
    user: state.user,
    params: matched ? matched.params : {},
    navigate,
    refresh: () => renderRoute({ focusMain: false }),
    setUser(user) {
      state.user = user;
      paintSession();
    }
  };

  try {
    const node = route ? await route.view(ctx) : notFoundView(ctx);
    if (id !== renderId) return;
    main.replaceChildren(node);
  } catch (error) {
    if (id !== renderId) return;
    if (error instanceof ApiError && error.status === 401) {
      state.user = null;
      paintSession();
      const next = `${pathname}${window.location.search}`;
      window.history.replaceState(
        {},
        '',
        `/login?next=${encodeURIComponent(next)}&expired=1`
      );
      renderRoute(options);
      return;
    }
    main.replaceChildren(errorView(error, () => renderRoute()));
  }

  if (options.focusMain !== false) {
    main.focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const payload = await api.me();
    state.user = payload.user;
  } catch (error) {
    state.user = null;
    if (!(error instanceof ApiError) || error.status !== 401) {
      toast('The server did not answer. Reload the page to try again.', 'error');
    }
  }

  paintSession();

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });

  window.addEventListener('popstate', () => renderRoute());
  await renderRoute();
}

boot();
