/* Live API adapter. No simulated orders or demo product data. */
(function(){
 var baseApi=api;
 api=function(action,body){
  if(action==='order'&&!(DATA&&DATA.capabilities&&DATA.capabilities.fulfillmentV2))return Promise.reject(new Error('暂未开放在线下单，请联系店主预订。'));
  return baseApi(action,body).then(function(result){
   if(action==='menu'){if(result.payments){Object.keys(result.payments).forEach(function(k){var srv=result.payments[k],c=REMIII_PAYMENT_CONFIG[k];if(!c||!srv)return;['recipient','account','qrImage'].forEach(function(f){if(srv[f])c[f]=srv[f];});if(srv.rate)c.rate=Number(srv.rate);});}result.pays=Object.keys(REMIII_PAYMENT_CONFIG).map(function(k){return {key:REMIII_PAYMENT_CONFIG[k].label};});}
   return result;
  });
 };
 var baseCheckout=renderCheckout;
 renderCheckout=function(){baseCheckout();if(view!=='checkout')return;if(!(DATA&&DATA.capabilities&&DATA.capabilities.fulfillmentV2)){var note=el('p',{cls:'hint',text:'暂未开放在线下单，请联系店主预订。'});document.querySelector('.page-head').after(note);}};
 var baseBar=updateBar;
 updateBar=function(){baseBar();if(view==='checkout'&&!(DATA&&DATA.capabilities&&DATA.capabilities.fulfillmentV2))$('submit').disabled=true;};
 var baseLoad=load;
 // Existing API's read-only menu load; production init occurs after all extensions.
 load();
})();
