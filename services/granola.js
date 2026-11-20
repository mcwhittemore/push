import { createHmac } from "node:crypto";
import { Rejected, Service, safeEqual } from "../lib/service.js";

/** How far webhook-timestamp may be from now, either way. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Granola note webhooks (https://docs.granola.ai/webhooks), signed with Standard Webhooks. Granola shows the
 * `whsec_` secret once, after it has the URL, so deploy first and set GRANOLA_SECRET after. Each event only carries
 * the note id: fetch the note with a Granola API key.
 */
export default class Granola extends Service {
  static env = ["GRANOLA_SECRET"];

  parse({ headers, body, receivedAt }) {
    const id = headers.get("webhook-id");
    const timestamp = headers.get("webhook-timestamp");
    const signatures = headers.get("webhook-signature");
    if (!id || !timestamp || !signatures) throw new Rejected(401, "missing webhook-id, -timestamp or -signature");

    const sentAt = Number(timestamp);
    if (!Number.isInteger(sentAt) || Math.abs(receivedAt.getTime() / 1000 - sentAt) > TOLERANCE_SECONDS) {
      throw new Rejected(401, "webhook-timestamp is too far from now");
    }
    const key = Buffer.from(this.env.GRANOLA_SECRET.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
    // Space-separated `v1,<base64>` entries; more than one while a secret rotates.
    if (!signatures.split(" ").some((s) => s.startsWith("v1,") && safeEqual(s.slice(3), expected))) {
      throw new Rejected(401, "signature mismatch");
    }

    const payload = this.json(body);
    // A signed delivery about no note is the webhook dialog's test event: answer 200 and push nothing.
    if (typeof payload.note_id !== "string" || !payload.note_id) return null;
    if (typeof payload.event_type !== "string" || !payload.event_type) throw new Rejected(400, "missing event_type");
    return { id, type: `ai.granola.${payload.event_type}`, subject: payload.note_id, data: payload };
  }
}
