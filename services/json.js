import { createHash } from "node:crypto";
import { Rejected, Service, safeEqual } from "../lib/service.js";

/**
 * Any JSON object, from any sender that can set `Authorization: Bearer <JSON_TOKEN>`. Optional fields shape the
 * envelope: `type` (default "json"), `id` (the subject, such as a draft that's saved many times) and `data` (default
 * the whole body). The delivery id is a hash of the body, so a retry keeps its id and a new revision gets a new one.
 */
export default class Json extends Service {
  static env = ["JSON_TOKEN"];

  parse({ headers, body }) {
    if (!safeEqual(headers.get("authorization") ?? "", `Bearer ${this.env.JSON_TOKEN}`)) {
      throw new Rejected(401, "bad token");
    }
    const value = this.json(body);
    const optional = (name) => {
      const v = value[name];
      if (v !== undefined && (typeof v !== "string" || !v)) throw new Rejected(400, `${name} must be a string`);
      return v;
    };
    const type = optional("type") ?? "json";
    const subject = optional("id");
    const id = createHash("sha256").update(body).digest("hex").slice(0, 32);
    return { id, type, ...(subject ? { subject } : {}), data: value.data ?? value };
  }
}
