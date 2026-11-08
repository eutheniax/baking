/* remiiibake 下单页
 * 接口网址写在 config.js 里（只需要填一次，以后更新网站不要覆盖 config.js）
 */
var API_URL = window.API_URL || '';

var FR = { '盒子蛋糕': 'Box Cakes', '六寸蛋糕': '6-inch Cakes', '六寸': '6-inch Cakes', '蛋糕': 'Cakes', '蛋挞': 'Egg Tarts', '饼干': 'Cookies', '面包': 'Bread', '挞': 'Tarts', '泡芙': 'Cream Puffs', '糖水': 'Sweet Soups', '奶冻': 'Puddings', '新品': 'New', '其他': 'Treats' };
// 名称以【新品】开头的商品：显示 NEW 标签，名称里不显示括号
function isNewItem(n) { return /^\s*[【\[]\s*新品\s*[】\]]/.test(n || ''); }
function plainName(n) { return String(n || '').replace(/^\s*[【\[]\s*新品\s*[】\]]\s*/, ''); }
function nameWithTag(n) { return isNewItem(n) ? [el('span', { cls: 'new-tag', text: 'NEW 新品' }), plainName(n)] : [String(n || '')]; }
var DATA = null, cart = {}, busy = false, view = 'home', draft = {}, openedAt = Date.now(), promoChoice = '', lastOrder = null;

/* ---------- 小工具 ---------- */
function el(tag, attrs, kids) {
  var n = document.createElement(tag);
  for (var k in (attrs || {})) {
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'cls') n.className = v;
    else if (k === 'html') n.innerHTML = v; // 只用于本文件里写死的插画 SVG
    else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return n;
}
function art(svg, cls) { return el('span', { cls: 'art ' + (cls || ''), html: svg, 'aria-hidden': 'true' }); }
function money(x) { return '$' + Number(x).toFixed(2).replace(/\.00$/, ''); }
function $(id) { return document.getElementById(id); }
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; } }
var toastTimer;
function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000); }
function copyBtn(text) {
  return el('button', { cls: 'copy', text: '复制', onclick: function () {
    var b = this; try { navigator.clipboard.writeText(text).then(function () { b.textContent = '已复制'; }); } catch (e) {}
  } });
}
function safeImg(u) { return /^https:\/\//i.test(u) || /^images\/[\w%\-.]+$/.test(u) ? u : ''; }
function heading(fr, zh) { return el('div', { cls: 'heading' }, [el('div', { cls: 'fr', text: fr }), el('div', { cls: 'zh', text: zh })]); }
function flourish() { return el('div', { cls: 'flourish', 'aria-hidden': 'true' }, [el('span', { text: '❦' })]); }

/* ---------- 接口 ---------- */
function api(action, body) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(API_URL)) {
    return Promise.reject(new Error('【店主看】config.js 里的网址还没填好，要贴 Apps Script 部署出来、以 /exec 结尾的网址'));
  }
  var req = body
    ? fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action: action }, body)), redirect: 'follow' })
    : fetch(API_URL + '?action=' + encodeURIComponent(action), { redirect: 'follow' });
  return req.then(function (r) {
      if (!r.ok) throw new Error('【店主看】接口返回错误 ' + r.status + '，检查 Apps Script 部署是否还有效');
      return r.text();
    }, function () {
      throw new Error('连不上接口。【店主看】最常见原因：Apps Script 部署的「访问权限」没选「任何人」（Anyone）');
    })
    .then(function (t) {
      var j; try { j = JSON.parse(t); } catch (e) {
        throw new Error('【店主看】接口返回的不是数据：Apps Script 里还是旧代码，或部署没选「新版本」');
      }
      if (!j || !j.ok) throw new Error((j && j.error) || '出错了');
      return j.data;
    });
}

/* ---------- 导航 ---------- */
function go(v) {
  if (view === 'checkout') saveDraft();
  view = v; paint(); window.scrollTo(0, 0);
}
function paint() {
  document.querySelectorAll('.nav button').forEach(function (b) {
    var t = b.getAttribute('data-go');
    b.classList.toggle('on', t === view || (t === 'menu' && (view === 'checkout' || view === 'done')));
  });
  document.body.setAttribute('data-view', view);
  if (!DATA) return;
  if (view === 'home') renderHome();
  else if (view === 'menu') renderMenu();
  else if (view === 'checkout') renderCheckout();
  else if (view === 'done') renderDone(lastOrder);
  else renderMe();
  updateBar();
}
function buildNav() {
  var nav = $('nav');
  [['home', '首页', 'Home'], ['menu', '点单', 'Menu'], ['me', '我的', 'My Account']].forEach(function (t) {
    nav.appendChild(el('button', { 'data-go': t[0], onclick: function () { go(t[0]); } }, [art(ART.nav[t[0]], 'nav-ic'), el('b', { text: t[1] }), el('i', { text: t[2] })]));
  });
}

