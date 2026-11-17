/* 每月新品弹窗：顾客当月第一次打开网站时，弹出一张卡片介绍本月新品。
 * 新品 = 菜单里名称以【新品】开头的商品（和 NEW 标签同一个规则）。
 * 同一台手机/浏览器每月只弹一次；如果这个月中途又加了新品，会再弹一次。
 * 测试用：网址后面加 ?newpop 可以强制弹出。 */
(function () {
  var KEY = 'rb-newpop', checked = false;

  function newItems() {
    return ((DATA && DATA.menu) || []).filter(function (it) { return isNewItem(it.name); });
  }
  function signature(items) {
    var d = new Date(), month = d.getFullYear() + '-' + (d.getMonth() + 1);
    return month + '|' + items.map(function (it) { return plainName(it.name); }).sort().join('、');
  }

  function show(items) {
    var close;
    var list = items.map(function (it) {
      var soldout = it.left <= 0;
      return el('button', { cls: 'newpop-item' + (soldout ? ' soldout' : ''), onclick: function () { close(); setTimeout(function () { openDetail(it); }, 280); } }, [
        photo((it.imgs || [])[0]),
        el('span', { cls: 'newpop-text' }, [
          el('span', { cls: 'newpop-name', text: plainName(it.name) }),
          it.desc ? el('span', { cls: 'newpop-desc', text: it.desc }) : null,
          el('span', { cls: 'newpop-price', text: soldout ? '已售罄' : money(it.price) })
        ])
      ]);
    });
    var content = el('div', { cls: 'newpop' }, [
      el('div', { cls: 'newpop-en', text: 'New This Month' }),
      el('div', { cls: 'newpop-zh', text: (new Date().getMonth() + 1) + ' 月新品' }),
      el('div', { cls: 'newpop-list' }, list),
      el('button', { cls: 'btn newpop-go', text: DATA.open ? '去点单' : '看看本周菜单', onclick: function () { close(); go('menu'); } })
    ]);
    close = sheet(content);
    content.parentElement.classList.add('newpop-sheet');
  }

  function maybeShow() {
    if (checked || !DATA || (view !== 'home' && view !== 'menu')) return;
    checked = true;
    var items = newItems();
    if (!items.length) return;
    var force = /[?&]newpop\b/.test(location.search), sig = signature(items);
    if (!force && store(KEY) === sig) return;
    store(KEY, sig);
    setTimeout(function () { if (!document.querySelector('.sheet.show')) show(items); }, 500);
  }

  var basePaint = paint;
  paint = function () { basePaint.apply(this, arguments); maybeShow(); };
})();
