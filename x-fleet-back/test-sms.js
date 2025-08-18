// test-sms.js
import "dotenv/config";       // <-- loads .env automatically
import { sendSMS } from "./lib/twilio.js";

(async () => {
  try {
    const res = await sendSMS(
      "+15164560637",   // replace with your phone
      "🚀 Test from x-fleet-back"
    );
    console.log("✅ SMS sent:", res.sid);
  } catch (err) {
    console.error("❌ SMS failed:", err);
  }
})();