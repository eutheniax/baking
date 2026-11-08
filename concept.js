var concept='b';
var baseHome=renderHome;
function sectionTitle(en,zh){return el('div',{cls:'section-title'},[el('h2',{text:en}),el('span',{text:zh})]);}
function detailRow(title,text){return el('div',{cls:'service-row'},[el('b',{text:title}),el('p',{text:text})]);}
/* 取货地点、配送、截单时间全部来自 Google 表格（「取货地点」表和「设置」表） */
function locs(){return (DATA&&DATA.locations)||[];}
function dlv(){return (DATA&&DATA.delivery)||{enabled:false,areas:[],slots:[],min:0,fee:0};}
// 同一天的时段合并：「周五 11/13 1:00pm–5pm、6:30pm–10:30pm」
function fmtSlots(slots){var groups=[],by={};(slots||[]).forEach(function(s){var m=String(s).match(/^(周[日一二三四五六]\s+\d{1,2}\/\d{1,2})\s+(.+)$/);var k=m?m[1]:'',t=m?m[2]:String(s);if(!(k in by)){by[k]=[];groups.push(k);}by[k].push(t);});return groups.map(function(k){return (k?k+' ':'')+by[k].join('、');}).join('；');}
// 首页摘要：状态相同的地点放一行，如「Midtown / 哥大 · 仅自提」
function groupedLocations(){var order=[],by={};locs().forEach(function(p){var label=p.delivery&&dlv().enabled?'自提 / 配送':'仅自提';if(!by[label]){by[label]=[];order.push(label);}by[label].push(p.area);});return order.map(function(label){return {areas:by[label].join(' / '),label:label};});}
function cutoffText(){return (DATA&&DATA.cutoff)||'每周二 8:00 PM';}
var freeDeliveryBuildings=['The Eagle','The Giovanni','99 Fleet Place','DWTN','AVA Fort Greene','AVA DoBro','Avalon Willoughby Square','Maxwell','The Brooklyner','City Tower','The Azure','Brooklyn Tower','The Brook','Eighty Nine DeKalb','11 Hoyt','House55'];
function mapLink(address){return el('a',{cls:'address-link',href:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address),target:'_blank',rel:'noopener noreferrer',text:address+' ↗'});}
function deliveryContent(){return el('div',{cls:'service-content'},[
 el('h3',{cls:'service-subhead',text:'Pickup · 自提'}),
 el('div',{cls:'pickup-locations'},locs().map(function(p){return el('article',{cls:'pickup-location'},[el('b',{text:p.area}),p.name?el('span',{cls:'building-name',text:p.name}):null,p.address?mapLink(p.address):null,el('p',{cls:'pickup-time',text:fmtSlots(p.slots)})]);})),
 dlv().enabled?el('h3',{cls:'service-subhead',text:'Delivery · 配送'}):null,
 dlv().enabled?el('p',{cls:'delivery-minimum',text:'订单满 $'+dlv().min+' 可配送，仅限 '+dlv().areas.join(' / ')+' 配送范围。为提高配送效率，订单统一送至楼宇 lobby，请到 lobby 取货。'}):el('p',{cls:'delivery-minimum',text:'本周暂不配送，请选择自提。'}),
 dlv().enabled?el('p',{cls:'delivery-schedule',text:fmtSlots(dlv().slots)}):null,
 el('div',{cls:'delivery-map-card'},[
  el('iframe',{cls:'delivery-map',src:'walking-map/?embed=1&v=fee5',title:'配送范围地图：深棕色免配送费，浅棕色配送费加 $'+dlv().fee,loading:'lazy'}),
  el('a',{cls:'delivery-map-expand',href:'walking-map/?v=fee5',target:'_blank',rel:'noopener noreferrer',text:'放大查看地图 ↗'})
 ]),
 el('div',{cls:'delivery-charge'},[el('b',{text:'深棕色区域'}),el('span',{text:'免配送费'})]),
 el('div',{cls:'delivery-charge'},[el('b',{text:'浅棕色区域'}),el('span',{text:'配送费 +$'+dlv().fee})]),
 el('p',{cls:'service-note',text:'配送范围以地图标示为准。'}),
 el('p',{cls:'service-note',text:'更多区域 · 解锁中，敬请期待。'})
]);}
function moreDelivery(){sheet(el('div',{cls:'sheet-body delivery-details'},[deliveryContent()]));}
function orderingSchedule(){return el('div',{cls:'ordering-schedule'},[
 el('div',{},[el('span',{text:'菜单发布'}),el('b',{text:'每周日 8:00 PM'})]),
 el('div',{},[el('span',{text:'预订截止'}),el('b',{text:cutoffText()})]),
 el('p',{text:'EST · 付款成功后才算预订成功'})
]);}

