/* 收款信息默认从 Google 表格「设置」读取（Zelle / Zelle 收款人 / 支付宝账号 / 支付宝收款人 / 收款码 / 支付宝汇率）。
 * 这里只是备用：表格里没填时才会用到这里的值。 */
window.REMIII_PAYMENT_CONFIG={
 alipay:{label:'支付宝 · 人民币',currency:'CNY',rate:6.7,recipient:'',account:'',qrImage:''},
 zelle:{label:'Zelle · 美元',currency:'USD',rate:1,recipient:'',account:'',qrImage:''}
};
