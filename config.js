/* 接口网址（Apps Script 部署出来、以 /exec 结尾的网址）。
 * 正式站和测试站各用一个接口，按网址自动选，不用手动切换：
 *   正式站（顾客用的域名）              → PROD
 *   测试站（uat.xxx / xxx--站点名.netlify.app / 本机打开）→ UAT
 * UAT 还没填时，测试站会直接报错而不是连到正式接口，避免测试订单混进真实订单。
 */
(function () {
  var PROD = 'https://script.google.com/macros/s/AKfycbyXaPwcoM7U1yRaxH2us64qUpLxajUSQ7ZX9GJnAgXczehwbyk-7kwKdyiwPjyexw8ZzA/exec';
  var UAT = ''; // ← 把测试表格部署出来的 /exec 网址贴在这对引号里

  var h = location.hostname;
  var isUat = !h || h === 'localhost' || h === '127.0.0.1' || /^uat[.-]/.test(h) || (/--/.test(h) && /\.netlify\.app$/.test(h));
  window.APP_ENV = isUat ? 'uat' : 'prod';
  window.API_URL = isUat ? UAT : PROD;

  if (isUat) {
    var tag = document.createElement('div');
    tag.textContent = '测试环境 UAT · 这里下的单不是真订单';
    tag.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:4px 8px;font:12px/1.4 system-ui,sans-serif;text-align:center;color:#fff;background:#b3261e;pointer-events:none');
    (document.body || document.documentElement).appendChild(tag);
  }
})();
