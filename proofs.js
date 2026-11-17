/* 付款截图：一次可以选多张，逐张压缩上传；每个订单最多 PROOF_MAX 张（和后端 MAX_PROOFS 一致）。
 * 覆盖 app.js 里的 uploadProofButton（下单成功页）和 proofBox（我的订单）。 */
(function () {
  var PROOF_MAX = 6;

  // 依次上传，返回最后一次的已上传张数；onStep(第几张, 共几张) 用来更新按钮文字
  function uploadMany(files, who, orderId, onStep) {
    var done = 0, count = null;
    return files.reduce(function (p, f) {
      return p.then(function () {
        onStep(done + 1, files.length);
        return Promise.resolve(f.data || compress(f)).then(function (data) {
          return api('claim', { orderId: orderId, name: who.name, contact: who.contact, image: data });
        }).then(function (res) {
          done++;
          count = res && typeof res.count === 'number' ? res.count : null;
        });
      });
    }, Promise.resolve()).then(function () { return { done: done, count: count }; });
  }

  function pickInput() { return el('input', { type: 'file', accept: 'image/*', multiple: true, cls: 'hp' }); }
  function filesOf(input) { return Array.prototype.slice.call(input.files || []); }

  // 下单成功页：选好就直接上传，可以分几次传
  uploadProofButton = function (r) {
    var uploaded = 0;
    var input = pickInput();
    var note = el('div', { cls: 'proof-note small', text: '可以一次选多张（最多 ' + PROOF_MAX + ' 张），比如分两笔付款的截图' });
    var btn = el('button', { cls: 'btn ghost', text: '上传付款凭证', onclick: function () { if (!btn.disabled) input.click(); } });
    input.addEventListener('change', function () {
      var files = filesOf(input), room = PROOF_MAX - uploaded;
      input.value = '';
      if (!files.length) return;
      if (room <= 0) return toast('每个订单最多上传 ' + PROOF_MAX + ' 张');
      if (files.length > room) { files = files.slice(0, room); toast('最多还能传 ' + room + ' 张，多出来的没有上传'); }
      btn.disabled = true;
      var who = { name: store('rb-name'), contact: store('rb-contact') };
      uploadMany(files, who, r.orderId, function (i, n) { btn.textContent = n > 1 ? '上传中 ' + i + '/' + n + '…' : '上传中…'; })
        .then(function (res) {
          uploaded = res.count != null ? res.count : uploaded + res.done;
          toast('已收到 ' + res.done + ' 张付款截图，店主核对后会确认');
        })
        .catch(function (e) { toast(e.message); })
        .then(function () {
          btn.disabled = uploaded >= PROOF_MAX;
          btn.textContent = uploaded ? '再传一张' : '上传付款凭证';
          note.textContent = uploaded ? '✓ 已上传 ' + uploaded + ' 张' + (uploaded >= PROOF_MAX ? '（已达上限）' : '') : note.textContent;
        });
    });
    return el('span', { cls: 'upload-proof' }, [btn, input, note]);
  };

  // 我的订单：先选、可预览和删掉，再一起上传
  proofBox = function (o, who) {
    var have = o.proofCount != null ? o.proofCount : (o.hasProof || o.claimed ? 1 : 0);
    var chosen = [];
    var input = pickInput();
    var thumbs = el('div', { cls: 'proof-thumbs' });
    var status = el('div', { cls: 'small' });
    var pick = el('button', { cls: 'btn ghost', onclick: function () { input.click(); } });
    var send = el('button', { cls: 'btn' });

    function draw() {
      var room = PROOF_MAX - have - chosen.length;
      status.textContent = have
        ? '✓ 已上传 ' + have + ' 张付款截图，店主核对后会变成「已付款」' + (have < PROOF_MAX ? '。还可以补传。' : '')
        : '付完款请上传转账截图（Zelle / 支付宝 的付款成功页面），可以选多张';
      thumbs.replaceChildren.apply(thumbs, chosen.map(function (c, i) {
        return el('div', { cls: 'proof-thumb' }, [
          el('img', { src: c.data, alt: '付款截图预览 ' + (i + 1) }),
          el('button', { cls: 'proof-x', 'aria-label': '移除这张', text: '×', onclick: function () { chosen.splice(i, 1); draw(); } })
        ]);
      }));
      thumbs.hidden = !chosen.length;
      pick.textContent = chosen.length ? '再选几张' : (have ? '补传截图' : '选择付款截图');
      pick.disabled = room <= 0;
      pick.hidden = have >= PROOF_MAX;
      send.textContent = chosen.length ? '上传 ' + chosen.length + ' 张' : '我已付款';
      send.disabled = !chosen.length;
      send.hidden = have >= PROOF_MAX;
    }

    input.addEventListener('change', function () {
      var files = filesOf(input), room = PROOF_MAX - have - chosen.length;
      input.value = '';
      if (!files.length) return;
      if (files.length > room) { files = files.slice(0, room); toast('每个订单最多 ' + PROOF_MAX + ' 张，多出来的没有加进来'); }
      pick.disabled = true; pick.textContent = '处理中…';
      files.reduce(function (p, f) {
        return p.then(function () { return compress(f).then(function (d) { chosen.push({ data: d }); }); });
      }, Promise.resolve()).catch(function (e) { toast(e.message); }).then(draw);
    });

    send.addEventListener('click', function () {
      if (!chosen.length) return toast('请先选择付款截图');
      send.disabled = true; pick.disabled = true;
      var list = chosen.slice();
      uploadMany(list, who, o.orderId, function (i, n) { send.textContent = '上传中 ' + i + '/' + n + '…'; })
        .then(function (res) { toast('已收到 ' + res.done + ' 张付款截图，谢谢！'); lookup(); })
        .catch(function (e) {
          toast(e.message);
          lookup(); // 刷新一下，显示已经成功上传的张数
        });
    });

    draw();
    return el('div', { cls: 'proof' }, [status, thumbs, input, el('div', { cls: 'btns left' }, [pick, send])]);
  };
})();
