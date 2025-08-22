import express from 'express';
import { sendEmail } from '../lib/mailgun';   // ⬅️ remove ".ts"
import { draftEmail } from '../lib/emailDraft';

const router = express.Router();

router.post("/email/send", async (req, res) => {
  try {
    const { to, subject, text, html, replyTo } = req.body || {};
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ ok:false, error: "to, subject, and text or html are required" });
    }
    const r = await sendEmail({ to, subject, text, html, replyTo });
    res.json({ ok:true, result: r });
  } catch (e:any) {
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

export default router;