/* ============================================================
   GDM MUSIC  ·  gdm-music.js
   Reproduce los temas reales del juego (MP3 en la carpeta "musica/"):

     · GDM QUEST        -> presentación Perro de Aldea + menú
     · GDM CORE         -> GDM KART (carreras)
     · 8-bit Adventure  -> ÓRBITA CERO (mechas)
     · Pixel Pipe Quest -> Marciano Recolector, Marciano vs Serenazgo, Noches Ácidas

   La pista se elige sola según la pantalla; los juegos siguen llamando
   GDMMusic.play(loQueSea) y el motor reafirma la pista que le toca.
   Un juego con varios niveles puede fijar la suya con window.GDM_PISTA
   (NOCHES ÁCIDAS: 'finmundo' en las dos noches;
   MARCIANO RECOLECTOR: 'limaciudad' en el Jirón de la Unión).

   API (igual que antes):
     GDMMusic.play(id)   GDMMusic.stop()   GDMMusic.toggle()
     GDMMusic.setTrack(id)   GDMMusic.isOn()   GDMMusic.list()

   En el build de un solo archivo (gdm-completo.html) el audio vive en el
   contenedor: aquí sólo se delega en window.parent.GDMAUDIO para que la
   música no se corte al saltar de un juego a otro.
   ============================================================ */
