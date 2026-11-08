(function(){
 var config=window.REMIII_PAYMENT_CONFIG;
 function method(label){return Object.keys(config).find(function(k){return config[k].label===label;});}
 if(DATA)DATA.pays=Object.keys(config).map(function(k){return {key:config[k].label};});
 function converted(usd,rate){return Math.round(Math.round(usd*100)*rate)/100;}
 function paymentText(p){return (p.currency==='CNY'?'¥':'$')+p.amount.toFixed(2)+' '+p.currency;}
 function updatePaymentQuote(){var box=$('payment-quote');if(!box)return;var id=method(picked('pay'));if(!id){box.textContent='请选择付款方式，提交后显示对应收款信息。';return;}var m=config[id],known=fulfillment.mode!=='delivery'||(fulfillment.match&&['free','paid'].includes(fulfillment.zone));if(!known){box.textContent='请先确认配送地址，配送费确认后计算应付金额。';return;}var quote={currency:m.currency,amount:converted(priced().amount,m.rate)};box.replaceChildren(el('b',{text:'应付 '+paymentText(quote)}),el('span',{text:(id==='alipay'?'固定汇率：1 USD = '+m.rate+' RMB':'按美元订单合计付款')+(fulfillment.mode==='delivery'?'，包含适用的配送费。':'。')}));}
 var baseCheckout=renderCheckout;
 renderCheckout=function(){baseCheckout();if(view!=='checkout')return;var group=document.querySelector('input[name=pay]');if(!group)return;var opts=group.closest('.opts');opts.classList.add('payment-options');var quote=el('div',{id:'payment-quote',cls:'payment-quote','aria-live':'polite'});opts.after(quote);opts.addEventListener('change',function(){draft.pay=picked('pay');updatePaymentQuote();});updatePaymentQuote();};
 var baseBar=updateBar;updateBar=function(){baseBar();updatePaymentQuote();};
 var baseApi=api;api=function(action,body){if(action!=='order')return baseApi(action,body);var id=method(body.pay);if(!id)return Promise.reject(new Error('请选择付款方式'));var m=config[id],usd=priced().amount;if(!m.account&&!m.qrImage)return Promise.reject(new Error('该付款方式暂未开放，请联系店主。'));
 var payment={method:id,label:m.label,currency:m.currency,rate:m.rate,amount:converted(usd,m.rate),usdAmount:usd,recipient:m.recipient,account:m.account,qrImage:m.qrImage};
 body.payment={method:id,currency:m.currency,rate:m.rate};return baseApi(action,body).then(function(order){if(Math.abs(Number(order.amount)-usd)>0.005)throw new Error('订单金额需店主核对，请勿付款。订单号：'+(order.orderId||''));order.pay=m.label;order.payment=payment;return order;});};
 payBlock=function(order){var p=order.payment;if(!p)return [el('p',{cls:'hint',text:'尚未选择付款方式。'})];var content=[el('div',{cls:'payment-heading',text:p.label}),el('div',{cls:'payment-amount',text:'应付 '+paymentText(p)+(p.currency==='CNY'?'（'+money(p.usdAmount)+' × '+p.rate+'）':'')})];
 if(p.recipient)content.push(el('div',{cls:'row'},[el('span',{text:'收款人'}),el('b',{text:p.recipient})]));
 if(p.account)content.push(el('div',{cls:'row'},[el('span',{text:p.method==='alipay'?'支付宝账号':'Zelle 邮箱 / 手机号'}),el('span',{},[p.account,copyBtn(p.account)])]));
 content.push(el('p',{cls:'payment-instruction',text:'付款时请备注订单号 '+order.orderId+'。付款成功后才算预订成功。'}));
 if(p.qrImage)content.push(el('img',{cls:'payment-qr',src:p.qrImage,alt:p.label+'收款码'}));
 if(!p.account&&!p.qrImage){content.push(el('div',{cls:'payment-placeholder'},[el('div',{cls:'row'},[el('span',{text:'收款人'}),el('span',{text:'待填写'})]),el('div',{cls:'row'},[el('span',{text:p.method==='alipay'?'支付宝账号':'Zelle 邮箱 / 手机号'}),el('span',{text:'待填写'})]),el('div',{cls:'payment-qr-placeholder',text:p.method==='alipay'?'支付宝收款码占位':'Zelle 收款码占位'})]));}

 return [el('section',{cls:'payment-instructions'},content)];};
 var baseOrderCard=orderCard;orderCard=function(o,who){var card=baseOrderCard(o,who);if(o.payment&&!o.current)payBlock(o).forEach(function(n){card.appendChild(n);});return card;};
})();
