# remiiibake 下单网站

纯静态网站（Cloudflare Pages 托管）+ Google 表格 / Apps Script 接口。

## 两个环境

| | 正式（Prod） | 测试（UAT） |
|---|---|---|
| Git 分支 | `main` | `uat` |
| 网址 | remiiibake.com、remiiibake.pages.dev | uat.remiiibake.pages.dev |
| 数据 | Google 表格「remiiibake」 | Google 表格「remiiibake UAT」 |
| 接口 | `config.js` 里的 `PROD` | `config.js` 里的 `UAT` |

网站按网址自动选接口（见 `config.js`），测试站顶部有红色「测试环境」提示条。

## 改网站的流程

1. 在 `uat` 分支上改，提交并推送。
2. 打开 uat.remiiibake.pages.dev 检查，下单测试（订单只会进测试表格）。
3. 没问题后把 `uat` 合并进 `main` 并推送，正式站自动更新。

## 改后端的流程

`backend/Code.gs` 是 Apps Script 代码的备份，不会发布到网站上。

1. 先把改动贴进测试表格的 Apps Script，部署为新版本，在测试站验证。
2. 再贴进正式表格的 Apps Script，「管理部署」里选择新版本（网址不变）。

## 图片

放在 `images/`，请用真正的 JPEG / PNG，长边不超过 1600 像素。
iPhone 直接导出的 HEIC 改后缀成 .jpg 在安卓和 Chrome 上显示不出来。