function load(cb) {
  api('menu').then(function (d) {
    DATA = d; document.title = d.shop;
    // 购物车里超过库存的数量自动调整
    DATA.menu.forEach(function (it) { if ((cart[it.name] || 0) > it.left) cart[it.name] = it.left; });
    if (cb) cb(); else paint();
  }).catch(function (e) {
    var app = $('app'); app.innerHTML = '';
    app.appendChild(el('div', { cls: 'center' }, [el('i', { text: 'Oops…' }), '加载失败，请刷新：' + e.message]));
  });
}

/* ---------- 首页 ---------- */
function renderHome() {
  var app = $('app'); app.innerHTML = '';
  app.appendChild(el('header', { cls: 'hero' }, [
    el('div', { cls: 'logo' }, [art(ART.bow, 'bow l'), el('h1', { text: DATA.shop }), art(ART.bow, 'bow r')]),
    el('div', { cls: 'tagline', text: 'PÂTISSERIE · MAISON' }),
    el('div', { cls: 'hero-message hero-quote' }, [el('div', {}, [el('span', { cls: 'quote-line', text: '“People who love to eat are' }), el('br'), el('span', { cls: 'quote-line', text: 'always the best people.”' })]), el('cite', { text: '— Julia Child' })]),
    heroArt(),
    el('div', { cls: 'tagline small', text: 'HANDMADE · WITH LOVE' })
  ]));
  var ovals = el('div', { cls: 'ovals' });
  [
    ['carte', '本周菜单', 'Menu', function () { go('menu'); }],
    ['retrait', '取货信息', 'Pickup', showPickups],
    ['compte', '我的订单', 'My Orders', function () { go('me'); }]
  ].forEach(function (o) {
    ovals.appendChild(el('button', { cls: 'oval', onclick: o[3] }, [art(ART.icons[o[0]], 'oval-ic'), el('b', { text: o[1] }), el('i', { text: o[2] })]));
  });
  app.appendChild(ovals);

  var promos = DATA.promos || [];
  app.appendChild(el('div', { cls: 'offer' }, [
    art(ART.bow, 'offer-bow'),
    el('div', { cls: 'offer-title', text: promos.length ? 'Weekly Specials' : 'Order Now' }),
    promos.length ? el('div', { cls: 'offer-lines' }, promos.map(function (p) {
      return el('div', {}, [el('b', { text: '满 $' + p.min }), ' ' + [p.rateLabel, p.gift ? '送 ' + p.gift : ''].filter(Boolean).join(' 或 ')]);
    })) : null,
    promos.length ? el('div', { cls: 'small', text: '二选一 · 每单限用一个优惠' }) : null,
    el('button', { cls: 'btn', text: DATA.open ? '立即点单' : '本周已截单', disabled: !DATA.open, onclick: function () { go('menu'); } })
  ]));
  app.appendChild(el('footer', { cls: 'brand-footer' }, [el('i', { text: 'Bon appétit' }), el('span', { text: 'REMIIIBAKE · 用心烘焙每一份日常' })]));
}

// 首页插画：优先用 images/hero.png，没有就用内置的手绘
function heroArt() {
  var img = el('img', { cls: 'hero-img', src: 'images/hero.png', alt: '', decoding: 'async' });
  img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(art(ART.hero, 'hero-wrap'), img); });
  return img;
}

function showPickups() {
  var list = DATA.pickups.length ? DATA.pickups : ['请留意本周公告'];
  sheet(el('div', { cls: 'sheet-body' }, [
    heading('Pickup', '取货信息'),
    el('ul', { cls: 'pick-list' }, list.map(function (p) { return el('li', { text: p }); })),
    el('div', { cls: 'small center-t', text: '下单时选择取货时间段，也可以填预计几点到' })
  ]));
}

/* ---------- 点单页 ---------- */
// 分类顺序和英文名来自表格「分类」页；没写进去的分类排在后面，英文名用内置对照表
function catEn(c) {
  var row = (DATA.categories || []).filter(function (x) { return x.zh === c; })[0];
  return (row && row.en) || FR[c] || 'Treats';
}
function groups() {
  var cats = [], g = {};
  DATA.menu.forEach(function (it) { if (!g[it.cat]) { g[it.cat] = []; cats.push(it.cat); } g[it.cat].push(it); });
  var order = (DATA.categories || []).map(function (x) { return x.zh; });
  var rank = function (c) { var i = order.indexOf(c); return i < 0 ? 1000 + cats.indexOf(c) : i; };
  cats.sort(function (a, b) { return rank(a) - rank(b); });
  return { cats: cats, g: g };
}