function actions(){return el('div',{cls:'primary-actions'},[
 el('button',{cls:'primary-action',onclick:function(){go('menu');}},[art(ART.icons.carte,'action-art'),el('b',{text:'本周菜单'}),el('span',{text:'Menu'}),el('i',{text:'↗'})]),
 el('button',{cls:'primary-action',onclick:function(){go('me');}},[art(ART.icons.compte,'action-art'),el('b',{text:'我的订单'}),el('span',{text:'My Orders'}),el('i',{text:'↗'})])]);}
function fullService(){return el('section',{cls:'service-panel'},[sectionTitle('Pickup & Delivery','自提与配送'),deliveryContent(),el('button',{cls:'text-action',text:'查看区域与取货说明 ↗',onclick:moreDelivery})]);}
function compactService(){return el('button',{cls:'service-summary',onclick:moreDelivery,'aria-label':'查看自提配送的费用、范围与时间'},[
 el('span',{cls:'summary-label',text:'Pickup & Delivery'}),
 el('div',{cls:'summary-locations'},groupedLocations().map(function(g){return el('div',{cls:'summary-location'},[el('strong',{text:g.areas}),el('span',{text:g.label})]);})),
 el('span',{cls:'summary-link',text:'查看详情 ↗'})
]);}
function aboutSection(){var paragraphs=["remiiibake 这个名字，来自我很喜欢的电影《料理鼠王》里的小老鼠 Remy——一只没人看好的小老鼠凭着对味道的热爱做出了打动人心的料理。它让我相信，不管你是谁，只要真心喜欢，就能做出好吃的东西。而我最喜欢的一幕，是别人吃了他做的菜后脸上露出幸福的样子，而他也跟着开心起来。那份喜悦我也一直想拥有。", "我本来就是一个非常爱吃甜品的人。一口绵软的蛋糕，一勺香甜的奶油，总能让我瞬间开心起来。我一直相信，大事化小，小事化成小蛋糕。后来我开始自己动手做蛋糕，才发现原来还有一种幸福比自己吃到还要甜：每次收到朋友和顾客的消息，说我的蛋糕特别好吃、让他们很快乐，我的嘴角都会不自觉地上扬，开心从心底一点点溢出来。那一刻我好像终于懂了 Remy。原来亲手做出一份好吃的东西，再看着它让别人开心，是这么有成就感的一件事。", "而越做下去，我越发现，幸福不只在吃到的那一口，也藏在做它的每一刻里。我喜欢把厨房的灯关掉，只留下烤箱那一盏暖黄的小灯，看蝴蝶酥在里面一层一层慢慢开酥。把三分之一的蛋白霜拌回面糊时，那轻轻的声音特别治愈，像一脚踩在棉花上，又像在触摸一朵云。用刀轻轻切开可露丽，尝上一口，我会在心里默念十遍\"太美味了\"，然后在厨房里开心地转圈圈。还有凌晨三点烤麻薯时满屋子的香气，那是我心目中最最幸福的味道，世界上真该有一瓶这个香味的香水。", "做得越多，我就越好奇这些美好是怎么来的。为什么戚风要翻拌，不能搅拌？因为蛋白霜里那些细小的气泡，是蛋糕轻盈的秘密，用力一搅，它们就破了。为什么可露丽的面糊要冷藏至少一天？因为面粉需要时间慢慢吸饱水分，面糊需要时间安静下来，香草和朗姆酒的味道也需要时间彼此融合。顺着这些原理往下摸索，我又发现每一种甜品背后都藏着一段属于它的风土和故事。你知道吗，很久以前，葡萄牙的修道院会用大量蛋白浆挺修士们的衣服，剩下的蛋黄舍不得浪费，便被做成了一只只小小的蛋挞。后来修道院关闭，配方辗转传到了附近一家制糖厂的手里，于是乎———蛋挞从里斯本的一条小街，一路香到了世界各地。原来我们手里这一只酥脆又温暖的葡式蛋挞，最初只是一份不想浪费的心意。每次想到这里，我都觉得，吃一块甜品，也像是在尝一个地方的故事。", "也许这就是人那么爱吃东西的原因吧！好吃的东西里，藏着别人的用心，也藏着一段段时光，所以每次吃到好吃的总能让人觉得被温柔地照顾着。而为一个人认真做一块蛋糕，就像轻轻对ta说一句：今天也要好好的呀。", "所以吃蛋糕很幸福，做蛋糕很幸福，研究蛋糕很幸福，看到大家吃我的蛋糕，更幸福。我希望 remiiibake 是一个有爱的地方，希望蛋糕不只出现在节日和纪念日，而是自然地走进你的日常：一个晴天，一杯咖啡，朋友的一次小聚，或者只是想对自己好一点的时候。", "每一个蛋糕里，都放着我的心意。希望你吃到的时候，也能感受到。"];return el('section',{cls:'about-section story'},paragraphs.map(function(text){return el('p',{text:text});}).concat([el('p',{cls:'story-signoff'},[el('strong',{text:'Bon appetite!'})])]));}
function wishSection(){
 var input=el('textarea',{id:'wish',maxlength:'300',placeholder:'比如：开心果泡芙，或者小时候吃过的那种蛋糕…','aria-label':'想吃的甜点'});
 var result=el('p',{cls:'wish-result',role:'status'});
 var form=el('form',{onsubmit:function(e){e.preventDefault();result.textContent='心愿单暂未开放提交，请私信告诉我你想吃的甜点。';}},[input,el('div',{cls:'wish-bottom'},[el('span',{text:'灵感征集，不是定制订单'}),el('button',{type:'submit',cls:'btn ghost',text:'暂未开放',disabled:true})]),result]);
 return el('section',{cls:'wish-section'},[sectionTitle('Baking Wishlist','甜点心愿单'),el('p',{text:'下次想吃什么？告诉我，也许就会出现在下周菜单里。'}),form]);
}
function faqSection(){
 var sections=[
 ['Orders','订单相关',[
 ['什么时候发菜单、什么时候截单？','每周日 8:00 PM 在群内发布菜单，本周截单时间：'+cutoffText()+'。均为 EST。'],
 ['下单后怎么付款？','下单后请完成付款，付款成功后才算预订成功。支持 Zelle / 支付宝，支付宝按固定汇率 1 美元 = '+((window.REMIII_PAYMENT_CONFIG&&REMIII_PAYMENT_CONFIG.alipay.rate)||6.7)+' 元人民币换算。'],
 ['为什么需要全款预付？','甜品按订单现做，截单后按数量采购原料并开始备料，因此需要全款预付。'],
 ['下单后可以取消或转出吗？','不支持取消单品或转出单品，仅支持整单取消 / 整单转出。截单后已经开始备料，无法取消订单。'],
 ['截单后还能订吗？','截单后原则上不再加单。如果有多做的，会在群 / 朋友圈通知，先到先得。'],
 ['付款后怎么确认订单？','付款后会私信发送订单确认，包括口味、数量和取货时间。请保留聊天记录及转账记录。'],
 ['每周口味都一样吗？在哪里看菜单？','部分经典口味会固定出现，也会不定期推出季节限定。每周菜单会在群内发布。']
 ]],
 ['Pickup & Delivery','自提与配送',[
 ['在哪里、什么时候可以自提？',locs().map(function(p){return p.area+(p.name?'：'+p.name:'')+(p.address?'，'+p.address:'')+'；'+fmtSlots(p.slots)+(p.delivery&&dlv().enabled?'。':'，仅自提。');}).join('\n\n')+'\n\n具体交接位置会在订单确认后私信告知。'],
 ['配送门槛、范围和费用是什么？',dlv().enabled?'订单满 $'+dlv().min+' 可配送。地图深棕色区域免配送费，浅棕色区域配送费 +$'+dlv().fee+'，配送范围以地图标示为准。为提高配送效率，订单统一送至楼宇 lobby，请到 lobby 取货。仅 '+dlv().areas.join(' / ')+' 支持配送。':'本周暂不配送，请选择自提。'],
 ['配送时间是什么时候？',dlv().enabled?fmtSlots(dlv().slots)+'，均为 EST。':'本周暂不配送。'],
 ['取货时间赶不上怎么办？','请提前联系我预约时间。如果没有提前告知且当天也联系不上，订单保留到当天 11:00 PM，之后视为放弃，不退款。'],
 ['可以让朋友帮忙取吗？','可以，请提前告知。代取人凭你的委托截图取货。']
 ]],
 ['Sizes','份量与包装',[
 ['盒子有多大？','奶冻杯：4 oz，约 120 ml；约 6 × 6 cm。\n小盒子蛋糕：10 oz，约 300 ml；约 13 × 8.5 × 6.5 cm。\n大盒子蛋糕：12 oz，约 355 ml；约 10 × 10 × 7.5 cm。\n秋冬糖水：16 oz，约 475 ml；口径约 9.8 cm，高约 10 cm。'],
 ['蛋糕带勺子吗？','有，每份都会配一把小勺。每个订单默认附一个纸袋；如果不需要，下单时备注即可。']
 ]],
 ['The Cakes','产品相关',[
 ['甜不甜？可以少糖吗？','口味与甜度默认按照菜单固定规格制作，所有产品均为减糖配方。如果希望进一步少糖，请下单时提前告诉我。'],
 ['有过敏原需要注意吗？','如果你对坚果、乳制品、鸡蛋、麸质等有过敏或忌口，请提前私信我，我会把每款蛋糕的详细过敏原清单发给你。'],
 ['第一次买，怎么选口味？','第一次买可以试试伯爵红茶奶冻蛋糕。不确定选什么，也可以私信告诉我你的口味偏好。'],
 ['收到产品后发现问题怎么办？','请在取货当天拍照私信我，确认后会补做或退款。因保存不当或超过建议食用时间造成的问题，不在售后范围内。'],
 ['有想吃的甜品，可以提建议吗？','欢迎在 Baking Wishlist 留下想吃的口味，也可以私信我。呼声高的会认真研发，说不定就出现在下一期菜单里。心愿是菜单建议，不代表定制或预订成功。']
 ]]
 ];
 var body=el('section',{cls:'faq-section'},[sectionTitle('Q&A','常见问题'),orderingSchedule()]);
 sections.forEach(function(group){var section=el('section',{cls:'faq-group'},[el('h3',{},[el('span',{text:group[0]}),el('small',{text:group[1]})])]);group[2].forEach(function(q){var contents=[el('summary',{text:q[0]}),el('p',{text:q[1]})];if(q[0]==='配送门槛、范围和费用是什么？')contents.push(el('button',{cls:'text-action',text:'查看配送范围地图 ↗',onclick:moreDelivery}));section.appendChild(el('details',{},contents));});body.appendChild(section);});return body;
}

