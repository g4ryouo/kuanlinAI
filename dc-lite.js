// dc-lite.js：讓 .dc.html 原型脫離 Claude 畫布環境、直接在瀏覽器執行的極簡執行器。
// 支援：{{ 路徑 }} 文字與屬性、<sc-if value>、<sc-for list as>、onClick、<helmet>。
(function () {
  class DCLogic {
    constructor() { this.state = {}; this.props = {}; }
    setState(o) { Object.assign(this.state, o); this._render && this._render(); }
  }
  window.DCLogic = DCLogic;

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  function look(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const k of path.split('.')) { if (v == null) return undefined; v = v[k]; }
    return v;
  }
  function sub(str, scope) { return str.replace(HOLE, (_, p) => { const v = look(p, scope); return v == null ? '' : String(v); }); }
  function whole(str) { const m = str.trim().match(/^\{\{\s*([^}]+?)\s*\}\}$/); return m ? m[1] : null; }

  function build(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(sub(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-if') {
      const p = whole(node.getAttribute('value') || '');
      if (p && look(p, scope)) node.childNodes.forEach((c) => build(c, scope, out));
      return;
    }
    if (tag === 'sc-for') {
      const list = look(whole(node.getAttribute('list') || '') || '', scope) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((it, i) => {
        const s = Object.create(scope); s[as] = it; s.$index = i;
        node.childNodes.forEach((c) => build(c, s, out));
      });
      return;
    }
    const ns = node.namespaceURI;
    const el = ns && ns !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(ns, node.tagName) : document.createElement(tag);
    for (const a of Array.from(node.attributes)) {
      if (/^hint-/.test(a.name)) continue;
      if (/^on[a-z]+$/i.test(a.name)) {
        const fn = look(whole(a.value) || '', scope);
        if (typeof fn === 'function') el.addEventListener(a.name.slice(2).toLowerCase(), fn);
        continue;
      }
      el.setAttribute(a.name, sub(a.value, scope));
    }
    const src = tag === 'template' ? node.content : node;
    src.childNodes.forEach((c) => build(c, scope, el));
    out.appendChild(el);
  }

  function boot() {
    const host = document.querySelector('x-dc');
    const code = document.querySelector('script[data-dc-script]');
    if (!host || !code) return;
    const helmet = host.querySelector('helmet');
    if (helmet) { Array.from(helmet.children).forEach((c) => document.head.appendChild(c)); helmet.remove(); }
    const tpl = document.createElement('div');
    while (host.firstChild) tpl.appendChild(host.firstChild);
    const Component = new Function('DCLogic', code.textContent + '\nreturn Component;')(DCLogic);
    const comp = new Component();
    const render = () => {
      const scrolls = Array.from(host.querySelectorAll('*')).map((e) => e.scrollTop);
      const frag = document.createDocumentFragment();
      const vals = comp.renderVals();
      tpl.childNodes.forEach((c) => build(c, vals, frag));
      host.replaceChildren(frag);
      Array.from(host.querySelectorAll('*')).forEach((e, i) => { if (scrolls[i]) e.scrollTop = scrolls[i]; });
    };
    comp._render = render;
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
