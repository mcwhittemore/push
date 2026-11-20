import { createHmac } from "node:crypto";
import { Rejected, Service, safeEqual } from "../lib/service.js";

/**
 * Vercel webhooks (https://vercel.com/docs/webhooks/webhooks-api), signed with `x-vercel-signature`: the hex SHA-1
 * HMAC of the raw body. Vercel shows the secret when the webhook is made, after it has the URL, so set
 * VERCEL_WEBHOOK_SECRET then and redeploy. Body: `{ id, type, createdAt, region, payload }`.
 */
export default class Vercel extends Service {
  static env = ["VERCEL_WEBHOOK_SECRET"];

  parse({ headers, body }) {
    const signature = headers.get("x-vercel-signature") ?? "";
    const expected = createHmac("sha1", this.env.VERCEL_WEBHOOK_SECRET).update(body, "utf8").digest("hex");
    if (!signature || !safeEqual(signature, expected)) throw new Rejected(401, "signature mismatch");

    const event = this.json(body);
    if (typeof event.id !== "string" || !event.id) throw new Rejected(400, "missing id");
    if (typeof event.type !== "string" || !event.type) throw new Rejected(400, "missing type");
    const p = event.payload ?? {};
    // What the event is about: the deployment, else the project, else the event itself.
    const subject = p.deployment?.id ?? p.project?.id ?? p.projectId ?? event.id;
    return { id: event.id, type: `com.vercel.${event.type}`, subject: String(subject), data: event };
  }
}
