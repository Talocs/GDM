/* ============================================================
   GDM GAMEPAD  ·  gdm-gamepad.js
   Soporte de mando para TODOS los juegos de GDM.
     · PS4 / DualShock 4 por Bluetooth (mapeo estándar) — recomendado
     · PS2 vía adaptador USB genérico (cruceta tipo "hat") — tolerante
   Solo PC + mando: oculta los controles táctiles.
   Además provee un overlay de CONTROLES que cada juego muestra al empezar.

   Lee el mando cada frame y dispara eventos de teclado sintéticos
   (los juegos ya escuchan teclado, así "simplemente funcionan").
     Stick izq / Cruceta -> flechas + WASD
     ✕ / R1 / R2         -> ESPACIO (acción principal)
     ○ / □ / L1 / L2     -> 'k' (secundaria)
     OPTIONS / ✕         -> Enter (confirmar en menús)
   ============================================================ */
(function(){
'use strict';
if(window.GDMPad) return;
const SUPPORTED = ('getGamepads' in navigator);

// ---- los controles táctiles se ocultan SOLO si esto no es una pantalla táctil ----
// (antes se ocultaban siempre, así que en el celular el kart, el recolector y el
//  beat 'em up quedaban sin forma de jugarse: ni teclado ni botones)
const ESTACTIL = (function(){ try{
  return ('ontouchstart' in window) || navigator.maxTouchPoints>0 ||
         (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
}catch(e){ return false; } })();
(function(){
  if(ESTACTIL) return;                       // celular o tablet: se dejan a la vista
  const css='#stick,#stickBase,#stickThumb,#hitBtn,#kickBtn,#fireBtn,#btns,#lookZone{display:none !important;}';
  const st=document.createElement('style'); st.id='gdmHideTouch'; st.textContent=css;
  const add=()=>{ (document.head||document.documentElement).appendChild(st); };
  if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded',add);
})();

const TH_ON=0.55, TH_OFF=0.38;
const state={}; let padIndex=null, running=false, connected=false;
const hatAxes=new Set();                          // ejes que resultan ser "cruceta-hat" (adaptadores PS2 genéricos)
const DBG=/[?&]mando=debug/i.test(location.search||'');
// Si el juego corre embebido en gdm-completo.html (iframe name="gdmEmbedded"),
// el shell de arriba lee el mando y reenvía las teclas; aquí NO auto-encuestamos.
const EMBED=(function(){ try{ return window.name==='gdmEmbedded'; }catch(e){ return false; } })();

const KEYCODE={'ArrowUp':38,'ArrowDown':40,'ArrowLeft':37,'ArrowRight':39,' ':32,'Enter':13,'w':87,'a':65,'s':83,'d':68,'k':75,'p':80,'m':77};
let PROFILE='default';           // cada juego puede pedir su propio mapeo
let prevB={};                    // flancos de botón (para pausa: 1 pulsación = 1 acción)
function edge(gp,i){ const now=btn(gp,i), was=!!prevB[i]; prevB[i]=now; return now&&!was; }
function fire(type,key){
  const ev=new KeyboardEvent(type,{key:key,code:key===' '?'Space':key,keyCode:KEYCODE[key]||0,which:KEYCODE[key]||0,bubbles:true,cancelable:true});
  // despachar SOLO en document: sube a window por bubbling, así los listeners de window
  // no se disparan dos veces (antes eso hacía que el menú saltara de a 2 tarjetas).
  if(document&&document.dispatchEvent) document.dispatchEvent(ev); else window.dispatchEvent(ev);
}
function setKey(key,down){ if(!!state[key]===!!down) return; state[key]=down; fire(down?'keydown':'keyup',key); }
function btn(gp,i){ const b=gp.buttons[i]; return b&&(b.pressed||b.value>0.5); }
function anyBtn(gp,list){ for(const i of list) if(btn(gp,i)) return true; return false; }
function axisNeg(v,prev){ return prev? v<-TH_OFF : v<-TH_ON; }
function axisPos(v,prev){ return prev? v> TH_OFF : v> TH_ON; }

// La cruceta de los mandos PS2 genéricos suele llegar como un "hat" en un eje extra.
// Se autodetecta: un eje analógico nunca pasa de ±1; un hat en reposo queda fuera de [-1,1].
function readHat(gp){
  const o={u:false,d:false,l:false,r:false};
  for(let i=0;i<gp.axes.length;i++) if(Math.abs(gp.axes[i])>1.1) hatAxes.add(i);
  for(const i of hatAxes){
    const v=gp.axes[i]; if(v<-1.05||v>1.05) continue;          // en reposo el hat sale de rango
    const dir=Math.max(0,Math.min(7,Math.round((v+1)*3.5)));   // 0=arriba, girando en sentido reloj
    if(dir===7||dir===0||dir===1) o.u=true;
    if(dir>=3&&dir<=5) o.d=true;
    if(dir>=1&&dir<=3) o.r=true;
    if(dir>=5&&dir<=7) o.l=true;
  }
  return o;
}
function visible(el){ const c=getComputedStyle(el);
  return c.display!=='none' && c.visibility!=='hidden' && parseFloat(c.opacity||'1')>0.02; }
function hayPantalla(){
  // El menú principal no usa .screen sino tarjetas .gcard: ahí ✕ debe seguir
  // confirmando (si no, no se puede elegir juego con el mando).
  if(document.querySelector('.gcard')) return true;
  for(const s of document.querySelectorAll('.screen'))
    if(!s.classList.contains('hide') && visible(s)) return true;
  return false;
}
function drawDebug(gp,h){
  if(!document.body) return; let d=document.getElementById('gdmPadDebug');
  if(!d){ d=document.createElement('div'); d.id='gdmPadDebug';
    d.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99;max-width:96vw;'+
      "font:11px/1.55 'Space Mono',monospace;color:#c6ff2e;background:rgba(6,4,14,.92);"+
      'border:1px solid rgba(198,255,46,.5);border-radius:10px;padding:10px 12px;white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(d); }
  if(!gp){ d.textContent='🎮 DEBUG MANDO\n(sin mando detectado — aprieta cualquier botón del control)'; return; }
  const axes=Array.from(gp.axes).map((v,i)=>i+':'+v.toFixed(2)).join('   ');
  const pressed=[]; gp.buttons.forEach((b,i)=>{ if(b.pressed||b.value>0.5) pressed.push(i); });
  const dir=[h&&h.u?'↑':'',h&&h.d?'↓':'',h&&h.l?'←':'',h&&h.r?'→':''].join('')||'—';
  d.textContent=
    '🎮 DEBUG MANDO ('+(gp.mapping||'no-estándar')+')\n'+
    'id: '+gp.id+'\n'+
    'ejes:  '+axes+'\n'+
    'hat en ejes: '+(hatAxes.size?[...hatAxes].join(','):'ninguno')+'   direccion:'+dir+'\n'+
    'botones apretados: '+(pressed.length?pressed.join(', '):'—');
}
function poll(){
  const pads=navigator.getGamepads?navigator.getGamepads():[]; let gp=null;
  if(padIndex!=null && pads[padIndex]) gp=pads[padIndex];
  else { for(const p of pads){ if(p){ gp=p; padIndex=p.index; connected=true; if(window.GDMPad) window.GDMPad.connected=true; break; } } }
  if(gp){
    const ax=gp.axes[0]||0, ay=gp.axes[1]||0;
    const h=readHat(gp);
    const up   = h.u||btn(gp,12)||axisNeg(ay,state['ArrowUp']);
    const down = h.d||btn(gp,13)||axisPos(ay,state['ArrowDown']);
    const left = h.l||btn(gp,14)||axisNeg(ax,state['ArrowLeft']);
    const right= h.r||btn(gp,15)||axisPos(ax,state['ArrowRight']);
    // En pausa no se mandan controles al juego, solo se escucha el mando para salir de ella.
    if(window.GDM_PAUSA){
      for(const k in state) if(state[k]&&k!=='p'&&k!=='m') setKey(k,false);
      if(edge(gp,0)) fire('keydown',' ');            // ✕  continuar
      if(edge(gp,3)) fire('keydown','m');            // △  menú principal
      if(edge(gp,9)) fire('keydown','p');            // OPTIONS  reanudar
      if(DBG) drawDebug(gp,h);
      if(running) requestAnimationFrame(poll);
      return;
    }
    if(PROFILE==='kart'){
      // KART: se acelera con ✕ y se dirige con el stick/cruceta.
      setKey('ArrowUp',   up   || btn(gp,0));   // ✕ acelerar
      setKey('w',         up   || btn(gp,0));
      setKey('ArrowDown', down || btn(gp,1));   // ○ frenar / reversa
      setKey('s',         down || btn(gp,1));
    } else {
      setKey('ArrowUp',up); setKey('w',up); setKey('ArrowDown',down); setKey('s',down);
    }
    setKey('ArrowLeft',left); setKey('a',left); setKey('ArrowRight',right); setKey('d',right);
    // Acción principal / secundaria / confirmar, según el layout del mando.
    if(gp.mapping==='standard'){
      // PS4/DualShock estándar: 0=✕ 1=○ 2=□ 3=△ 4=L1 5=R1 6=L2 7=R2 8=Share 9=Options
      if(PROFILE==='kart'){
        setKey(' ', anyBtn(gp,[5,7]));        // R1 / R2  derrape
        setKey('k', anyBtn(gp,[2,3,4,6]));    // □ / △ / L1 / L2  lanzar ítem
      }else{
        setKey(' ', anyBtn(gp,[0,5,7]));      // ✕ / R1 / R2
        setKey('k', anyBtn(gp,[1,2,4,6]));    // ○ / □ / L1 / L2
      }
      // OPTIONS: confirmar si hay un menú abierto, pausar si estamos jugando.
      if(hayPantalla()) setKey('Enter', anyBtn(gp,[9,0]));
      else { setKey('Enter',false); if(edge(gp,9)) fire('keydown','p'); }
    }else{
      // No-estándar (PS2 genérico o DS4 en modo crudo): mapeo tolerante
      setKey(' ', anyBtn(gp,[0,1,2,5,7]));  // botones inferiores + gatillos derechos
      setKey('k', anyBtn(gp,[3,4,6]));
      setKey('Enter', anyBtn(gp,[9,8,0,1]));
    }
    if(DBG) drawDebug(gp,h);
  } else { for(const k in state) if(state[k]) setKey(k,false); if(DBG) drawDebug(null,null); }
  if(running) requestAnimationFrame(poll);
}
function start(){ if(running||!SUPPORTED||EMBED) return; running=true; requestAnimationFrame(poll); }

// ---- aviso de conexión ----
function toast(txt,col){
  if(!document.body) return; let t=document.getElementById('gdmPadToast');
  if(!t){ t=document.createElement('div'); t.id='gdmPadToast';
    t.style.cssText='position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:70;'+
      "font:700 12px 'Space Mono',monospace;letter-spacing:1px;padding:8px 16px;border-radius:20px;"+
      'background:rgba(20,11,38,.85);color:#c6ff2e;border:1px solid rgba(198,255,46,.4);'+
      'box-shadow:0 0 16px rgba(198,255,46,.3);pointer-events:none;transition:opacity .3s;';
    document.body.appendChild(t); }
  t.textContent=txt; t.style.color=col||'#c6ff2e'; t.style.opacity='1';
  clearTimeout(t._h); t._h=setTimeout(()=>{ t.style.opacity='0'; },2600);
}
function isPS4(gp){ const s=(gp&&gp.id||'').toLowerCase();
  return /054c|dualshock|dualsense|wireless controller|playstation/.test(s); }
function rumble(strong,weak,ms){
  try{ const p=(navigator.getGamepads?navigator.getGamepads():[])[padIndex];
    const a=p&&p.vibrationActuator; if(a&&a.playEffect)
      a.playEffect('dual-rumble',{duration:ms||220,strongMagnitude:strong||0.6,weakMagnitude:weak||0.4});
  }catch(e){}
}
if(SUPPORTED){
  window.addEventListener('gamepadconnected',e=>{ padIndex=e.gamepad.index; connected=true; window.GDMPad.connected=true;
    toast(isPS4(e.gamepad)?'🎮 Mando PS4 conectado — ¡a jugar!':'🎮 Mando conectado — ¡a jugar!');
    repintaControles();
    rumble(0.5,0.3,200);   // buzz de confirmación (DS4 lo soporta)
    start(); });
  window.addEventListener('gamepaddisconnected',e=>{ connected=false; window.GDMPad.connected=false; padIndex=null; for(const k in state) if(state[k]) setKey(k,false); toast('🎮 Mando desconectado','#ff8a5a'); repintaControles(); });
  start();
}

// ============================================================
//  PAUSA  ·  tecla P o botón OPTIONS del mando
//  En pausa: ESPACIO/✕ continúa · M/△ vuelve al menú principal.
// ============================================================
function pintaPausa(){
  let o=document.getElementById('gdmPausa');
  if(!o){ o=document.createElement('div'); o.id='gdmPausa'; document.body.appendChild(o);
    o.style.cssText='position:fixed;inset:0;z-index:80;display:flex;align-items:center;'+
      'justify-content:center;background:rgba(6,4,14,.82);backdrop-filter:blur(3px);'+
      "font-family:'Space Mono','Courier New',monospace;opacity:0;transition:opacity .25s;"; }
  const pad=!!(window.GDMPad&&window.GDMPad.connected);
  o.innerHTML='<div style="text-align:center;padding:28px 40px;border:1px solid rgba(198,255,46,.45);'+
    'border-radius:18px;background:rgba(12,8,24,.9);box-shadow:0 0 40px rgba(198,255,46,.22)">'+
    '<div style="font-size:26px;font-weight:700;letter-spacing:8px;color:#c6ff2e;margin-bottom:18px">PAUSA</div>'+
    '<div style="font-size:15px;line-height:2.1;color:#d6e2f2">'+
      '<b style="color:#8affa0">'+(pad?'✕':'ESPACIO')+'</b>  continuar<br>'+
      '<b style="color:#8affa0">'+(pad?'△':'M')+'</b>  menú principal<br>'+
      '<b style="color:#8affa0">'+(pad?'OPTIONS':'P')+'</b>  cerrar la pausa'+
    '</div></div>';
  requestAnimationFrame(()=>{ o.style.opacity='1'; });
}
function setPausa(on){
  if(!document.body) return;
  if(on && hayPantalla()) return;                 // en menús no se pausa
  window.GDM_PAUSA=!!on; window.GDM_HOLD=!!on;
  if(on) pintaPausa();
  else { const o=document.getElementById('gdmPausa'); if(o) o.style.opacity='0'; }
}
function alMenu(){
  setPausa(false);
  const a=document.querySelector('a.back')||document.querySelector('#backLink');
  if(a){ a.click(); return; }
  // dentro de gdm-completo.html el juego vive en un iframe srcdoc: navegar por
  // location.href lo dejaría en blanco. Se le pide el cambio al contenedor.
  try{ if(window.parent && window.parent!==window && window.parent.GDMNAV){
    window.parent.GDMNAV('index.html'); return; } }catch(e){}
  location.href='index.html';
}
window.addEventListener('keydown',e=>{
  const k=(e.key||'').toLowerCase();
  if(k==='p'){ setPausa(!window.GDM_PAUSA); e.preventDefault(); return; }
  if(!window.GDM_PAUSA) return;
  if(k==='m'){ alMenu(); e.preventDefault(); }
  else if(e.key===' '||e.key==='Enter'){ setPausa(false); e.preventDefault(); e.stopImmediatePropagation(); }
},true);

// ============================================================
//  GIRA EL CELULAR  ·  se ve mejor en horizontal, pero NUNCA se bloquea
//  Muchos celulares tienen el giro trabado, y el navegador de Instagram
//  no rota nunca. Por eso el aviso SIEMPRE tiene botón para seguir igual:
//  si no, la persona queda encerrada y el juego no arranca jamás.
// ============================================================
(function(){
  if(!ESTACTIL) return;                       // en computadora no aplica
  let capa=null, congelado=false, saltado=false;

  try{ saltado = sessionStorage.getItem('gdm_jugar_vertical')==='1'; }catch(e){}

  function seguirIgual(){
    saltado=true;
    try{ sessionStorage.setItem('gdm_jugar_vertical','1'); }catch(e){}
    if(capa) capa.style.display='none';
    congelado=false;
    if(!window.GDM_PAUSA) window.GDM_HOLD=false;
  }

  function crea(){
    if(capa) return capa;
    if(!document.body) return null;           // todavía no hay dónde meterlo
    capa=document.createElement('div');
    capa.id='gdmGira';
    capa.style.cssText='position:fixed;inset:0;z-index:99997;display:none;'+
      'flex-direction:column;align-items:center;justify-content:center;text-align:center;'+
      'background:radial-gradient(circle at 50% 38%, #45126e, #0a0614 70%);color:#ece6f7;'+
      "font-family:'Space Mono',ui-monospace,monospace;padding:20px;";
    capa.innerHTML=
      '<div style="width:78px;height:120px;border:5px solid #22e6ff;border-radius:12px;'+
        'position:relative;margin-bottom:22px;animation:gdmGiro 1.8s ease-in-out infinite;">'+
        '<div style="position:absolute;left:50%;transform:translateX(-50%);bottom:6px;width:28px;'+
          'height:4px;background:#22e6ff;border-radius:3px;"></div></div>'+
      '<div style="font-family:Righteous,sans-serif;font-size:24px;letter-spacing:3px;color:#c6ff2e;">'+
        'GIRA EL CELULAR</div>'+
      '<div style="margin-top:10px;font-size:13px;color:#b9a9d6;line-height:1.6;">'+
        'Se ve mucho mejor de lado.</div>'+
      '<button id="gdmIgual" style="margin-top:26px;font-family:Righteous,sans-serif;font-size:15px;'+
        'letter-spacing:2px;color:#2a0c22;background:#ffd24a;border:none;padding:14px 30px;'+
        'border-radius:9px;cursor:pointer;box-shadow:0 5px 0 #b07a10;">JUGAR ASÍ NOMÁS</button>'+
      '<div style="margin-top:20px;font-size:11px;color:#7a6a96;letter-spacing:.5px;line-height:1.7;">'+
        'si no gira: revisa el bloqueo de pantalla,<br>o ábrelo en Chrome o Safari</div>';
    const est=document.createElement('style');
    est.textContent='@keyframes gdmGiro{0%,45%{transform:rotate(0)}70%,100%{transform:rotate(-90deg)}}';
    capa.appendChild(est);
    document.body.appendChild(capa);
    const b=capa.querySelector('#gdmIgual');
    b.addEventListener('click',function(e){ e.stopPropagation(); seguirIgual(); });
    b.addEventListener('touchend',function(e){ e.stopPropagation(); e.preventDefault(); seguirIgual(); });
    return capa;
  }

  function esVertical(){
    // se pide girar solo si además la pantalla es realmente angosta para jugar
    let vert;
    try{ vert = window.matchMedia ? window.matchMedia('(orientation: portrait)').matches
                                  : (innerHeight > innerWidth); }
    catch(e){ vert = innerHeight > innerWidth; }
    return vert && innerWidth < 640;
  }

  function revisa(){
    if(saltado){ if(capa) capa.style.display='none'; return; }
    const c=crea(); if(!c) return;
    const vertical=esVertical();
    c.style.display = vertical ? 'flex' : 'none';
    if(vertical){
      congelado=true; window.GDM_HOLD=true;
    }else if(congelado){
      congelado=false;
      if(!window.GDM_PAUSA) window.GDM_HOLD=false;
    }
  }

  addEventListener('resize',revisa);
  addEventListener('orientationchange',function(){ setTimeout(revisa,120); });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',revisa);
  else revisa();
  setInterval(revisa,1000);                    // por si el navegador no avisa del giro
  window.GDMGira=revisa;
  window.GDMJugarVertical=seguirIgual;         // salida de emergencia
})();

// ============================================================
//  OVERLAY DE CONTROLES  (cada juego lo muestra al empezar)
// ============================================================
let ctlShown=0, ctlUlt=null;
function controls(title, rows, ms){
  if(!document.body) return;
  ctlUlt={title:title, rows:rows, ms:ms};          // guardado por si cambia el dispositivo
  const pad=!!(window.GDMPad&&window.GDMPad.connected);
  // rows puede ser un array (formato viejo) o {mando:[...], teclado:[...]}
  const set = Array.isArray(rows) ? rows : (pad ? (rows.mando||[]) : (rows.teclado||[]));
  let o=document.getElementById('gdmControls');
  if(!o){ o=document.createElement('div'); o.id='gdmControls'; document.body.appendChild(o);
    o.style.cssText='position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:66;max-width:94vw;'+
      "font-family:'Space Mono','Courier New',monospace;color:#eaf2ff;background:rgba(9,7,18,.9);"+
      'border:1px solid rgba(34,230,255,.5);border-radius:16px;padding:18px 24px;'+
      'box-shadow:0 12px 44px rgba(0,0,0,.7),0 0 30px rgba(34,230,255,.3);'+
      'opacity:0;transition:opacity .45s;pointer-events:none;';
  }
  let h='<div style="font-size:16px;font-weight:700;letter-spacing:3px;color:#22e6ff;text-align:center;margin-bottom:4px">'+
        (pad?'🎮 CONTROLES · MANDO':'⌨️ CONTROLES · TECLADO')+'</div>';
  if(title) h+='<div style="text-align:center;color:#ffd24a;font-weight:700;letter-spacing:1px;margin-bottom:12px;font-size:13px">'+title+'</div>';
  h+='<table style="border-collapse:collapse;font-size:15px;line-height:2.05;margin:0 auto">';
  for(const r of set) h+='<tr><td style="padding-right:20px;color:#8affa0;font-weight:700;white-space:nowrap;text-align:right">'+r[0]+'</td><td style="color:#d6e2f2">'+r[1]+'</td></tr>';
  h+='</table><div style="text-align:center;margin-top:14px;font-size:11px;letter-spacing:1px;color:#7f93ad">'+
     (pad?'pulsa ✕ para empezar':'pulsa ESPACIO para empezar')+' · '+
     (pad?'OPTIONS':'P')+' pausa · el texto se cierra solo</div>';
  o.innerHTML=h; o.style.opacity='1'; ctlShown=Date.now();
  window.GDM_HOLD=true;                                  // congela el juego mientras se lee
  clearTimeout(o._h); o._h=setTimeout(()=>{ o.style.opacity='0'; window.GDM_HOLD=false; }, ms||9000);
}
function repintaControles(){
  const o=document.getElementById('gdmControls');
  if(ctlUlt && o && o.style.opacity!=='0') controls(ctlUlt.title, ctlUlt.rows, ctlUlt.ms);
}
function ctlDismiss(e){ if(e&&e.key&&e.key!==' '&&e.key!=='Enter') return; if(Date.now()-ctlShown<500) return;
  const o=document.getElementById('gdmControls'); if(o&&o.style.opacity!=='0'){ o.style.opacity='0'; clearTimeout(o._h); window.GDM_HOLD=false; } }
window.addEventListener('keydown',ctlDismiss);

// ============================================================
//  NAVEGACIÓN DE MENÚS CON MANDO/TECLADO (couch-play)
//  Con un overlay .screen visible, resalta botones .btn/.lvlChip;
//  flechas mueven el foco y ✕/Enter/Espacio lo activan (click).
//  En juego (sin overlay) no interfiere: las flechas van al gameplay.
// ============================================================
(function(){
  const stl=document.createElement('style');
  stl.textContent='.gpFocus{outline:3px solid #c6ff2e !important;outline-offset:3px;'+
    'box-shadow:0 0 20px rgba(198,255,46,.85) !important;border-radius:8px;}';
  const addStyle=()=>{ (document.head||document.documentElement).appendChild(stl); };
  if(document.head||document.documentElement) addStyle(); else document.addEventListener('DOMContentLoaded',addStyle);
  let cur=null;
  function shown(el){ const c=getComputedStyle(el);
    return c.display!=='none' && c.visibility!=='hidden' && parseFloat(c.opacity||'1')>0.02; }
  function curScreen(){
    for(const s of document.querySelectorAll('.screen'))
      if(!s.classList.contains('hide') && shown(s)) return s;
    return null;
  }
  function items(scr){
    // Cada juego nombra distinto sus opciones: pilotos y circuitos del kart (.fcard/.cirChip),
    // niveles del beatemup en minúscula (.lvlchip), fichas de noches ácidas (.chip).
    return [...scr.querySelectorAll('.btn, .lvlChip, .lvlchip, .fcard, .cirChip, .chip')].filter(el=>{
      if(el.disabled||el.classList.contains('hide')||el.classList.contains('locked')) return false;
      const r=el.getBoundingClientRect(); return r.width>1 && r.height>1 && shown(el);
    });
  }
  function paint(list){ list.forEach(el=>el.classList.toggle('gpFocus',el===cur)); }
  function ensure(list){ if(!cur||list.indexOf(cur)<0) cur=list[0]||null; }
  function move(list,d){ if(!list.length) return; let i=list.indexOf(cur); if(i<0)i=0;
    i=(i+d+list.length)%list.length; cur=list[i]; paint(list);
    try{ cur.scrollIntoView({block:'nearest'}); }catch(e){} }
  addEventListener('keydown',e=>{
    const scr=curScreen(); if(!scr) return;             // solo en menús/pantallas
    const list=items(scr); if(!list.length) return;
    ensure(list); paint(list);
    const k=e.key;
    if(k==='ArrowRight'||k==='ArrowDown') move(list,1);
    else if(k==='ArrowLeft'||k==='ArrowUp') move(list,-1);
    else if(k==='Enter'||k===' '){ if(cur) cur.click(); }
    else return;
    e.stopImmediatePropagation(); e.preventDefault();
  },true);   // fase de captura: corre antes que el juego
  setInterval(()=>{ const scr=curScreen();
    if(scr){ const l=items(scr); ensure(l); paint(l); }
    else if(cur){ cur.classList.remove('gpFocus'); cur=null; } },300);
})();

window.GDMPad={ connected:false, supported:SUPPORTED, controls:controls, rumble:rumble,
  setProfile:function(n){ PROFILE=n||'default'; },
  setPausa:setPausa,
  get usaMando(){ return !!this.connected; },
  get pad(){ const p=navigator.getGamepads?navigator.getGamepads():[]; return padIndex!=null?p[padIndex]:null; } };
})();
