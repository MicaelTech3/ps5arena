
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, addDoc, setDoc, getDoc, onSnapshot, query, orderBy, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyB-wXNMPjvAHkO9psBlDIzqqZ-ZvaipuRw",
  authDomain: "ps5-arena.firebaseapp.com",
  projectId: "ps5-arena",
  storageBucket: "ps5-arena.firebasestorage.app",
  messagingSenderId: "706126347999",
  appId: "1:706126347999:web:deb734b6e009e2bf1db36a",
  measurementId: "G-H17EYGX6VH"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

const ARENAS = [
  { id: "A1_TV",   label: "Arena 1 (TV)" },
  { id: "A2_TV",   label: "Arena 2 (TV)" },
  { id: "A3_PROJ", label: "Arena 3 (Projetor)" },
  { id: "A4_PROJ", label: "Arena 4 (Projetor)" },
];

// Util
const $ = (s)=>document.querySelector(s);
function fmtMinSec(sec){ sec=Math.max(0,Math.floor(sec)); const m=String(Math.floor(sec/60)).padStart(2,'0'); const s=String(sec%60).padStart(2,'0'); return `${m}:${s}`; }

async function estimateWaitingMinutes(arena, s){
  const q = query(collection(db, "queues", arena, "tickets"), where("status","==","waiting"), orderBy("number","asc"));
  const snap = await new Promise(res=>{ const unsub=onSnapshot(q,(qs)=>{unsub(); res(qs);}); });
  const waiting = snap.docs.length;
  let remain = 0; const dur = (s?.gameDurationSec)||1020;
  if (s?.currentEndAt?.toMillis){ remain = Math.max(0, Math.ceil((s.currentEndAt.toMillis()-Date.now())/1000)); }
  const total = remain + waiting*dur; return Math.ceil(total/60);
}

// Totem
(function(){
  const path = location.pathname; if (!path.endsWith('/') && !path.endsWith('/index.html')) return;
  const arenaId = new URL(location.href).searchParams.get('a') || 'A1_TV';
  const arenaEl = document.getElementById('arena'); if (arenaEl) arenaEl.textContent=arenaId;
  const reg = new URL(location.origin+"/register.html"); reg.searchParams.set('a', arenaId);
  new QRCode(document.getElementById('qrcode'), { text: reg.toString(), width:200, height:200 });
  const nowEl=$('#now'), nextEl=$('#next'), countEl=$('#count');
  const setRef = doc(db,'settings',arenaId);
  onSnapshot(setRef,(snap)=>{
    const s = snap.data()||{}; if (s.currentTicket){ onSnapshot(doc(db,'queues',arenaId,'tickets',s.currentTicket),(t)=>{ nowEl.textContent='Jogando: '+(t.data()?.name||'—'); }); } else nowEl.textContent='Jogando: —';
    const q = query(collection(db,'queues',arenaId,'tickets'), where('status','==','waiting'), orderBy('number','asc'));
    onSnapshot(q,(qs)=>{ const arr=qs.docs.map(d=>d.data()); nextEl.textContent='Próximo: '+(arr[0]?.name||'—'); });
    const end = s.currentEndAt?.toMillis?.()||0; if (end){ const timer=setInterval(()=>{ const rem=Math.max(0,Math.ceil((end-Date.now())/1000)); countEl.textContent=fmtMinSec(rem); if(rem<=0) clearInterval(timer); },1000);} else countEl.textContent='00:00';
  });
})();

