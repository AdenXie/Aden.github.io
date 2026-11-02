const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Minimal DOM for the menu and search controllers. The runtime mounts both on load; the theme's
// click handler is stubbed to what it does in the browser (a click on the menu button toggles the body class).
function harness() {
  const document = new EventTarget(), window = new EventTarget();
  const observers = [];
  const body = { classList: new Set(), focused: 0 };
  const classList = (set) => ({ contains: value => set.has(value), add: value => set.add(value), remove: value => set.delete(value) });
  const element = (name, extra = {}) => ({ name, isConnected: true, focused: 0, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused++; document.activeElement = this; }, ...extra });
  const drawerLink = element('link');
  const drawer = element('drawer', { contains: el => el === drawerLink, querySelector: selector => (selector === 'a' ? drawerLink : null) });
  const bar = element('bar', { click() { toggle(); } });
  const overlay = element('overlay', { classList: classList(new Set()), contains: () => false });
  const header = { querySelector: selector => ({ '.navbar-bar': bar, '#navbar-drawer': drawer })[selector] };
  const toggle = () => { if (body.classList.has('navbar-drawer-show')) body.classList.delete('navbar-drawer-show'); else body.classList.add('navbar-drawer-show'); observers.forEach(o => o.callback()); };
  document.activeElement = null;
  const roots = new Map([['.navbar-container', header], ['.search-pop-overlay', overlay]]);
  Object.assign(document, { readyState: 'complete', hidden: false, body: { classList: { contains: v => body.classList.has(v), add: v => body.classList.add(v), remove: v => body.classList.delete(v) } }, querySelector: selector => roots.get(selector) });
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const context = vm.createContext({ window, document, AbortController, console, MutationObserver, requestAnimationFrame: fn => fn(), setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync('source/js/site-runtime.js', 'utf8'), context);
  return { document, window, bar, drawer, drawerLink, overlay, body, observers, open: () => toggle(), key: key => document.dispatchEvent(Object.assign(new Event('keydown'), { key })), api: window.AdenSite };
}

test('the menu button mirrors the drawer state in aria-expanded', () => {
  const h = harness();
  h.api.register('navbar-menu', '.navbar-container', () => {});
  assert.equal(h.bar.attributes['aria-expanded'], 'false');
  h.open();
  assert.equal(h.bar.attributes['aria-expanded'], 'true');
});

test('Escape closes an open drawer, uses the theme toggle and returns focus to the menu button', () => {
  const h = harness();
  h.api.register('navbar-menu', '.navbar-container', () => {});
  h.open();
  h.key('Enter');
  assert.equal(h.body.classList.has('navbar-drawer-show'), true);
  h.key('Escape');
  assert.equal(h.body.classList.has('navbar-drawer-show'), false);
  assert.equal(h.document.activeElement, h.bar);
  assert.equal(h.bar.attributes['aria-expanded'], 'false');
});

test('Escape does nothing while the drawer is closed', () => {
  const h = harness();
  h.api.register('navbar-menu', '.navbar-container', () => {});
  const before = h.bar.focused;
  h.key('Escape');
  assert.equal(h.bar.focused, before);
  assert.equal(h.document.activeElement, null);
});

test('opening the drawer moves focus to its first link, so Tab stays inside the menu', () => {
  const h = harness();
  h.api.register('navbar-menu', '.navbar-container', () => {});
  h.open();
  assert.equal(h.document.activeElement, h.drawerLink);
});

test('closing the drawer while focus is inside it moves focus back to the menu button', () => {
  const h = harness();
  h.api.register('navbar-menu', '.navbar-container', () => {});
  h.open();
  h.document.activeElement = h.drawerLink;
  h.body.classList.delete('navbar-drawer-show');
  h.observers.forEach(o => o.callback());
  assert.equal(h.document.activeElement, h.bar);
});

test('the search popup returns focus to the control that opened it', () => {
  const h = harness();
  const trigger = { name: 'trigger', isConnected: true, focus() { this.focused = true; } };
  h.document.activeElement = trigger;
  h.overlay.classList.add('active');
  h.observers.at(-1).callback();
  h.document.activeElement = null;
  h.overlay.classList.remove('active');
  h.observers.at(-1).callback();
  assert.equal(trigger.focused, true);
});
