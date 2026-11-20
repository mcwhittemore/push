import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { handle } from "../lib/push.js";

const NOW = new Date("2026-11-20T17:00:00Z");
const GRANOLA_SECRET = `whsec_${Buffer.from("granola-test-key").toString("base64")}`;
const env = {
  PUSH_TARGET: "github",
  GITHUB_REPO: "someone/somewhere",
  GITHUB_TOKEN: "ghp_test",
  INKLING_TOKEN: "ink",
  GRANOLA_SECRET,
};

let sent;
let targetStatus;
const realFetch = globalThis.fetch;
beforeEach(() => {
  sent = [];
  targetStatus = 204;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: targetStatus });
  };
});
afterEach(() => (globalThis.fetch = realFetch));

const post = (path, body, headers = {}, e = env) =>
  handle(new Request(`https://push.example${path}`, { method: "POST", body, headers }), e, NOW);

const draft = { type: "draft.saved", id: "d1", data: { title: "Hi", text: "hello", saved_at: "2026-11-20T16:59:00Z" } };

test("inkling: a good draft is dispatched with its service", async () => {
  const res = await post("/inkling", JSON.stringify(draft), { authorization: "Bearer ink" });
  assert.equal(res.status, 202);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.github.com/repos/someone/somewhere/dispatches");
  assert.equal(sent[0].headers.authorization, "Bearer ghp_test");
  assert.deepEqual(sent[0].body, {
    event_type: "push.inkling",
    client_payload: {
      service: "inkling",
      id: "d1:2026-11-20T16:59:00Z",
      type: "draft.saved",
      subject: "d1",
      data: draft.data,
      received_at: NOW.toISOString(),
    },
  });
});

test("inkling: a bad token or body is refused and nothing is sent", async () => {
  assert.equal((await post("/inkling", JSON.stringify(draft), { authorization: "Bearer nope" })).status, 401);
  assert.equal((await post("/inkling", "{", { authorization: "Bearer ink" })).status, 400);
  assert.equal((await post("/inkling", JSON.stringify({ ...draft, data: {} }), { authorization: "Bearer ink" })).status, 400);
  assert.equal(sent.length, 0);
});

const signed = (body, { secret = GRANOLA_SECRET, at = NOW } = {}) => {
  const id = "msg_1";
  const ts = String(Math.floor(at.getTime() / 1000));
  const key = Buffer.from(secret.slice(6), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,bogus v1,${sig}` };
};

test("granola: a signed note event is dispatched", async () => {
  const body = JSON.stringify({ event_type: "note.generated", note_id: "not_1", occurred_at: "2026-11-20T16:00:00Z" });
  const res = await post("/granola", body, signed(body));
  assert.equal(res.status, 202);
  const { client_payload } = sent[0].body;
  assert.equal(sent[0].body.event_type, "push.granola");
  assert.equal(client_payload.id, "msg_1");
  assert.equal(client_payload.type, "ai.granola.note.generated");
  assert.equal(client_payload.subject, "not_1");
});

test("granola: wrong secret, stale timestamp and tampered body are refused", async () => {
  const body = JSON.stringify({ event_type: "note.generated", note_id: "not_1" });
  const other = `whsec_${Buffer.from("other").toString("base64")}`;
  assert.equal((await post("/granola", body, signed(body, { secret: other }))).status, 401);
  assert.equal((await post("/granola", body, signed(body, { at: new Date(NOW - 10 * 60e3) }))).status, 401);
  assert.equal((await post("/granola", `${body} `, signed(body))).status, 401);
  assert.equal((await post("/granola", body)).status, 401);
  assert.equal(sent.length, 0);
});

test("granola: the dialog's test event is acknowledged and not sent", async () => {
  const body = JSON.stringify({ event_type: "test" });
  const res = await post("/granola", body, signed(body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ignored: true });
  assert.equal(sent.length, 0);
});

test("routing: unknown or unsafe services 404, GET says how to use it", async () => {
  assert.equal((await post("/nope", "{}")).status, 404);
  assert.equal((await post("/..%2Flib%2Fpush", "{}")).status, 404);
  assert.equal((await post("/api?service=../lib/push", "{}")).status, 404);
  const root = await handle(new Request("https://push.example/"), env, NOW);
  assert.equal(root.status, 200);
  assert.equal((await handle(new Request("https://push.example/inkling"), env, NOW)).status, 405);
});

test("config: a missing target or variable is a 503, a failing target a 502", async () => {
  const body = JSON.stringify(draft);
  const auth = { authorization: "Bearer ink" };
  assert.equal((await post("/inkling", body, auth, { ...env, PUSH_TARGET: undefined })).status, 503);
  const res = await post("/inkling", body, auth, { ...env, GITHUB_TOKEN: "" });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /GITHUB_TOKEN/);
  targetStatus = 422;
  assert.equal((await post("/inkling", body, auth)).status, 502);
});

test("http target: posts the bare envelope with an optional bearer", async () => {
  const e = { PUSH_TARGET: "http", PUSH_URL: "https://hook.example/in", PUSH_TOKEN: "t", INKLING_TOKEN: "ink" };
  assert.equal((await post("/inkling", JSON.stringify(draft), { authorization: "Bearer ink" }, e)).status, 202);
  assert.equal(sent[0].url, "https://hook.example/in");
  assert.equal(sent[0].headers.authorization, "Bearer t");
  assert.equal(sent[0].body.service, "inkling");
});
