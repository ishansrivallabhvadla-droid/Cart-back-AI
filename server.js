require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const whatsapp = require("./lib/whatsapp");

const app = express();
const PORT = process.env.PORT || 8000;
const MOCK_MODE = process.env.MOCK_MODE !== "false";
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let chats = [
  {id:"1001",customer:"Ananya",phone:"919876543210",product:"Handmade Tote Bag",amount:899,status:"abandoned",
   messages:[{from:"customer",text:"Is the blue tote available?",time:"10:01 AM"},{from:"store",text:"Yes, it is available. I can send the payment link.",time:"10:03 AM"},{from:"customer",text:"Okay, I'll buy later.",time:"10:05 AM"}],
   lastCustomerMessage:"Okay, I'll buy later.",minutesAgo:32,followUps:0,recovered:false,intent:"purchase delayed",intentScore:.94,cooldownReady:true},
  {id:"1002",customer:"Vikram",phone:"919812345678",product:"Leather Wallet",amount:1299,status:"abandoned",
   messages:[{from:"customer",text:"Can you send the payment link?",time:"9:11 AM"}],
   lastCustomerMessage:"Can you send the payment link?",minutesAgo:41,followUps:0,recovered:false,intent:"payment intent",intentScore:.97,cooldownReady:true},
  {id:"1003",customer:"Sneha",phone:"919899887766",product:"Ceramic Mug Set",amount:749,status:"abandoned",
   messages:[{from:"customer",text:"Maybe I'll order tonight.",time:"11:24 AM"}],
   lastCustomerMessage:"Maybe I'll order tonight.",minutesAgo:8,followUps:0,recovered:false,intent:"purchase delayed",intentScore:.88,cooldownReady:false,cooldownMinutes:22},
  {id:"1004",customer:"Rahul",phone:"919877665544",product:"Desk Lamp",amount:1299,status:"casual",
   messages:[{from:"customer",text:"Thanks, looks nice!",time:"10:30 AM"}],
   lastCustomerMessage:"Thanks, looks nice!",minutesAgo:36,followUps:0,recovered:false,intent:"casual chat",intentScore:.12,cooldownReady:false}
];

function detectIntent(text) {
  const t = text.toLowerCase();
  const buying = ["buy later","i'll buy","ill buy","payment link","pay","reserve","book it","want one","take it","place order","order tonight"];
  const casual = ["nice","cool","thanks","just checking","what colors","maybe"];
  if (buying.some(x=>t.includes(x))) return {intent:"purchase delayed",score:.94};
  if (casual.some(x=>t.includes(x))) return {intent:"casual chat",score:.12};
  return {intent:"uncertain",score:.45};
}

function canNudge(c) {
  return c.intentScore >= .7 && c.cooldownReady && c.followUps < 2 && !c.recovered;
}

app.get("/api/health",(req,res)=>res.json({ok:true,backend:"Node.js + Express",port:PORT,mockMode:MOCK_MODE}));

app.get("/api/dashboard",(req,res)=>{
  const abandoned=chats.filter(c=>c.status==="abandoned").length;
  const nudged=chats.reduce((n,c)=>n+c.followUps,0);
  const recovered=chats.filter(c=>c.recovered).length;
  const recoveredRevenue=chats.filter(c=>c.recovered).reduce((n,c)=>n+c.amount,0);
  res.json({
    backend:"Node.js + Express",
    metrics:{chats:chats.length,abandoned,nudged,recovered,recoveredRevenue},
    chats
  });
});

app.post("/api/detect",(req,res)=>{
  const c=chats.find(x=>x.id===req.body.chatId);
  if(!c) return res.status(404).json({error:"Chat not found"});
  const r=detectIntent(c.lastCustomerMessage);
  c.intent=r.intent;c.intentScore=r.score;
  c.status=r.score>=.7?"abandoned":"casual";
  res.json({chat:c,intent:r.intent,score:r.score,shouldNudge:canNudge(c)});
});

app.post("/api/follow-up", async (req, res) => {
  const c = chats.find(x => x.id === req.body.chatId);
  if (!c) return res.status(404).json({ error: "Chat not found" });
  if (c.followUps >= 2) return res.status(400).json({ error: "Maximum of 2 follow-ups reached." });
  if (!c.cooldownReady) return res.status(400).json({ error: `30-minute cooldown is not complete. Wait ${c.cooldownMinutes} minutes.` });
  if (c.intentScore < .7) return res.status(400).json({ error: "No nudge: genuine purchase intent was not detected." });
  if (c.recovered) return res.status(400).json({ error: "This chat is already marked as recovered." });

  const link = `https://pay.nudgeflow.local/cart-${c.id}`;
  const message = `Hey ${c.customer}! 👋 Just checking in on your ${c.product}. If you'd still like it, you can complete your order here: ${link}`;

  // MOCK_MODE: prepare the message but don't actually call WhatsApp.
  if (MOCK_MODE) {
    c.followUps++;
    c.messages.push({ from: "store", text: message, time: "now" });
    return res.json({ success: true, mock: true, followUps: c.followUps, message, paymentLink: link });
  }

  // Live mode: actually send through the WhatsApp Cloud API.
  try {
    const result = await whatsapp.sendTextMessage(c.phone, message);
    c.followUps++;
    c.messages.push({ from: "store", text: message, time: "now", whatsappMessageId: result.messageId });
    res.json({
      success: true,
      mock: false,
      followUps: c.followUps,
      message,
      paymentLink: link,
      whatsappMessageId: result.messageId
    });
  } catch (err) {
    console.error("WhatsApp send failed:", err.message, err.details || "");
    const status = err.code === "WHATSAPP_NOT_CONFIGURED" ? 500 : 502;
    res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "WHATSAPP_SEND_FAILED",
      hint: err.code === "WHATSAPP_NOT_CONFIGURED"
        ? "Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env, or set MOCK_MODE=true to test without sending."
        : "If this is outside the 24h customer service window, you'll need an approved message template instead of free-form text."
    });
  }
});

// --- WhatsApp webhook (required by Meta to receive delivery status + inbound replies) ---

// Verification handshake: Meta calls this once when you configure the webhook URL.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && WHATSAPP_VERIFY_TOKEN && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Inbound messages + status updates land here.
app.post("/webhook", (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const inbound = change?.messages?.[0];

    if (inbound && inbound.type === "text") {
      const fromPhone = inbound.from;
      const text = inbound.text.body;
      const c = chats.find(x => x.phone === fromPhone);
      if (c) {
        c.messages.push({ from: "customer", text, time: "now" });
        c.lastCustomerMessage = text;
        c.minutesAgo = 0;
        c.cooldownReady = false;
        c.cooldownMinutes = 30;
        const r = detectIntent(text);
        c.intent = r.intent;
        c.intentScore = r.score;
        c.status = r.score >= .7 ? "abandoned" : "casual";
      } else {
        // Unknown number messaging in — could create a new chat record here.
        console.log(`Inbound WhatsApp message from unknown number ${fromPhone}: ${text}`);
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err.message);
  }
  // Always 200 quickly so Meta doesn't retry/backoff.
  res.sendStatus(200);
});

app.post("/api/recover",(req,res)=>{
  const c=chats.find(x=>x.id===req.body.chatId);
  if(!c) return res.status(404).json({error:"Chat not found"});
  c.recovered=true;c.status="recovered";
  res.json({success:true,chat:c});
});

app.get("*",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT,()=>console.log(`NudgeFlow running at http://127.0.0.1:${PORT}`));
