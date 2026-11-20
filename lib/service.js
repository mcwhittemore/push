import { timingSafeEqual } from "node:crypto";

/** Thrown by a service or target to answer with a status. */
export class Rejected extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * What every file in services/ exports as its default. A service reads one sender's request and says what it was.
 *
 * `env` lists the variables it needs; push answers 503 until they're set. `parse` gets
 * `{ headers, body, receivedAt }`, with `body` as the raw text, and returns `{ id, type, subject, data }`, or null for
 * a delivery that's fine but carries nothing (a test ping). It throws `Rejected` for one that isn't.
 */
export class Service {
  static env = [];

  constructor(env) {
    this.env = env;
  }

  parse() {
    throw new Error(`${this.constructor.name} doesn't implement parse`);
  }

  /** The body as a JSON object, or a 400. */
  json(body) {
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      throw new Rejected(400, "body isn't JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Rejected(400, "body isn't a JSON object");
    return value;
  }
}

/** Compares two strings in constant time. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The variables in `names` that `env` is missing. */
export const missing = (names, env) => names.filter((name) => !env[name]);
