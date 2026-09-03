# NudgeFlow — Full Stack Cart Ghost

This version combines the NudgeFlow frontend and backend and serves both from the same Node.js server.

## Run at 127.0.0.1:8000

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   npm install
4. Run:
   npm start
5. Open:
   http://127.0.0.1:8000/

## Backend APIs

GET  /api/health
GET  /api/dashboard
POST /api/detect
POST /api/follow-up
POST /api/recover
GET  /webhook   — Meta's webhook verification handshake
POST /webhook   — inbound WhatsApp messages + status updates

## WhatsApp Cloud API (live sending)

1. In Meta Business Manager, create a WhatsApp Business app and get:
   - a temporary or permanent **access token** → `WHATSAPP_ACCESS_TOKEN`
   - the **phone number ID** for your sending number → `WHATSAPP_PHONE_NUMBER_ID`
2. Pick any secret string for `WHATSAPP_VERIFY_TOKEN` and use the same value
   when you configure the webhook URL in Meta's dashboard
   (Webhook URL: `https://<your-domain>/webhook`).
3. Set `MOCK_MODE=false` in `.env`.
4. Restart the server. `/api/follow-up` will now call the real Cloud API via
   `lib/whatsapp.js` instead of just preparing the message text.

Notes:
- Free-form text messages only work within Meta's 24-hour customer service
  window (i.e. the customer messaged you in the last 24h). Outside that
  window, use `whatsapp.sendTemplateMessage()` with a pre-approved template
  instead of `sendTextMessage()`.
- Inbound customer replies arrive at `POST /webhook`, get matched to a chat
  by phone number, and are run back through the same `detectIntent()` used
  everywhere else — this is what resets the cooldown and re-scores intent
  on a new reply.

## NudgeFlow hard rules

- Detect genuine purchase intent vs casual chat.
- Do not nudge until the 30-minute cooldown is complete.
- Maximum 2 follow-ups.
- Do not nudge low-confidence/casual conversations.
- Generate a personalized payment link.

## Current mode

MOCK_MODE=true means the UI and backend work without WhatsApp credentials. The follow-up is prepared but not actually sent.

For production, connect the WhatsApp Cloud API, OpenAI intent classifier, and a persistent database/Google Sheets.