function renderMenu() {
  var app = $('app'); app.innerHTML = '';
  app.appendChild(el('div', { cls: 'page-head' }, [heading('Menu', '本周菜单')]));
  if (!DATA.open) { app.appendChild(el('div', { cls: 'center' }, [el('i', { text: 'Orders closed this week' }), '本周已截单，下周早点来哦～'])); return; }
  if (!DATA.menu.length) { app.appendChild(el('div', { cls: 'center' }, [el('i', { text: 'Coming soon…' }), '本周菜单还没上，稍后再来看看～'])); return; }
  if ((DATA.promos || []).length) {
    app.appendChild(el('div', { cls: 'promo-strip', text: DATA.promos.map(function (p) {
      return '满$' + p.min + ' ' + [p.rateLabel, p.gift ? '送' + p.gift : ''].filter(Boolean).join('/');
    }).join('  ·  ') }));
  }
  var gr = groups();
  var rail = el('nav', { cls: 'rail' });
  var list = el('div', { cls: 'list' });
  gr.cats.forEach(function (c, i) {
    var id = 'cat-' + i;
    rail.appendChild(el('button', { cls: i ? '' : 'on', 'data-for': id, onclick: function () {
      var t = $(id); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
    } }, [el('b', { text: c }), el('i', { text: catEn(c) })]));
    list.appendChild(el('div', { cls: 'cat-title', id: id }, [el('i', { text: catEn(c) }), el('span', { text: c })]));
    gr.g[c].forEach(function (it) { list.appendChild(card(it)); });
  });
  app.appendChild(el('div', { cls: 'menu' }, [rail, list]));
  // 滚动时高亮当前分类
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        rail.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-for') === e.target.id); });
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    list.querySelectorAll('.cat-title').forEach(function (t) { io.observe(t); });
  }
}

function photo(src, cls) {
  var ph = el('div', { cls: 'ph ' + (cls || '') }, [art(ART.bow, 'ph-bow')]);
  src = safeImg(src);
  if (!src) return ph;
  var img = el('img', { src: src, alt: '', loading: 'lazy', cls: cls || null, referrerpolicy: 'no-referrer' });
  img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(ph, img); });
  return img;
}

function stepper(it, onChange) {
  var box = el('div', { cls: 'step' });
  function draw() {
    box.innerHTML = '';
    var q = cart[it.name] || 0;
    if (!q) {
      box.appendChild(el('button', { cls: 'add', 'aria-label': '加入 ' + it.name, text: '+', onclick: function (e) { e.stopPropagation(); change(1); } }));
    } else {
      box.appendChild(el('button', { cls: 'minus', 'aria-label': '减少', text: '−', onclick: function (e) { e.stopPropagation(); change(-1); } }));
      box.appendChild(el('span', { text: String(q) }));
      box.appendChild(el('button', { cls: 'add', 'aria-label': '增加', text: '+', onclick: function (e) { e.stopPropagation(); change(1); } }));
    }
  }
  function change(d) {
    var v = cart[it.name] || 0;
    if (d > 0) {
      if (totalQty() >= DATA.maxQty) return toast('一个订单最多 ' + DATA.maxQty + ' 件哦');
      if (v >= it.left) return toast('这款库存不够啦');
    }
    cart[it.name] = Math.max(0, v + d);
    draw(); updateBar(); if (onChange) onChange();
    if (d > 0 && totalQty() === DATA.maxQty) toast('已到上限：一个订单最多 ' + DATA.maxQty + ' 件');
  }
  box.sync = draw;
  draw();
  return box;
}

function card(it) {
  var soldout = it.left <= 0, imgs = it.imgs || [];
  var step = soldout ? null : stepper(it);
  var c = el('article', { cls: 'pcard' + (soldout ? ' soldout' : ''), onclick: function () { openDetail(it, step); } }, [
    el('div', { cls: 'pimg' }, [photo(imgs[0]), imgs.length > 1 ? el('span', { cls: 'more', text: imgs.length + ' photos' }) : null, soldout ? el('span', { cls: 'sold', text: 'SOLD OUT · 已售罄' }) : null]),
    el('div', { cls: 'pbody' }, [
      el('div', { cls: 'pname' }, nameWithTag(it.name)),
      it.desc ? el('div', { cls: 'pdesc', text: it.desc }) : null,
      el('div', { cls: 'pfoot' }, [el('span', { cls: 'price', text: money(it.price) }), step])
    ])
  ]);
  return c;
}

