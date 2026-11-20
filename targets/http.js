import { Target } from "../lib/target.js";

/** POSTs the envelope as JSON to PUSH_URL, with `Authorization: Bearer PUSH_TOKEN` when that's set. */
export default class Http extends Target {
  static env = ["PUSH_URL"];

  send(envelope) {
    const auth = this.env.PUSH_TOKEN ? { authorization: `Bearer ${this.env.PUSH_TOKEN}` } : {};
    return this.post(this.env.PUSH_URL, envelope, auth);
  }
}
