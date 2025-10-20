const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const twilio = require("twilio");

admin.initializeApp();
const db = admin.firestore();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_SMS,     // número SMS
  TWILIO_FROM_WHATSAPP // "whatsapp:+14155238886" (sandbox) ou número aprovado
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Utilitário: envia mensagem por WhatsApp (preferencial) ou SMS
async function notifyPhone(phone, body, channel = "whatsapp") {
  if (channel === "whatsapp" && TWILIO_FROM_WHATSAPP) {
    return client.messages.create({
      from: TWILIO_FROM_WHATSAPP,
      to: `whatsapp:${phone}`,
      body,
    });
  }
  return client.messages.create({ from: TWILIO_FROM_SMS, to: phone, body });
}

// Chamar próximo da fila
exports.callNext = functions.https.onCall(async (req) => {
  const { venue } = req.data;
  if (!venue) throw new functions.https.HttpsError("invalid-argument", "venue obrigatório");

  // busca primeiro waiting
  const snap = await db.collection("queues").doc(venue).collection("tickets")
    .where("status", "==", "waiting")
    .orderBy("number", "asc").limit(1).get();

  if (snap.empty) return { status: "empty" };

  const doc = snap.docs[0];
  const ticket = { id: doc.id, ...doc.data() };

  await doc.ref.update({ status: "called", calledAt: admin.firestore.FieldValue.serverTimestamp() });
  await db.collection("settings").doc(venue).set({
    currentTicket: doc.id,
    status: "calling",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // envia mensagem
  await notifyPhone(ticket.phone, `Sua hora chegou para jogar PS5 na fila ${venue}. Responda com OK para confirmar ou NAO para pular.`);
  return { status: "called", id: doc.id };
});

// Receber resposta do usuário via webhook do Twilio
exports.twilioWebhook = functions.https.onRequest(async (req, res) => {
  // Twilio envia em req.body.Body (texto), req.body.From (whatsapp:+55...), etc.
  const msg = (req.body.Body || "").trim().toLowerCase();
  const from = (req.body.From || "").replace("whatsapp:", "");

  // Descobrir ticket "called" mais recente daquele telefone
  const snap = await db.collectionGroup("tickets")
    .where("phone", "==", from)
    .where("status", "==", "called")
    .orderBy("calledAt", "desc").limit(1).get();

  if (snap.empty) { res.status(200).send("OK"); return; }

  const doc = snap.docs[0];
  const data = doc.data();
  const venue = data.venue;

  if (["ok", "sim", "confirmar"].includes(msg)) {
    await doc.ref.update({ status: "accepted", acceptedAt: admin.firestore.FieldValue.serverTimestamp() });
    await db.collection("settings").doc(venue).set({ status: "playing" }, { merge: true });
    await notifyPhone(from, "Obrigado! Dirija-se ao balcão: sua sessão está liberada.");
  } else if (["nao", "não", "n", "no"].includes(msg)) {
    await doc.ref.update({ status: "skipped" });
    await db.collection("settings").doc(venue).set({ status: "idle" }, { merge: true });
    // automaticamente chama o próximo
    await exports.callNext.run({ data: { venue } }, {});
  } else {
    await notifyPhone(from, "Responda apenas com OK para confirmar ou NAO para pular.");
  }
  res.status(200).send("OK");
});

// Finalizar sessão manualmente (admin)
exports.finishCurrent = functions.https.onCall(async (req) => {
  const { venue } = req.data;
  if (!venue) throw new functions.https.HttpsError("invalid-argument", "venue obrigatório");
  const setRef = db.collection("settings").doc(venue);
  const setSnap = await setRef.get();
  if (!setSnap.exists) return { status: "noop" };
  const { currentTicket } = setSnap.data();
  if (currentTicket) {
    await db.collection("queues").doc(venue).collection("tickets").doc(currentTicket)
      .update({ status: "done" });
  }
  await setRef.set({ currentTicket: null, status: "idle" }, { merge: true });
  return { status: "finished" };
});