(function(){
'use strict';

const RUTA={
  quest     :'musica/quest.mp3',
  core      :'musica/core.mp3',
  pixel     :'musica/pixel.mp3',
  finmundo  :'musica/finmundo.mp3',
  limayafue :'musica/limayafue.mp3',
  aventura  :'musica/aventura.mp3',
  limaciudad:'musica/limaciudad.mp3'
};
const NOMBRE={ quest:'GDM QUEST', core:'GDM CORE', pixel:'PIXEL PIPE QUEST',
  finmundo:'FIN DEL MUNDO', limayafue:'LIMA YA FUE', aventura:'8-BIT ADVENTURE',
  limaciudad:'LIMA YA FUE (CIUDAD)' };
const VOL=0.45;

// ---------- qué tema le toca a esta pantalla ----------
function pistaDeLaPantalla(){
  // un juego puede pedir una pista concreta (p.ej. una por nivel): window.GDM_PISTA
  try{ if(window.GDM_PISTA && RUTA[window.GDM_PISTA]) return window.GDM_PISTA; }catch(e){}
  const t=(document.title||'').toUpperCase();
  // ojo: sólo el nombre del archivo — la carpeta también se llama "El Videojuego de GDM"
  let f=''; try{ f=decodeURIComponent((location.pathname||'').split('/').pop()||'').toUpperCase(); }catch(e){}
  if(t.indexOf('GDM KART')>=0 || f.indexOf('KART')===0) return 'core';
  if(t.indexOf('RBITA CERO')>=0 || f.indexOf('ORBITA-CERO')===0) return 'aventura';
  if(t.indexOf('EL VIDEOJUEGO DE GDM')>=0 || f.indexOf('EL VIDEOJUEGO DE GDM')===0) return 'quest';
  return 'pixel';
}

// ---------- ¿hay un reproductor en el contenedor? ----------
function remoto(){
  try{ if(window.parent && window.parent!==window && window.parent.GDMAUDIO) return window.parent.GDMAUDIO; }catch(e){}
  return null;
}

// ---------- reproductor local ----------
let audio=null, actual=null, enabled=true, sonando=false, pendiente=null, fadeTimer=null;

function crear(){
  if(audio) return audio;
  audio=new Audio();
  audio.loop=true; audio.preload='auto'; audio.volume=0;
  audio.addEventListener('playing',()=>{ sonando=true; pinta(); });
  audio.addEventListener('pause',  ()=>{ sonando=false; pinta(); });
  return audio;
}
function fadeA(destino,ms,luego){
  const a=crear(); clearInterval(fadeTimer);
  const desde=a.volume, pasos=Math.max(1,Math.round(ms/40)); let i=0;
  fadeTimer=setInterval(()=>{
    i++; a.volume=Math.max(0,Math.min(1, desde+(destino-desde)*(i/pasos)));
    if(i>=pasos){ clearInterval(fadeTimer); if(luego) luego(); }
  },40);
}
function arrancar(){
  const a=crear();
  if(!enabled) return;
  const p=a.play();
  if(p && p.catch) p.catch(()=>{ pendiente=actual; });   // autoplay bloqueado: espera el primer gesto
  fadeA(VOL,700);
}
function ponerLocal(pista){
  if(!pista || !RUTA[pista]) return;
  const a=crear();
  if(actual===pista){ if(enabled && a.paused) arrancar(); return; }
  actual=pista;
  if(a.src && !a.paused){
    fadeA(0,450,()=>{ a.src=RUTA[pista]; a.currentTime=0; a.volume=0; arrancar(); });
  }else{
    a.src=RUTA[pista]; a.currentTime=0; a.volume=0; arrancar();
  }
  pinta();
}

// ---------- API ----------
function play(){                       // el id que mandan los juegos ya no manda: manda la pantalla
  const pista=pistaDeLaPantalla();
  const R=remoto();
  if(R){ R.set(pista); return; }
  ponerLocal(pista);
}
function stop(){
  const R=remoto(); if(R){ R.stop(); return; }
  if(audio){ fadeA(0,400,()=>{ audio.pause(); }); }
  sonando=false; pinta();
}
function toggle(){
  const R=remoto(); if(R){ enabled=R.toggle(); pinta(); return enabled; }
  enabled=!enabled;
  if(enabled){ if(!actual) actual=pistaDeLaPantalla(); ponerLocal(actual); arrancar(); }
  else if(audio){ fadeA(0,250,()=>audio.pause()); }
  pinta(); return enabled;
}
function isOn(){ const R=remoto(); return R? R.isOn() : (enabled&&sonando); }

// ---------- desbloqueo por gesto (política de autoplay) ----------
function desbloquear(){
  const R=remoto();
  if(R){ R.unlock(); R.set(pistaDeLaPantalla()); return; }
  if(!enabled) return;
  if(!actual) actual=pistaDeLaPantalla();
  const a=crear();
  if(!a.src){ a.src=RUTA[actual]; }
  if(a.paused) arrancar();
  pendiente=null;
}
['pointerdown','touchstart','keydown','click'].forEach(ev=>
  window.addEventListener(ev,function(){ desbloquear(); },{passive:true}));

// ---------- botón flotante ♪ ----------
let btn=null;
function creaBtn(){
  if(btn||window.GDM_SIN_BOTON||typeof document==='undefined') return;
  btn=document.createElement('button');
  btn.id='gdmMusicBtn';
  btn.style.cssText='position:fixed;left:16px;bottom:40px;z-index:60;width:auto;height:34px;padding:0 12px;'+
    'border-radius:18px;border:1px solid rgba(34,230,255,.4);background:rgba(20,11,38,.7);color:#22e6ff;'+
    "font:700 11px 'Space Mono',monospace;letter-spacing:1px;cursor:pointer;backdrop-filter:blur(6px);"+
    '-webkit-appearance:none;box-shadow:0 0 14px rgba(34,230,255,.25);touch-action:manipulation;';
  btn.addEventListener('click',e=>{ e.stopPropagation(); toggle(); });
  const add=()=>{ if(document.body) document.body.appendChild(btn); else requestAnimationFrame(add); };
  add(); pinta();
}
function pinta(){
  if(!btn) return;
  const on=isOn();
  btn.textContent = on ? '♪' : '♪̶';
  btn.style.opacity = on ? '1' : '0.6';
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',creaBtn); else creaBtn();
}

// arranca sola la pista de la pantalla (si el navegador deja; si no, al primer gesto)
play();
setInterval(pinta,1000);

window.GDMMusic={ play, stop, toggle, setTrack:play, isOn,
  list:()=>Object.keys(RUTA), tracks:NOMBRE, pista:()=>pistaDeLaPantalla(),
  estado:()=>{ const R=remoto(); const a=R?R.el:audio;
    return { pista:pistaDeLaPantalla(), enContenedor:!!R,
      archivo: a&&a.src?decodeURIComponent(a.src).split('/').pop():null,
      sonando: !!(a&&!a.paused), t:a?+a.currentTime.toFixed(1):null, vol:a?+a.volume.toFixed(2):null }; } };
})();
