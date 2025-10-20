const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const twilio = require("twilio");
admin.initializeApp();
const db = admin.firestore();


const ARENAS = ["A1_TV","A2_TV","A3_PROJ","A4_PROJ"];


const {
TWILIO_ACCOUNT_SID,
TWILIO_AUTH_TOKEN,
TWILIO_FROM_SMS,
TWILIO_FROM_WHATSAPP,
} = process.env;
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);


async function notifyPhone(phone, body, channel = "whatsapp") {
if (channel === "whatsapp" && TWILIO_FROM_WHATSAPP) {
return client.messages.create({ from: TWILIO_FROM_WHATSAPP, to: `whatsapp:${phone}`, body });
}
return client.messages.create({ from: TWILIO_FROM_SMS, to: phone, body });
}


function nowTs() { return admin.firestore.FieldValue.serverTimestamp(); }


async function ensureSettings(arena) {
const ref = db.collection("settings").doc(arena);
const snap = await ref.get();
if (!snap.exists) {
await ref.set({ gameDurationSec: 17*60, status: "idle", updatedAt: nowTs(), currentTicket: null, currentStartAt: null, currentEndAt: null });
}
return ref;
}


// Início automático: ao criar ticket, se arena está idle, inicia sessão
exports.autoStartOnCreate = functions.firestore.onDocumentCreated("queues/{arena}/tickets/{ticketId}", async (event) => {
const arena = event.params.arena;
const data = event.data.data();
const setRef = await ensureSettings(arena);
const setSnap = await setRef.get();
const s = setSnap.data();
if (s.status !== "idle") return; // já tem alguém


const start = admin.firestore.Timestamp.now();
const end = admin.firestore.Timestamp.fromMillis(start.toMillis() + (s.gameDurationSec||1020)*1000);


await db.collection("queues").doc(arena).collection("tickets").doc(event.params.ticketId).update({
status: "accepted", calledAt: start, acceptedAt: start,
});
await setRef.set({ currentTicket: event.params.ticketId, currentStartAt: start, currentEndAt: end, status: "playing", updatedAt: nowTs() }, { merge: true });
await notifyPhone(data.phone, `Sua hora chegou! Dirija-se à ${arena}. Tempo de sessão: ${(s.gameDurationSec||1020)/60} minutos.`);
});


// Chamar próximo manualmente (Admin)
exports.callNext = functions.https.onCall(async (req) => {
const { arena } = req.data; if (!arena) throw new functions.https.HttpsError("invalid-argument", "arena obrigatória");
const setRef = await ensureSettings(arena);
const s = (await setRef.get()).data();
// conclui atual se já passou do tempo
if (s.currentEndAt && s.currentEndAt.toMillis() <= Date.now()) {
if (s.currentTicket) await db.collection("queues").doc(arena).collection("tickets").doc(s.currentTicket).update({ status: "done" });
await setRef.set({ currentTicket: null, currentStartAt: null, currentEndAt: null, status: "idle" }, { merge: true });
}
// se ainda playing, não chama
if ((await setRef.get()).data().status === "playing") return { status: "busy" };


const q = await db.collection("queues").doc(arena).collection("tickets")
.where("status","==","waiting").orderBy("number","asc").limit(1).get();
if (q.empty) return { status: "empty" };


});