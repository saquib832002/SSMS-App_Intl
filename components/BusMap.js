/**
 * BusMap – a live map for buses and stops (OpenStreetMap through Leaflet in a WebView: no map key needed; Leaflet itself
 * is bundled in the app, only the map tiles come from the internet).
 *
 * props:
 *   stops:  [{ id, name, lat, lng, status?: pending|arrived|left|passed, mine?: bool }]
 *   buses:  [{ id, lat, lng, heading?, label?, live?: bool }]
 *   path:   [[lat, lng], …]       the way driven (office)
 *   me:     { lat, lng } | null   this phone (driver)
 *   follow: id of a bus to keep in view (or "me")
 *   height: number (default 260)
 * The page is loaded once; new positions are sent into it, so the map does not flash.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { _t } from "../services/i18n";
import { LEAFLET_CSS, LEAFLET_JS } from "./leafletAssets";

const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${LEAFLET_CSS}</style>
<style>html,body,#m{height:100%;margin:0;background:#e5e7eb}
.bus{width:34px;height:34px;border-radius:17px;background:#5b21b6;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
.bus.old{background:#94a3b8}.bus svg{width:18px;height:18px}
.arrow{position:absolute;left:12px;top:-9px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #5b21b6}
.me{width:16px;height:16px;border-radius:8px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)}
.lbl{background:#fff;border-radius:6px;padding:1px 5px;font:600 11px sans-serif;color:#0f172a;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3)}
#err{position:absolute;top:40%;width:100%;text-align:center;font:14px sans-serif;color:#475569;display:none}</style></head>
<body><div id="m"></div><div id="err">Map could not load. Check the internet connection.</div>
<script>${LEAFLET_JS}</script>
<script>
var post=function(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}};
if(!window.L){document.getElementById('err').style.display='block';post({t:'error'});}
else{
var map=L.map('m',{zoomControl:true,attributionControl:true}).setView([20,0],2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var layer=L.layerGroup().addTo(map),line=null,path=null,busM={},meM=null,fitted=false,state={};
var busSvg='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M8 18v2M16 18v2"/></svg>';
function stopColor(s){return s.mine?'#dc2626':(s.status==='arrived'?'#15803d':(s.status==='left'||s.status==='passed')?'#94a3b8':'#2563eb')}
function draw(d){
  state=d;layer.clearLayers();
  var pts=[],stops=d.stops||[];
  stops.forEach(function(s,i){if(s.lat==null||s.lng==null)return;pts.push([s.lat,s.lng]);
    L.circleMarker([s.lat,s.lng],{radius:s.mine?9:6,color:'#fff',weight:2,fillColor:stopColor(s),fillOpacity:1}).addTo(layer)
     .bindTooltip(esc((i+1)+'. '+s.name),{permanent:!!s.mine,direction:'top',offset:[0,-6]});});
  if(line)map.removeLayer(line);line=pts.length>1?L.polyline(pts,{color:'#2563eb',weight:3,opacity:.45,dashArray:'6 6'}).addTo(map):null;
  if(path)map.removeLayer(path);path=(d.path&&d.path.length>1)?L.polyline(d.path,{color:'#5b21b6',weight:4,opacity:.8}).addTo(map):null;
  var seen={};
  (d.buses||[]).forEach(function(b){if(b.lat==null)return;seen[b.id]=1;var ll=[b.lat,b.lng];
    var h='<div class="bus'+(b.live===false?' old':'')+'" style="position:relative">'+busSvg+(b.heading!=null?'<div class="arrow" style="transform:rotate('+b.heading+'deg);transform-origin:5px 26px"></div>':'')+'</div>';
    var ic=L.divIcon({html:h,className:'',iconSize:[34,34],iconAnchor:[17,17]});
    if(busM[b.id]){busM[b.id].setLatLng(ll).setIcon(ic)}else{busM[b.id]=L.marker(ll,{icon:ic,zIndexOffset:1000}).addTo(map)}
    busM[b.id].unbindTooltip();if(b.label){busM[b.id].bindTooltip(esc(b.label),{permanent:true,direction:'bottom',offset:[0,14],className:'lbl'})}
    pts.push(ll);});
  Object.keys(busM).forEach(function(k){if(!seen[k]){map.removeLayer(busM[k]);delete busM[k]}});
  if(d.me&&d.me.lat!=null){var mi=L.divIcon({html:'<div class="me"></div>',className:'',iconSize:[16,16],iconAnchor:[8,8]});
    if(meM){meM.setLatLng([d.me.lat,d.me.lng])}else{meM=L.marker([d.me.lat,d.me.lng],{icon:mi}).addTo(map)}pts.push([d.me.lat,d.me.lng]);}
  else if(meM){map.removeLayer(meM);meM=null}
  if(!fitted&&pts.length){fitted=true;if(pts.length===1)map.setView(pts[0],15);else map.fitBounds(pts,{padding:[30,30],maxZoom:16});}
  else if(d.follow){var f=d.follow==='me'?(meM&&meM.getLatLng()):(busM[d.follow]&&busM[d.follow].getLatLng());if(f&&!map.getBounds().pad(-0.15).contains(f))map.panTo(f);}
}
function fitAll(){var pts=[];(state.stops||[]).forEach(function(s){if(s.lat!=null)pts.push([s.lat,s.lng])});Object.keys(busM).forEach(function(k){pts.push(busM[k].getLatLng())});if(meM)pts.push(meM.getLatLng());
  if(pts.length===1)map.setView(pts[0],15);else if(pts.length)map.fitBounds(pts,{padding:[30,30],maxZoom:16});}
function centerOn(id){var f=id==='me'?(meM&&meM.getLatLng()):(busM[id]&&busM[id].getLatLng());if(f)map.setView(f,Math.max(map.getZoom(),15));else fitAll();}
window.mmaUpdate=function(d){try{draw(d)}catch(e){post({t:'error',m:String(e)})}};
window.mmaFit=fitAll;window.mmaCenter=centerOn;
post({t:'ready'});
}
</script></body></html>`;

export default function BusMap({ stops = [], buses = [], path = null, me = null, follow = null, height = 260, style }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const payload = useMemo(() => JSON.stringify({ stops, buses, path, me, follow }), [stops, buses, path, me, follow]);

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.mmaUpdate && window.mmaUpdate(${payload}); true;`);
  }, [payload, ready]);

  const target = follow ?? buses.find((b) => b.lat != null)?.id ?? (me ? "me" : null);

  return (
    <View style={[{ height, borderRadius: 12, overflow: "hidden", backgroundColor: "#e5e7eb" }, style]}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html: HTML, baseUrl: "https://localhost/" }}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        nestedScrollEnabled
        onMessage={(e) => {
          let m = null;
          try { m = JSON.parse(e.nativeEvent.data); } catch { m = null; }
          if (m?.t === "ready") { setReady(true); setFailed(false); }
          if (m?.t === "error" && !ready) setFailed(true);
        }}
        onError={() => setFailed(true)}
        style={{ backgroundColor: "transparent" }}
      />
      {!ready && !failed && <View style={st.cover}><ActivityIndicator color="#5b21b6" /></View>}
      {failed && <View style={st.cover}><Feather name="wifi-off" size={22} color="#64748b" /><Text style={st.msg}>{_t("The map could not load. Check the internet connection.")}</Text></View>}
      {ready && (
        <View style={st.tools}>
          {target != null && (
            <TouchableOpacity style={st.tool} onPress={() => ref.current?.injectJavaScript(`window.mmaCenter(${JSON.stringify(target)}); true;`)} accessibilityLabel={_t("Show the bus")}>
              <Feather name="crosshair" size={17} color="#0f172a" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={st.tool} onPress={() => ref.current?.injectJavaScript("window.mmaFit(); true;")} accessibilityLabel={_t("Show the whole route")}>
            <Feather name="maximize" size={17} color="#0f172a" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 6, padding: 16 },
  msg: { fontSize: 12, color: "#475569", textAlign: "center" },
  tools: { position: "absolute", right: 8, bottom: 8, gap: 8 },
  tool: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 3, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
});