function communitySection(){
 var entries=[['about','About Remiii','关于 Remiii',aboutSection()],['wishlist','Baking Wishlist','甜点心愿单',wishSection()],['faq','Q&A','常见问题',faqSection()]];
 var tabs=el('div',{cls:'community-tabs',role:'tablist','aria-label':'了解 Remiii'});
 var wrap=el('section',{cls:'community',id:'community'},[tabs]);
 var buttons=[];
 function select(index,focus){entries.forEach(function(entry,i){buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;entry[3].hidden=i!==index;});if(focus)buttons[index].focus();}
 entries.forEach(function(entry,i){
  var button=el('button',{type:'button',id:'tab-'+entry[0],role:'tab','aria-controls':'panel-'+entry[0],'aria-selected':String(i===0),tabindex:i===0?'0':'-1',onclick:function(){select(i,false);},onkeydown:function(e){var next=i;if(e.key==='ArrowRight')next=(i+1)%entries.length;else if(e.key==='ArrowLeft')next=(i+entries.length-1)%entries.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=entries.length-1;else return;e.preventDefault();select(next,true);}},[el('span',{text:entry[1]}),el('small',{text:entry[2]})]);
  buttons.push(button);tabs.appendChild(button);
  var panel=entry[3];panel.id='panel-'+entry[0];panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','tab-'+entry[0]);panel.setAttribute('tabindex','0');panel.hidden=i!==0;wrap.appendChild(panel);
 });
 return wrap;
}

renderHome=function(){baseHome();var app=$('app');var hero=app.querySelector('.hero');app.innerHTML='';app.appendChild(hero);document.body.setAttribute('data-concept',concept);
 app.appendChild(actions());
 if(concept==='b')app.appendChild(compactService());
 if(concept==='a')app.appendChild(fullService());
 app.appendChild(communitySection());app.appendChild(el('footer',{cls:'brand-footer'},[el('i',{text:'Bon appétit'}),el('span',{text:'REMIIIBAKE'})]));
};
if(DATA)paint();
