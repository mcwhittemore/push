import { Rejected } from "./service.js";

/**
 * What every file in targets/ exports as its default: where a parsed delivery goes. `env` lists the variables it
 * needs. `send` gets the envelope `{ service, id, type, subject, received_at, data }` and throws if it didn't land,
 * so push answers 502 and the sender retries.
 */
export class Target {
  static env = [];

  constructor(env) {
    this.env = env;
  }

  async send() {
    throw new Error(`${this.constructor.name} doesn't implement send`);
  }

  /** POSTs JSON and throws unless the answer is 2xx. */
  async post(url, body, headers = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error",
    });
    if (!res.ok) throw new Rejected(502, `target answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