function sheet(content) {
  var veil = el('div', { cls: 'veil' });
  var box = el('div', { cls: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [el('button', { cls: 'close', text: '×', 'aria-label': '关闭', onclick: close }), content]);
  veil.addEventListener('click', close);
  document.body.appendChild(veil); document.body.appendChild(box); document.body.classList.add('lock');
  requestAnimationFrame(function () { veil.classList.add('show'); box.classList.add('show'); });
  function close() {
    veil.classList.remove('show'); box.classList.remove('show'); document.body.classList.remove('lock');
    setTimeout(function () { veil.remove(); box.remove(); }, 260);
  }
  return close;
}

function openDetail(it, rowStep) {
  var imgs = it.imgs || [], soldout = it.left <= 0;
  var gallery = el('div', { cls: 'gallery' }, imgs.length ? imgs.map(function (u) { return photo(u); }) : [photo('')]);
  var dots = imgs.length > 1 ? el('div', { cls: 'dotsbar' }, imgs.map(function (_, i) { return el('i', { cls: i ? '' : 'on' }); })) : null;
  if (dots) gallery.addEventListener('scroll', function () {
    var i = Math.round(gallery.scrollLeft / gallery.clientWidth);
    Array.prototype.forEach.call(dots.children, function (d, j) { d.classList.toggle('on', i === j); });
  });
  var step = soldout ? el('div', { cls: 'tag', text: 'Sold out · 已售罄' }) : stepper(it, function () { if (rowStep) rowStep.sync(); });
  var close = sheet(el('div', {}, [
    gallery, dots,
    el('div', { cls: 'sheet-body' }, [
      el('div', { cls: 'sname', text: it.name }),
      el('div', { cls: 'sprice', text: money(it.price) }),
      it.desc ? el('div', { cls: 'sdesc', text: it.desc }) : null,
      el('div', { cls: 'sfoot' }, [step, el('button', { cls: 'btn', text: '继续选购', onclick: function () { close(); } })])
    ])
  ]));
}

/* ---------- 价格 & 优惠 ---------- */
function totalQty() { var n = 0; for (var k in cart) n += cart[k]; return n; }
function subtotal() { var t = 0; DATA.menu.forEach(function (it) { t += (cart[it.name] || 0) * it.price; }); return Math.round(t * 100) / 100; }
function currentTier(sub) { var t = null; (DATA.promos || []).forEach(function (p) { if (sub >= p.min) t = p; }); return t; }
function giftLeft(name) { var it = DATA.menu.filter(function (x) { return x.name === name; })[0]; return it ? it.left - (cart[name] || 0) : 0; }
function priced() {
  var sub = subtotal(), tier = currentTier(sub), r = { sub: sub, amount: sub, tier: tier, choice: '' };
  if (!tier) return r;
  var giftOk = tier.gift && giftLeft(tier.gift) > 0, c = promoChoice;
  if (c === 'gift' && !giftOk) c = '';
  if (c === 'rate' && !tier.rate) c = '';
  if (!c) c = tier.rate ? 'rate' : (giftOk ? 'gift' : '');
  r.choice = c;
  if (c === 'rate') r.amount = Math.round(sub * tier.rate * 100) / 100;
  return r;
}
function nextTier(sub) { return (DATA.promos || []).filter(function (p) { return sub < p.min; })[0]; }

function updateBar() {
  var bar = $('bar');
  var show = DATA && DATA.open && (view === 'menu' || view === 'checkout');
  bar.hidden = !show;
  document.body.classList.toggle('has-bar', !!show);
  if (!show) return;
  var n = totalQty(), pr = priced(), nx = nextTier(pr.sub);
  $('total').textContent = money(pr.amount);
  $('was').textContent = pr.amount < pr.sub ? money(pr.sub) : '';
  $('count').textContent = n ? '共 ' + n + ' 件' + (pr.choice === 'gift' ? ' + 赠品' : '') : '还没选';
  $('hintline').textContent = n && nx ? '再买 ' + money(nx.min - pr.sub) + ' 享满 $' + nx.min + ' 优惠' : (pr.tier ? '已享满 $' + pr.tier.min + ' 优惠 ✦' : '');
  var btn = $('submit');
  btn.textContent = view === 'checkout' ? (busy ? '提交中…' : '去付款') : '去结算';
  btn.disabled = !n || busy;
  if (view === 'checkout') renderPromo(pr);
}

function renderPromo(pr) {
  var box = $('promo'); if (!box) return;
  box.innerHTML = '';
  if (!pr.tier) return;
  box.appendChild(el('label', { cls: 'f', text: '满 $' + pr.tier.min + ' 优惠（二选一）*' }));
  var wrap = el('div', { cls: 'opts' }), opts = [];
  if (pr.tier.rate) opts.push({ v: 'rate', t: pr.tier.rateLabel + '（省 ' + money(pr.sub - Math.round(pr.sub * pr.tier.rate * 100) / 100) + '）' });
  if (pr.tier.gift) opts.push({ v: 'gift', t: '送 ' + pr.tier.gift + (giftLeft(pr.tier.gift) > 0 ? '' : '（已送完）'), off: giftLeft(pr.tier.gift) <= 0 });
  opts.forEach(function (o) {
    var input = el('input', { type: 'radio', name: 'promo', value: o.v, checked: pr.choice === o.v, disabled: !!o.off });
    var lab = el('label', { cls: 'opt' + (pr.choice === o.v ? ' on' : '') + (o.off ? ' off' : '') }, [input, o.t]);
    input.addEventListener('change', function () { promoChoice = o.v; updateBar(); });
    wrap.appendChild(lab);
  });
  box.appendChild(wrap);
}

/* ---------- 结算页 ---------- */
function saveDraft() {
  if (!$('f-name')) return;
  draft = { name: $('f-name').value, contact: $('f-contact').value, arrive: $('f-arrive') ? $('f-arrive').value : '', note: $('f-note').value, pickup: picked('pickup'), pay: picked('pay') };
}

function renderCheckout() {
  var app = $('app'); app.innerHTML = '';
  if (!totalQty()) { view = 'menu'; return renderMenu(); }
  app.appendChild(el('button', { cls: 'back', text: '‹ 继续选购', onclick: function () { go('menu'); } }));
  app.appendChild(el('div', { cls: 'page-head' }, [heading('Your Order', '确认订单')]));

  var sum = el('div', { cls: 'card' });
  DATA.menu.forEach(function (it) {
    if (!cart[it.name]) return;
    sum.appendChild(el('div', { cls: 'line' }, [el('span', { text: it.name + ' ×' + cart[it.name] }), el('span', { text: money(it.price * cart[it.name]) })]));
  });
  app.appendChild(sum);

  var f = el('div', { cls: 'card form' });
  f.appendChild(el('label', { cls: 'f', text: '微信昵称 *' }));
  f.appendChild(el('input', { cls: 't', id: 'f-name', autocomplete: 'name', maxlength: '40' }));
  f.appendChild(el('label', { cls: 'f', text: '电话 *' }));
  f.appendChild(el('input', { cls: 't', id: 'f-contact', type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: '60' }));
  f.appendChild(el('div', { cls: 'hp', 'aria-hidden': 'true' }, [el('input', { id: 'f-website', tabindex: '-1', autocomplete: 'off' })]));
  if (DATA.pickups.length) {
    f.appendChild(el('label', { cls: 'f', text: '取货时间段 *' }));
    f.appendChild(options('pickup', DATA.pickups, false));
    f.appendChild(el('label', { cls: 'f', text: '预计几点来取（可选）' }));
    f.appendChild(el('input', { cls: 't', id: 'f-arrive', maxlength: '40', placeholder: '例如 3:30pm' }));
  }
  f.appendChild(el('div', { id: 'promo' }));
  if (DATA.pays.length) {
    f.appendChild(el('label', { cls: 'f', text: '付款方式 *' }));
    f.appendChild(options('pay', DATA.pays.map(function (p) { return p.key; }), true));
  }
  f.appendChild(el('label', { cls: 'f', text: '备注（可选）' }));
  f.appendChild(el('textarea', { id: 'f-note', maxlength: '200', placeholder: '例如：少糖、不用纸袋' }));
  f.appendChild(el('div', { cls: 'err', id: 'err' }));
  app.appendChild(f);

  $('f-name').value = draft.name != null ? draft.name : store('rb-name');
  $('f-contact').value = draft.contact != null ? draft.contact : store('rb-contact');
  if ($('f-arrive')) $('f-arrive').value = draft.arrive || '';
  $('f-note').value = draft.note || '';
  choose('pickup', draft.pickup); choose('pay', draft.pay || store('rb-pay'));
}

function options(group, list, inline) {
  var wrap = el('div', { cls: 'opts' + (inline ? ' inline' : '') });
  list.forEach(function (opt) {
    var input = el('input', { type: 'radio', name: group, value: opt });
    var lab = el('label', { cls: 'opt' }, [input, opt]);
    input.addEventListener('change', function () { wrap.querySelectorAll('.opt').forEach(function (l) { l.classList.remove('on'); }); lab.classList.add('on'); });
    wrap.appendChild(lab);
  });
  if (list.length === 1) choose(group, list[0], wrap);
  return wrap;
}
function choose(group, v, root) {
  if (!v) return;
  (root || document).querySelectorAll('input[name="' + group + '"]').forEach(function (i) {
    if (i.value === v) { i.checked = true; i.parentNode.classList.add('on'); }
  });
}
function picked(group) { var r = document.querySelector('input[name="' + group + '"]:checked'); return r ? r.value : ''; }
function showErr(m) { if ($('err')) $('err').textContent = m; if (m) toast(m); }

function submitOrder() {
  if (busy) return;
  var items = []; for (var k in cart) if (cart[k] > 0) items.push({ name: k, qty: cart[k] });
  var form = { name: $('f-name').value.trim(), contact: $('f-contact').value.trim(), arrive: $('f-arrive') ? $('f-arrive').value.trim() : '',
    note: $('f-note').value.trim(), pickup: picked('pickup'), pay: picked('pay'), items: items, website: $('f-website').value, promo: priced().choice };
  if (!form.name || !form.contact) return showErr('请填写微信昵称和电话');
  if (DATA.pickups.length && !form.pickup) return showErr('请选择取货时间段');
  if (DATA.pays.length && !form.pay) return showErr('请选择付款方式');
  if (Date.now() - openedAt < 3000) return showErr('请稍等一下再提交');
  store('rb-name', form.name); store('rb-contact', form.contact); if (form.pay) store('rb-pay', form.pay);
  busy = true; showErr(''); updateBar();
  api('order', form).then(function (r) {
    busy = false; cart = {}; draft = {}; promoChoice = ''; lastOrder = r;
    go('done');
  }).catch(function (e) {
    busy = false; saveDraft();
    load(function () { paint(); showErr(e.message); });
  });
}

$('submit').addEventListener('click', function () {
  if (view === 'checkout') submitOrder(); else go('checkout');
});

/* ---------- 下单成功 ---------- */
function payBlock(o) {
  var kids = [el('div', { cls: 'hint' }, [
    el('div', { text: '👉 付款「备注」请写订单号 ' + o.orderId }),
    el('div', { text: '👉 付完款到「我的」点「我已付款」并上传截图' })
  ])];
  if (o.pay) kids.push(el('div', { cls: 'row' }, [el('span', { text: '付款方式' }), el('span', { text: o.pay })]));
  if (o.payInfo) kids.push(el('div', { cls: 'row' }, [el('span', { text: '收款账号' }), el('span', {}, [o.payInfo, copyBtn(o.payInfo)])]));
  return kids;
}

// 下单成功页：直接上传付款凭证（选图 → 压缩 → 上传）
function uploadProofButton(r) {
  var input = el('input', { type: 'file', accept: 'image/*', cls: 'hp' });
  var btn = el('button', { cls: 'btn ghost', text: '上传付款凭证', onclick: function () { if (!btn.disabled) input.click(); } });
  input.addEventListener('change', function () {
    var f = input.files && input.files[0]; if (!f) return;
    btn.disabled = true; btn.textContent = '上传中…';
    compress(f).then(function (data) {
      return api('claim', { orderId: r.orderId, name: store('rb-name'), contact: store('rb-contact'), image: data });
    }).then(function () {
      btn.textContent = '已上传 ✓'; toast('已收到你的付款截图，店主核对后会确认');
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '上传付款凭证'; input.value = ''; toast(e.message);
    });
  });
  return el('span', { cls: 'upload-proof' }, [btn, input]);
}

// 下单成功页的小票：逐项金额从菜单价格算（赠品显示 FREE）
function receipt(r, f) {
  var price = {}; (DATA && DATA.menu || []).forEach(function (it) { price[it.name] = it.price; });
  var lines = String(r.detail || '').split('；').filter(Boolean).map(function (t) {
    var m = t.replace(/^🎁\s*/, '').match(/^(.*?)\s*×\s*(\d+)(.*)$/);
    if (!m) return el('div', { cls: 'rc-line' }, [el('span', { text: t })]);
    var name = m[1], q = Number(m[2]), isGift = /赠品/.test(m[3]);
    return el('div', { cls: 'rc-line' }, [
      el('span', { cls: 'rc-item' }, [plainName(name), el('small', { text: ' × ' + q })]),
      el('span', { cls: 'rc-amt', text: isGift ? 'FREE' : (price[name] != null ? money(price[name] * q) : '') })
    ]);
  });
  var d = new Date(), pay = r.payment;
  var row = function (k, v) { return el('div', { cls: 'rc-row' }, [el('span', { cls: 'rc-key', text: k }), v]); };
  return el('section', { cls: 'receipt', 'aria-label': '订单小票' }, [
    el('div', { cls: 'rc-title' }, [el('span', { text: 'RECEIPT' })]),
    row('ORDER ID', el('span', { cls: 'rc-val' }, [r.orderId, copyBtn(r.orderId)])),
    row('ORDER DATE', el('span', { cls: 'rc-val', text: (d.getMonth() + 1) + ' / ' + d.getDate() + ' / ' + d.getFullYear() })),
    row(f.mode === 'delivery' ? 'DELIVERY' : 'PICKUP', el('span', { cls: 'rc-val rc-wrap', text: r.pickup + (r.arrive ? '（约 ' + r.arrive + '）' : '') })),
    el('hr', { cls: 'rc-rule' }),
    el('div', { cls: 'rc-lines' }, lines),
    r.promo ? el('div', { cls: 'rc-line rc-sub' }, [el('span', { text: r.promo }), el('span', {})]) : null,
    el('hr', { cls: 'rc-rule dashed' }),
    el('div', { cls: 'rc-line rc-sub' }, [el('span', { text: 'Subtotal 商品金额' }), el('span', { cls: 'rc-amt', text: money(r.goods != null ? r.goods : r.amount) })]),
    el('div', { cls: 'rc-line rc-sub' }, [el('span', { text: f.mode === 'delivery' ? 'Delivery 配送费' : 'Pickup 自提' }), el('span', { cls: 'rc-amt', text: r.deliveryFee ? money(r.deliveryFee) : '免费' })]),
    el('hr', { cls: 'rc-rule' }),
    el('div', { cls: 'rc-total' }, [el('span', { text: 'TOTAL' }), el('span', { cls: 'rc-amt', text: money(r.amount) })]),
    pay && pay.currency === 'CNY' ? el('div', { cls: 'rc-cny', text: '支付宝应付 ¥' + Number(pay.amount).toFixed(2) }) : null,
    el('div', { cls: 'rc-foot', text: (DATA && DATA.shop || 'remiiibake') + ' · thank you ♡' })
  ]);
}

function renderDone(r) {
  var app = $('app'); app.innerHTML = '';
  if (!r) { view = 'home'; return renderHome(); }
  var f = r.fulfillment || {};
  var info = receipt(r, f);
  app.appendChild(el('div', { cls: 'card big' }, [
    art(ART.bow, 'done-bow'),
    el('div', { cls: 'merci', text: 'Thank you!' }),
    el('div', { cls: 'small', text: '下单成功，请截图保存' }),
    el('div', { cls: 'oid', text: r.orderId }),
    el('div', { cls: 'amt', text: money(r.amount) }),
    el('div', { cls: 'done-upload' }, [uploadProofButton(r)])
  ].concat(payBlock(r)).concat([
    info,
    el('div', { cls: 'btns' }, [el('button', { cls: 'btn', text: '个人中心', onclick: function () { go('me'); } })])
  ])));
}

/* ---------- 我的 ---------- */
function renderMe() {
  var app = $('app'); app.innerHTML = '';
  app.appendChild(el('div', { cls: 'page-head' }, [heading('My Orders', '我的订单')]));
  var name = store('rb-name'), contact = store('rb-contact');
  app.appendChild(el('div', { cls: 'card form' }, [
    el('div', { cls: 'small', text: '用下单时填的微信昵称和电话，查看订单和付款状态' }),
    el('label', { cls: 'f', text: '微信昵称' }), el('input', { cls: 't', id: 'm-name', value: name, maxlength: '40' }),
    el('label', { cls: 'f', text: '电话' }), el('input', { cls: 't', id: 'm-contact', type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: contact, maxlength: '60' }),
    el('div', { cls: 'mt' }, [el('button', { cls: 'btn', text: '查看我的订单', onclick: lookup })])
  ]));
  app.appendChild(el('div', { id: 'mylist' }));
  if (name && contact) lookup();
}

function lookup() {
  var f = { name: $('m-name').value.trim(), contact: $('m-contact').value.trim() };
  if (!f.name || !f.contact) return toast('请填写微信昵称和电话');
  store('rb-name', f.name); store('rb-contact', f.contact);
  var list = $('mylist'); list.innerHTML = ''; list.appendChild(el('div', { cls: 'center', text: '查询中…' }));
  api('my', f).then(function (orders) {
    if (!$('mylist')) return;
    list.innerHTML = '';
    if (!orders.length) { list.appendChild(el('div', { cls: 'center' }, [el('i', { text: 'No orders yet' }), '还没有找到订单，检查一下微信昵称和电话是否和下单时一致'])); return; }
    var unpaid = orders.filter(function (o) { return o.current && !o.paid && !o.cancelled; }).length;
    list.appendChild(el('div', { cls: 'subhead', text: unpaid ? unpaid + ' 单待付款' : '全部订单' }));
    orders.forEach(function (o) { list.appendChild(orderCard(o, f)); });
  }).catch(function (e) { list.innerHTML = ''; list.appendChild(el('div', { cls: 'center', text: e.message })); });
}

function status(o) {
  if (o.cancelled) return ['已取消', 'b-done'];
  if (o.picked) return ['已取货', 'b-done'];
  if (o.paid) return ['已付款 ✓', 'b-paid'];
  if (o.claimed) return ['付款确认中', 'b-wait'];
  return ['待付款', 'b-unpaid'];
}

function orderCard(o, who) {
  var s = status(o), d = o.time ? new Date(o.time) : null;
  var kids = [
    el('div', { cls: 'ohead' }, [el('span', { cls: 'id', text: o.orderId }), el('span', { cls: 'badge ' + s[1], text: s[0] })]),
    el('div', { cls: 'small', text: (d ? (d.getMonth() + 1) + '/' + d.getDate() + ' 下单 · ' : '') + money(o.amount) }),
    el('div', { cls: 'row' }, [el('span', { text: '明细' }), el('span', { text: o.detail })]),
    o.promo ? el('div', { cls: 'row' }, [el('span', { text: '优惠' }), el('span', { text: o.promo })]) : null,
    o.pickup ? el('div', { cls: 'row' }, [el('span', { text: '取货' }), el('span', { text: o.pickup + (o.arrive ? '（约 ' + o.arrive + '）' : '') })]) : null
  ];
  if (o.current && !o.paid && !o.cancelled) {
    kids = kids.concat(payBlock(o));
    kids.push(proofBox(o, who));
  }
  if (o.current && !o.cancelled && !o.picked) {
    if (o.canCancel) kids.push(cancelBox(o, who));
    else kids.push(el('div', { cls: 'small mt', text: '已截单，如需修改或取消请直接联系店主' }));
  }
  return el('div', { cls: 'card' }, kids);
}

// 付款截图：压缩成 JPEG 再上传（手机原图太大）
function compress(file) {
  return new Promise(function (resolve, reject) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|heic|webp)$/i.test(file.name)) return reject(new Error('请选择图片'));
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var max = 1400, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      var q = 0.82, out = c.toDataURL('image/jpeg', q);
      while (out.length > 1800000 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
      resolve(out);
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('这张图打不开，请换一张截图')); };
    img.src = url;
  });
}

