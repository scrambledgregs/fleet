import express from "express";
import { verifyWebhook, mapWebhook } from "../lib/mailgun";

const router = express.Router();
const events: any[] = [];

router.post(
  "/webhooks/mailgun",
  express.urlencoded({ extended: true }),
  express.json(),
  (req, res) => {
    const sig = req.body.signature?.timestamp
      ? req.body.signature
      : { timestamp: req.body.timestamp, token: req.body.token, signature: req.body.signature };

    // optional: reject stale signatures (anti-replay)
    const skew = Math.abs(Date.now()/1000 - Number(sig?.timestamp || 0));
    if (!sig?.timestamp || !sig?.token || !sig?.signature || skew > 900 || !verifyWebhook(sig)) {
      return res.status(401).send("invalid signature");
    }

    const mapped = mapWebhook(req.body);
    console.log("[Mailgun webhook]", mapped);
    // TODO: upsert by mapped.providerMessageId
    return res.sendStatus(200);
  }
);

export default router;