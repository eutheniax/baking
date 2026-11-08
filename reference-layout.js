/* Standalone visual study based on the supplied layout references. */
var originalReferenceHome=renderHome;
renderHome=function(){
 originalReferenceHome();
 var app=document.getElementById('app'),hero=app.querySelector('.hero');
 hero.querySelectorAll('.tagline').forEach(function(n){n.remove();});
 var actions=app.querySelector('.primary-actions');
 if(actions&&DATA.notice)actions.after(el('section',{cls:'week-notice','aria-label':'本周说明'},[el('span',{cls:'week-notice-label',text:'This Week'}),el('p',{text:DATA.notice})]));
 actions.querySelectorAll('.primary-action').forEach(function(b,i){b.querySelector('b').innerHTML=i?'我的<br>订单':'本周<br>菜单';});
 var delivery=app.querySelector('.service-summary');
 if(delivery){delivery.querySelector('.summary-label').textContent='Pickup & Delivery';var heading=document.createElement('strong');heading.className='delivery-title';heading.textContent='自提与配送';delivery.prepend(heading);var icon=art(ART.icons.retrait,'delivery-art');delivery.appendChild(icon);}
 var old=app.querySelector('.community');var section=el('section',{cls:'reference-discover'},[
 el('div',{cls:'discover-heading'},[el('span',{text:'A little more about us'}),el('i',{text:'❦'})]),
 el('div',{cls:'discover-grid'},[
 el('button',{cls:'discover-card',onclick:function(){sheet(el('div',{cls:'sheet-body reference-story'},[sectionTitle('About Remiii','关于 Remiii'),aboutSection()]));}},[el('span',{text:'01'}),el('b',{text:'关于 Remiii'}),el('i',{text:'Our story'}),el('em',{text:'↗'})]),
 el('button',{cls:'discover-card',onclick:function(){sheet(el('div',{cls:'sheet-body reference-wish'},[wishSection()]));}},[el('span',{text:'02'}),el('b',{text:'甜点心愿单'}),el('i',{text:'Baking wishlist'}),el('em',{text:'↗'})]),
 el('button',{cls:'discover-card',onclick:function(){sheet(el('div',{cls:'sheet-body reference-faq'},[faqSection()]));}},[el('span',{text:'03'}),el('b',{text:'常见问题'}),el('i',{text:'Q&A'}),el('em',{text:'↗'})])])]);
 section.querySelectorAll('.discover-card').forEach(function(card){card.prepend(art(ART.bow,'discover-bow'));});
 old.replaceWith(section);
};
if(DATA)paint();

/* 多张图：左右滑动，下方圆点；电脑上有左右箭头 */
function galleryView(images){
 var track=el('div',{cls:'gallery'},images.length?images.map(function(src){return photo(src);}):[photo('')]);
 if(images.length<2)return track;
 var dots=images.map(function(_,i){return el('i',{cls:i?'':'on'});});
 function index(){return Math.round(track.scrollLeft/Math.max(1,track.clientWidth));}
 function go(i){i=Math.max(0,Math.min(images.length-1,i));track.scrollTo({left:i*track.clientWidth,behavior:'smooth'});}
 track.addEventListener('scroll',function(){var n=index();dots.forEach(function(d,i){d.classList.toggle('on',i===n);});prev.disabled=n===0;next.disabled=n===images.length-1;},{passive:true});
 var prev=el('button',{type:'button',cls:'gallery-arrow prev','aria-label':'上一张',text:'‹',disabled:true,onclick:function(){go(index()-1);}});
 var next=el('button',{type:'button',cls:'gallery-arrow next','aria-label':'下一张',text:'›',onclick:function(){go(index()+1);}});
 return el('div',{cls:'gallery-wrap'},[track,prev,next,el('div',{cls:'gallery-dots'},dots)]);
}

/* Product detail: select quantity locally, then explicitly add to the bag. */
openDetail=function(it,rowStep){
 var quantity=1,images=it.imgs||[],soldout=it.left<=0;
 function available(){return Math.max(0,Math.min(it.left-(cart[it.name]||0),DATA.maxQty-totalQty()));}
 var minus=el('button',{type:'button',cls:'detail-minus','aria-label':'减少数量',text:'−',onclick:function(){if(quantity>1){quantity--;draw();}}});
 var count=el('span',{cls:'detail-quantity','aria-live':'polite'});
 var plus=el('button',{type:'button',cls:'detail-plus','aria-label':'增加数量',text:'+',onclick:function(){if(quantity<available()){quantity++;draw();}}});
 var price=el('span',{cls:'detail-button-price'}),label=el('span',{text:'加入购物车'});
 var add=el('button',{type:'button',cls:'detail-add',onclick:function(){var max=available();if(max<quantity){toast('可选数量已变化，请重新选择');quantity=Math.max(1,max);draw();return;}cart[it.name]=(cart[it.name]||0)+quantity;if(rowStep)rowStep.sync();updateBar();close();toast('已加入购物车');}},[price,label]);
 function draw(){var max=available();count.textContent=String(quantity);minus.disabled=quantity<=1;plus.disabled=quantity>=max;add.disabled=max===0;price.textContent=money(it.price*quantity);label.textContent=soldout?'已售罄':max===0?'已达可购上限':'加入购物车';}
 var gallery=galleryView(images);
 var content=el('div',{cls:'product-detail'},[
 gallery,
 el('div',{cls:'product-detail-info'},[el('div',{cls:'sname'},nameWithTag(it.name)),soldout?el('p',{cls:'product-stock',text:'已售罄'}):null,it.desc?el('div',{cls:'sdesc',text:it.desc}):null]),
 el('div',{cls:'product-detail-footer'},[el('div',{cls:'detail-stepper'},[minus,count,plus]),add])
 ]);
 var close=sheet(content);content.parentElement.classList.add('product-detail-sheet');draw();
};