function proofBox(o, who) {
  var data = '';
  var preview = el('img', { cls: 'proof-preview', alt: '付款截图预览', hidden: true });
  var input = el('input', { type: 'file', accept: 'image/*', cls: 'hp' });
  var pick = el('button', { cls: 'btn ghost', text: o.claimed ? '重新上传截图' : '选择付款截图', onclick: function () { input.click(); } });
  var send = el('button', { cls: 'btn', text: '我已付款', disabled: true });
  input.addEventListener('change', function () {
    var f = input.files && input.files[0]; if (!f) return;
    pick.textContent = '处理中…';
    compress(f).then(function (d) {
      data = d; preview.src = d; preview.hidden = false; send.disabled = false; pick.textContent = '换一张';
    }).catch(function (e) { pick.textContent = '选择付款截图'; toast(e.message); });
  });
  send.addEventListener('click', function () {
    if (!data) return toast('请先选择付款截图');
    send.disabled = true; send.textContent = '上传中…';
    api('claim', { orderId: o.orderId, name: who.name, contact: who.contact, image: data })
      .then(function () { toast('已收到你的付款截图，谢谢！'); lookup(); })
      .catch(function (e) { send.disabled = false; send.textContent = '我已付款'; toast(e.message); });
  });
  return el('div', { cls: 'proof' }, [
    el('div', { cls: 'small', text: o.claimed ? '✓ 已上传付款截图，店主核对后会变成「已付款」' : '付完款请上传转账截图（Zelle / 支付宝 的付款成功页面）' }),
    preview, input,
    el('div', { cls: 'btns left' }, [pick, send])
  ]);
}

