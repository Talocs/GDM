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
//  MODO HORIZONTAL  ·  el juego se pone de lado por su cuenta
//  Un celular con el giro trabado (o el navegador de Instagram, que no
//  rota) nunca pasa a landscape. Pedirlo no sirve. Así que cuando la
//  pantalla está vertical se gira EL CONTENIDO 90°: la persona pone el
//  teléfono de lado y ve el juego bien puesto, sin tocar ajustes.
//  Si el celular sí rota, el sistema ya lo pone horizontal y esto se apaga.
// ============================================================
(function(){
  if(!ESTACTIL) return;

  const anchoReal  = () => document.documentElement.clientWidth  || window.screen.width;
  const altoReal   = () => document.documentElement.clientHeight || window.screen.height;
  let rotado=false;

  // Los juegos miden con innerWidth/innerHeight para dimensionar su canvas.
  // Con el contenido girado, esas medidas van al revés: se intercambian.
  (function(){
    try{
      const dW=Object.getOwnPropertyDescriptor(window,'innerWidth')  ||
               Object.getOwnPropertyDescriptor(Window.prototype,'innerWidth');
      const dH=Object.getOwnPropertyDescriptor(window,'innerHeight') ||
               Object.getOwnPropertyDescriptor(Window.prototype,'innerHeight');
      if(!dW||!dH||!dW.get||!dH.get) return;
      Object.defineProperty(window,'innerWidth', {configurable:true,
        get(){ return rotado ? dH.get.call(window) : dW.get.call(window); }});
      Object.defineProperty(window,'innerHeight',{configurable:true,
        get(){ return rotado ? dW.get.call(window) : dH.get.call(window); }});
    }catch(e){}
  })();

  const estilo=document.createElement('style');
  estilo.id='gdmHorizontal';
  // Los rótulos de los juegos están medidos en 'vw', o sea el ancho del
  // teléfono (390 px). Con el juego de lado esa medida ya no corresponde a lo
  // que se ve y los carteles salen enormes, tapando media pantalla. Aquí se
  // fijan a un tamaño sensato. Vale para los cinco juegos.
  const CHICO =
    'html.gdmRot #banner{font-size:26px!important;letter-spacing:1px!important;}'+
    'html.gdmRot #toast,html.gdmRot #aviso,html.gdmRot #msg{font-size:13px!important;'+
      'padding:7px 13px!important;border-width:2px!important;border-radius:10px!important;line-height:1.25!important;}'+
    'html.gdmRot #hud,html.gdmRot #hudTop{transform:scale(.72)!important;transform-origin:top left!important;}'+
    '@media (max-height:520px){'+
      '#banner{font-size:26px!important;letter-spacing:1px!important;}'+
      '#toast,#aviso,#msg{font-size:13px!important;padding:7px 13px!important;border-width:2px!important;border-radius:10px!important;}'+
      '#hud,#hudTop{transform:scale(.72)!important;transform-origin:top left!important;}}';
  estilo.textContent=
    'html.gdmRot,html.gdmRot body{margin:0!important;padding:0!important;overflow:hidden!important;}'+
    'html.gdmRot body{position:fixed!important;top:0!important;left:0!important;'+
      'width:var(--gdmW)!important;height:var(--gdmH)!important;'+
      'transform-origin:0 0!important;'+
      'transform:translateX(var(--gdmW2)) rotate(90deg)!important;}'+
    CHICO;
  const meterEstilo=()=>{ (document.head||document.documentElement).appendChild(estilo); };
  if(document.head||document.documentElement) meterEstilo();
  else document.addEventListener('DOMContentLoaded',meterEstilo);

  function debeRotar(){
    let vertical;
    try{ vertical = window.matchMedia ? window.matchMedia('(orientation: portrait)').matches
                                      : (altoReal() > anchoReal()); }
    catch(e){ vertical = altoReal() > anchoReal(); }
    return vertical && anchoReal() < 640;      // tablets anchas se quedan como están
  }

  function aplica(){
    const hayQue=debeRotar();
    const raiz=document.documentElement;
    if(hayQue===rotado){                       // ya está como toca; solo refrescar medidas
      if(rotado) medidas();
      return;
    }
    rotado=hayQue;
    if(rotado){ medidas(); raiz.classList.add('gdmRot'); }
    else{ raiz.classList.remove('gdmRot'); }
    // los juegos recalculan su canvas al oír esto
    setTimeout(()=>{ try{ window.dispatchEvent(new Event('resize')); }catch(e){} }, 30);
    setTimeout(()=>{ try{ window.dispatchEvent(new Event('resize')); }catch(e){} }, 260);
  }
  function medidas(){
    const raiz=document.documentElement;
    const w=anchoReal(), h=altoReal();
    raiz.style.setProperty('--gdmW', h+'px');   // el body mide al revés
    raiz.style.setProperty('--gdmH', w+'px');
    raiz.style.setProperty('--gdmW2', w+'px');  // y se corre para caer en pantalla
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',aplica);
  else aplica();
  addEventListener('resize',aplica);
  addEventListener('orientationchange',()=>setTimeout(aplica,150));
  setInterval(aplica,1500);
  window.GDMHorizontal={ aplica, activo:()=>rotado };
  // Con el contenido girado, un arrastre del dedo llega en coordenadas de la
  // PANTALLA, pero el juego lo lee como si fuera de su propio mundo (que está
  // rotado 90°). Sin esto, los sticks salen cruzados. Se rota el vector.
  window.GDMvec=function(v){ if(rotado){ const t=v.x; v.x=v.y; v.y=-t; } return v; };
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
