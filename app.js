// ===== Firebase SDK =====
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

// ===== Config local =====
const VENUE = "PS5_01"; // identifique seu console/estação

// Detecta página
const path = location.pathname;

// ===== Totem/TV: gerar QR e exibir estado =====
if (path.endsWith("/") || path.endsWith("/index.html")) {
  const registerUrl = new URL(location.origin + "/register.html");
  registerUrl.searchParams.set("v", VENUE);
  // QR
  new QRCode(document.getElementById("qrcode"), {
    text: registerUrl.toString(),
    width: 200, height: 200
  });

  const currentEl = document.getElementById("current");
  const nextEl = document.getElementById("next");

const settingsRef = doc(db, "settings", VENUE);
onSnapshot(settingsRef, async (snap) => {
const s = snap.data() || {};
currentEl.textContent = "Chamando: " + (s.currentTicket ? s.currentTicket.slice(0,6) : "—");


// Descobrir próximo (primeiro waiting)
const q = query(collection(db, "queues", VENUE, "tickets"), where("status", "==", "waiting"), orderBy("number", "asc"));
onSnapshot(q, (qsnap) => {
const list = qsnap.docs.map(d => ({ id: d.id, ...d.data() }));
nextEl.textContent = "Próximo: " + (list[0]?.name || "—");
});
});
}


// ===== Cadastro =====
if (path.endsWith("/register.html")) {
const name = document.getElementById("name");
const phone = document.getElementById("phone");
const btn = document.getElementById("join");
const msg = document.getElementById("msg");


const urlV = new URLSearchParams(location.search).get("v") || VENUE;


btn.onclick = async () => {
const n = name.value.trim();
const p = phone.value.trim();
if (!n || !p) { msg.textContent = "Preencha nome e WhatsApp"; return; }


// número sequencial
const q = query(collection(db, "queues", urlV, "tickets"), orderBy("number", "desc"));
let nextNumber = 1;
let last = null;
await new Promise((resolve) => onSnapshot(q, (snap) => { last = snap.docs[0]; resolve(); }, { once: true }));
if (last) nextNumber = (last.data().number || 0) + 1;


const ref = await addDoc(collection(db, "queues", urlV, "tickets"), {
name: n, phone: p, status: "waiting", createdAt: serverTimestamp(), venue: urlV, number: nextNumber
});


msg.textContent = `Você entrou na fila! Seu protocolo: ${ref.id.slice(0,6)}`;
name.value = phone.value = "";
};
}


// ===== Admin =====
if (path.endsWith("/admin.html")) {
const tbody = document.getElementById("tbody");
const callNext = document.getElementById("callNext");
const finish = document.getElementById("finish");


const q = query(collection(db, "queues", VENUE, "tickets"), orderBy("number", "asc"));
onSnapshot(q, (snap) => {
tbody.innerHTML = snap.docs.map((d) => {
const t = d.data();
return `<tr><td>${t.number}</td><td>${t.name}</td><td>${t.phone}</td><td>${t.status}</td></tr>`;
}).join("");
});


const callFn = httpsCallable(functions, "callNext");
callNext.onclick = async () => { await callFn({ venue: VENUE }); };


const finishFn = httpsCallable(functions, "finishCurrent");
finish.onclick = async () => { await finishFn({ venue: VENUE }); };
}