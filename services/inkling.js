import { Rejected, Service, safeEqual } from "../lib/service.js";

/**
 * Inkling (https://github.com/craftmilldev/inkling): each Cmd-S posts the draft with `Authorization: Bearer <token>`.
 * Body: `{ type: "draft.saved", id: <draft id>, data: { title, text, saved_at } }`. Every save of a draft keeps its
 * id, so the subject is the draft and the delivery id adds the save time.
 */
export default class Inkling extends Service {
  static env = ["INKLING_TOKEN"];

  parse({ headers, body }) {
    const auth = headers.get("authorization") ?? "";
    if (!safeEqual(auth, `Bearer ${this.env.INKLING_TOKEN}`)) throw new Rejected(401, "bad token");
    const { type, id, data } = this.json(body);
    if (type !== "draft.saved") throw new Rejected(400, "type isn't draft.saved");
    if (typeof id !== "string" || !id) throw new Rejected(400, "missing id");
    if (!data || typeof data.text !== "string" || typeof data.saved_at !== "string") {
      throw new Rejected(400, "data needs text and saved_at");
    }
    return { id: `${id}:${data.saved_at}`, type, subject: id, data };
  }
}