function cancelBox(o, who) {
  var wrap = el('div', { cls: 'mt' });
  var btn = el('button', { cls: 'linkbtn', text: '取消订单' });
  btn.addEventListener('click', function () {
    wrap.innerHTML = '';
    var yes = el('button', { cls: 'btn danger', text: '确定取消' });
    var no = el('button', { cls: 'btn ghost', text: '再想想', onclick: function () { wrap.innerHTML = ''; wrap.appendChild(btn); } });
    yes.addEventListener('click', function () {
      yes.disabled = true; yes.textContent = '取消中…';
      api('cancel', { orderId: o.orderId, name: who.name, contact: who.contact })
        .then(function () { toast('订单已取消'); lookup(); load(function () {}); })
        .catch(function (e) { yes.disabled = false; yes.textContent = '确定取消'; toast(e.message); });
    });
    wrap.appendChild(el('div', { cls: 'small', text: (o.claimed || o.paid) ? '确定取消 ' + o.orderId + ' 吗？已付的款项店主会联系你退款。' : '确定取消 ' + o.orderId + ' 吗？截单前可以自己取消。' }));
    wrap.appendChild(el('div', { cls: 'btns left' }, [yes, no]));
  });
  wrap.appendChild(btn);
  return wrap;
}

buildNav();
paint();
