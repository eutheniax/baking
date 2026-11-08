/* Interactive checkout preview; service areas share the approved map geometry. */
var fulfillment={mode:'pickup',location:'',pickup:'',address:'',unit:'',deliveryTime:'',match:null,zone:null};
function insideDeliveryPolygon(lat,lon,ring){var inside=false;for(var i=0,j=ring.length-1;i<ring.length;j=i++){var a=ring[i],b=ring[j];if(((a[0]>lat)!==(b[0]>lat))&&(lon<(b[1]-a[1])*(lat-a[0])/(b[0]-a[0])+a[1]))inside=!inside;}return inside;}
function deliveryZone(lat,lon){if(insideDeliveryPolygon(lat,lon,STREET_BOUNDARY.polygon))return 'free';if(insideDeliveryPolygon(lat,lon,FEE_BOUNDARY.polygon))return 'paid';return 'outside';}
var fulfillmentBasePrice=priced;
priced=function(){var p=fulfillmentBasePrice();p.goods=p.amount;p.deliveryFee=view==='checkout'&&fulfillment.mode==='delivery'&&fulfillment.match&&fulfillment.zone==='paid'?dlv().fee:0;p.amount=Math.round((p.goods+p.deliveryFee)*100)/100;return p;};
var fulfillmentBaseCheckout=renderCheckout;
renderCheckout=function(){
 fulfillmentBaseCheckout();if(view!=='checkout')return;
 var form=document.querySelector('.form'),note=$('f-note');
 Array.from(form.querySelectorAll('label.f')).forEach(function(n){if(['取货时间段 *','预计几点来取（可选）'].includes(n.textContent))n.remove();});
 form.querySelectorAll('.opts').forEach(function(n){if(n.querySelector('[name=pickup]'))n.remove();});if($('f-arrive'))$('f-arrive').remove();
 var wrap=el('section',{cls:'fulfillment', 'aria-label':'收货方式'}),content=el('div',{cls:'fulfillment-content'});
 if(!dlv().enabled)fulfillment.mode='pickup';var modeBtns=(dlv().enabled?['pickup','delivery']:['pickup']).map(function(mode){return el('button',{type:'button',cls:'fulfillment-mode',text:mode==='pickup'?'自提':'配送',onclick:function(){fulfillment.mode=mode;renderMethod();}},[]);});
 wrap.appendChild(el('label',{cls:'f',text:'收货方式 *'}));wrap.appendChild(el('div',{cls:'fulfillment-modes',role:'group','aria-label':'收货方式'},modeBtns));wrap.appendChild(content);form.insertBefore(wrap,note.previousElementSibling);
 var totals=el('div',{cls:'checkout-totals','aria-live':'polite'});form.before(totals);
 var lookupVersion=0,controller;
 function refresh(){updateBar();var p=priced(),delivery=fulfillment.mode==='delivery',known=fulfillment.match&&['free','paid'].includes(fulfillment.zone);totals.replaceChildren(el('div',{},[el('span',{text:'商品金额'}),el('b',{text:money(p.goods)})]),el('div',{},[el('span',{text:delivery?'配送费':'自提'}),el('b',{text:!delivery?'免费':known?(p.deliveryFee?money(p.deliveryFee):'免费'):'确认地址后计算'})]),el('div',{cls:'checkout-total'},[el('span',{text:'合计'}),el('b',{text:delivery&&!known?'待确认':money(p.amount)})]));if(delivery){var valid=known&&p.goods>=dlv().min&&!!fulfillment.deliveryTime;$('submit').disabled=busy||!valid||!totalQty()||!(DATA.capabilities&&DATA.capabilities.fulfillmentV2);if(!known)$('total').textContent=money(p.goods)+' + 待定配送费';}}
 function renderMethod(){lookupVersion++;if(controller)controller.abort();content.replaceChildren();modeBtns.forEach(function(b,i){b.setAttribute('aria-pressed',String(fulfillment.mode===(i?'delivery':'pickup')));});
 if(fulfillment.mode==='pickup'){
  content.appendChild(el('label',{cls:'f',text:'自提地点 *'}));
  var locations=el('div',{cls:'pickup-place-options'});
  locs().forEach(function(p){var id=p.id;locations.appendChild(el('button',{type:'button',cls:'pickup-place','aria-pressed':String(fulfillment.location===id),onclick:function(){fulfillment.location=id;fulfillment.pickup='';renderMethod();}},[el('b',{text:p.area}),el('small',{text:p.address||p.name})]));});content.appendChild(locations);content.appendChild(el('button',{type:'button',cls:'text-action pickup-map-link',text:'查看自提详情 ↗',onclick:moreDelivery}));
  if(fulfillment.location){var place=locs().filter(function(p){return p.id===fulfillment.location;})[0];var times=place?place.slots:[];content.appendChild(el('label',{cls:'f',text:'自提时间 *'}));var opts=options('pickup',times,false);content.appendChild(opts);choose('pickup',fulfillment.pickup|| (times.length===1?times[0]:''));fulfillment.pickup=picked('pickup');opts.addEventListener('change',function(){fulfillment.pickup=picked('pickup');});content.appendChild(el('label',{cls:'f',text:'预计到达时间（可选）'}));var arrival=el('input',{id:'f-arrive',cls:'t',placeholder:'例如 3:30 PM',value:draft.arrive||'',maxlength:'40',oninput:function(){draft.arrive=this.value;}});content.appendChild(arrival);}
 }else{
  content.appendChild(el('div',{cls:'delivery-minimum'},[el('p',{text:'仅限 '+dlv().areas.join(' / ')+' · 商品满 $'+dlv().min+' 可配送。为提高配送效率，订单统一送至楼宇 lobby，请到 lobby 取货。确认地址后显示配送费。'}),el('button',{type:'button',cls:'text-action',text:'查看配送范围地图 ↗',onclick:moreDelivery})]));
  content.appendChild(el('label',{cls:'f',for:'delivery-address',text:'配送地址 *'}));
  var address=el('input',{id:'delivery-address',cls:'t',value:fulfillment.address,autocomplete:'street-address',placeholder:'例如：343 Gold Street, Brooklyn',maxlength:'180',oninput:function(){fulfillment.address=this.value;fulfillment.match=null;fulfillment.zone=null;lookupVersion++;if(controller)controller.abort();results.replaceChildren();status.textContent='地址已修改，请重新检查。';check.disabled=false;check.textContent='检查配送范围';refresh();}});
  var results=el('div',{cls:'address-results'}),status=el('p',{cls:'address-status',role:'status'});
  var check=el('button',{type:'button',cls:'btn ghost address-check',text:'检查配送范围',onclick:async function(){
   var query=address.value.trim();if(!/^\d+[\w-]*\s+\S+/.test(query)){status.textContent='请填写街道名称，填写楼宇名识别不出来哦';return;}
   var version=++lookupVersion;fulfillment.match=null;fulfillment.zone=null;results.replaceChildren();status.textContent='正在查找地址…';check.disabled=true;refresh();controller=new AbortController();var timeout=setTimeout(function(){controller.abort();},12000);
   try{var url=new URL('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates');url.search=new URLSearchParams({SingleLine:query+(/brooklyn|new york|\bny\b/i.test(query)?'':', Brooklyn, NY'),f:'json',outFields:'Addr_type,Match_addr',maxLocations:'5',countryCode:'USA',outSR:'4326',forStorage:'false'}).toString();var res=await fetch(url,{signal:controller.signal});if(!res.ok)throw Error('lookup');var data=await res.json();if(version!==lookupVersion||!content.isConnected)return;
   var number=query.match(/^\S+/)[0].toLowerCase();var matches=(data.candidates||[]).filter(function(c){return c.score>=95&&['PointAddress','StreetAddress','Subaddress'].includes(c.attributes.Addr_type)&&c.address.toLowerCase().startsWith(number+' ')&&c.location&&Number.isFinite(c.location.x)&&Number.isFinite(c.location.y);});
   if(!matches.length){status.textContent='未找到准确门牌。请补充街道、Brooklyn 和邮编后重试；仍找不到时请联系我确认。';return;}
   status.textContent='请选择与你填写地点一致的完整地址：';matches.forEach(function(c){results.appendChild(el('button',{type:'button',cls:'address-candidate',text:c.address,onclick:function(){fulfillment.match={address:c.address,lat:c.location.y,lon:c.location.x};fulfillment.zone=deliveryZone(c.location.y,c.location.x);results.replaceChildren();showMatch(status);refresh();}}));});
   }catch(e){if(version===lookupVersion)status.textContent='暂时无法查询地址，请稍后重试；配送费尚未确认。';}finally{clearTimeout(timeout);if(version===lookupVersion){check.disabled=false;check.textContent='重新检查地址';}}
  }});
  content.append(address,check,results,status);
  if(fulfillment.match)showMatch(status);
  content.appendChild(el('label',{cls:'f',for:'delivery-unit',text:'Lobby 交接备注（可选）'}));content.appendChild(el('input',{id:'delivery-unit',cls:'t',maxlength:'80',value:fulfillment.unit,placeholder:'例如：lobby 入口在侧门',oninput:function(){fulfillment.unit=this.value;}}));
  content.appendChild(el('label',{cls:'f',text:'配送时间 *'}));var choices=options('delivery-time',dlv().slots,false);content.appendChild(choices);choose('delivery-time',fulfillment.deliveryTime);fulfillment.deliveryTime=picked('delivery-time');choices.addEventListener('change',function(){fulfillment.deliveryTime=picked('delivery-time');refresh();});
  if(fulfillmentBasePrice().amount<dlv().min)content.appendChild(el('p',{cls:'fulfillment-warning',text:'还差 '+money(dlv().min-fulfillmentBasePrice().amount)+' 商品金额即可配送。可继续选购，或选择自提。'}));
 }
 refresh();
 }
 function showMatch(status){status.replaceChildren(el('b',{text:fulfillment.match.address}),el('span',{text:fulfillment.zone==='free'?'在免配送费范围内 · 配送费 $0':fulfillment.zone==='paid'?'在配送范围内 · 配送费 $'+dlv().fee:'此地址不在配送范围内，请选择自提或更换地址。'}));}
 renderMethod();
};
var fulfillmentOriginalSubmit=submitOrder;
submitOrder=function(){
 if(busy)return;
 if(fulfillment.mode==='pickup'){
  if(!fulfillment.location||!picked('pickup'))return showErr('请选择自提地点和时间');
  fulfillment.pickup=picked('pickup');
 }else{
  if(!fulfillment.match||!['free','paid'].includes(fulfillment.zone))return showErr('请先确认配送地址在范围内');
  if(fulfillmentBasePrice().amount<dlv().min)return showErr('商品满 $'+dlv().min+' 才可配送');
  if(!fulfillment.deliveryTime)return showErr('请选择配送时间');
 }
 var items=[];for(var k in cart)if(cart[k]>0)items.push({name:k,qty:cart[k]});
 var method=fulfillment.mode==='pickup'?(fulfillment.location+' · '+fulfillment.pickup):('配送（仅送 lobby） · '+fulfillment.deliveryTime+' · '+fulfillment.match.address+(fulfillment.unit?' · '+fulfillment.unit:''));
 var p=priced(),form={name:$('f-name').value.trim(),contact:$('f-contact').value.trim(),note:$('f-note').value.trim(),arrive:$('f-arrive')?$('f-arrive').value.trim():'',pickup:method,pay:picked('pay'),items:items,website:$('f-website').value,promo:p.choice,fulfillment:JSON.parse(JSON.stringify(fulfillment)),deliveryFee:p.deliveryFee,goods:p.goods};
 if(!form.name||!form.contact)return showErr('请填写微信昵称和电话');
 if(DATA.pays.length&&!form.pay)return showErr('请选择付款方式');
 store('rb-name',form.name);store('rb-contact',form.contact);busy=true;showErr('');updateBar();
 api('order',form).then(function(r){r.fulfillment=form.fulfillment;r.deliveryFee=form.deliveryFee;r.goods=form.goods;r.note=form.note;busy=false;cart={};draft={};promoChoice='';lastOrder=r;fulfillment={mode:'pickup',location:'',pickup:'',address:'',unit:'',deliveryTime:'',match:null,zone:null};go('done');}).catch(function(e){busy=false;saveDraft();paint();showErr(e.message);});
};
var fulfillmentDone=renderDone;
renderDone=function(r){fulfillmentDone(r);};
