# NudgeFlow backend architecture

Browser at :8000
   ↓
Node.js + Express
   ├─ /api/dashboard
   ├─ /api/detect
   ├─ /api/follow-up
   └─ /api/recover
   ↓
Intent engine
   ↓
30-minute cooldown
   ↓
Max 2 follow-up guard
   ↓
WhatsApp Cloud API (production)
   ↓
Payment link
   ↓
Recovery analytics

The frontend now calls the backend rather than simulating the core actions.