// Registro
(function(){ if(!location.pathname.endsWith('/register.html')) return; const sel=$('#arenaSel'), est=$('#est');
  ARENAS.forEach(a=>{ const o=document.createElement('option'); o.value=a.id; o.textContent=a.label; sel.appendChild(o); });
  const pre=new URL(location.href).searchParams.get('a'); if(pre) sel.value=pre;
  async function refresh(){ const a=sel.value; const s=(await getDoc(doc(db,'settings',a))).data(); const m=await estimateWaitingMinutes(a,s); est.textContent=`Na ${a} falta ~${m} min`; }
  sel.addEventListener('change', refresh); refresh();
  $('#join').onclick = async ()=>{ const n=$('#name').value.trim(); const p=$('#phone').value.trim(); const a=sel.value; if(!n||!p){ $('#msg').textContent='Preencha nome e WhatsApp'; return; }
    const q=query(collection(db,'queues',a,'tickets'), orderBy('number','desc')); let next=1; await new Promise(res=>{ const u=onSnapshot(q,(s)=>{ if(s.docs[0]) next=(s.docs[0].data().number||0)+1; u(); res(); },{once:true}); });
    const ref=await addDoc(collection(db,'queues',a,'tickets'),{ name:n, phone:p, status:'waiting', createdAt:serverTimestamp(), arena:a, number:next });
    $('#msg').textContent=`Você entrou na fila! Protocolo: ${ref.id.slice(0,6)}`; $('#name').value=$('#phone').value=''; };
})();

// Admin
(function(){ if(!location.pathname.endsWith('/admin.html')) return; const grid=$('#grid'); const setDurBtn=$('#setDur'); const durInput=$('#dur');
  ARENAS.forEach((a)=>{ const card=document.createElement('div'); card.className='card'; card.id=`card-${a.id}`; card.innerHTML=`
      <div class="badge">${a.label} <span id="status-${a.id}"></span></div>
      <div class="count" id="count-${a.id}">00:00</div>
      <div class="small" id="now-${a.id}">Jogando: —</div>
      <div class="small" id="next-${a.id}">Próximo: —</div>
      <div class="controls">
        <button data-do="call" data-arena="${a.id}">Chamar próximo</button>
        <button data-do="restart" data-arena="${a.id}">Reiniciar tempo</button>
        <button data-do="finish" data-arena="${a.id}">Finalizar atual</button>
      </div>
      <div class="small" id="queue-${a.id}"></div>`; grid.appendChild(card);
    const setRef=doc(db,'settings',a.id);
    onSnapshot(setRef,(snap)=>{ const s=snap.data()||{}; document.getElementById(`status-${a.id}`).textContent=`(${s.status||'idle'})`;
      if(s.currentTicket){ onSnapshot(doc(db,'queues',a.id,'tickets',s.currentTicket),(t)=>{ document.getElementById(`now-${a.id}`).textContent='Jogando: '+(t.data()?.name||'—'); }); } else document.getElementById(`now-${a.id}`).textContent='Jogando: —';
      const q=query(collection(db,'queues',a.id,'tickets'), where('status','==','waiting'), orderBy('number','asc'));
      onSnapshot(q,(qs)=>{ const arr=qs.docs.map(d=>d.data()); document.getElementById(`next-${a.id}`).textContent='Próximo: '+(arr[0]?.name||'—'); document.getElementById(`queue-${a.id}`).textContent=`Fila: ${arr.length} aguardando`; });
      const end=s.currentEndAt?.toMillis?.()||0; if(end){ const el=document.getElementById(`count-${a.id}`); const timer=setInterval(()=>{ const rem=Math.max(0,Math.ceil((end-Date.now())/1000)); el.textContent=fmtMinSec(rem); if(rem<=0) clearInterval(timer); },1000);} }); });
  const callFn=httpsCallable(functions,'callNext'); const restartFn=httpsCallable(functions,'restartTimer'); const finishFn=httpsCallable(functions,'finishCurrent');
  grid.addEventListener('click', async (e)=>{ if(e.target.tagName!=='BUTTON') return; const a=e.target.getAttribute('data-arena'); const op=e.target.getAttribute('data-do'); if(op==='call') await callFn({arena:a}); if(op==='restart') await restartFn({arena:a}); if(op==='finish') await finishFn({arena:a}); });
  const setDur=httpsCallable(functions,'setGameDuration'); setDurBtn.onclick=async()=>{ const mins=parseInt(durInput.value||'17',10); await setDur({ gameDurationSec: mins*60 }); alert('Tempo aplicado em todas as arenas.'); };
})();