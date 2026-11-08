
const map=L.map('map',{scrollWheelZoom:!new URLSearchParams(location.search).has('embed')});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
const paid=L.polygon([FEE_BOUNDARY.polygon,STREET_BOUNDARY.polygon],{color:'#b48250',weight:2.5,dashArray:'7 6',fillColor:'#d4b28a',fillOpacity:.20,stroke:false,interactive:false}).addTo(map);
L.polyline([...FEE_BOUNDARY.polygon,FEE_BOUNDARY.polygon[0]],{color:'#b48250',weight:2.5,dashArray:'7 6',interactive:false}).addTo(map);
const area=L.polygon(STREET_BOUNDARY.polygon,{color:'#65412b',weight:2.5,dashArray:'7 6',fillColor:'#987353',fillOpacity:.18,interactive:false}).addTo(map);
map.fitBounds(paid.getBounds(),{padding:[35,35]});
const legend=L.control({position:'bottomleft'});legend.onAdd=()=>{const el=L.DomUtil.create('div','legend');el.innerHTML=new URLSearchParams(location.search).get('lang')==='en'?'<div><i class=free></i>Free delivery</div><div><i class=fee></i>+$5 delivery</div>':'<div><i class=free></i>免配送费</div><div><i class=fee></i>+$5 配送费</div>';L.DomEvent.disableClickPropagation(el);return el};legend.addTo(map);
