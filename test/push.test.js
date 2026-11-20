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
  JSON_TOKEN: "ink",
  GRANOLA_SECRET,
  VERCEL_WEBHOOK_SECRET: "vsecret",
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

test("json: any JSON object is dispatched, keyed by a hash of its body", async () => {
  const body = JSON.stringify(draft);
  const res = await post("/json", body, { authorization: "Bearer ink" });
  assert.equal(res.status, 202);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.github.com/repos/someone/somewhere/dispatches");
  assert.equal(sent[0].headers.authorization, "Bearer ghp_test");
  const { event_type, client_payload } = sent[0].body;
  assert.equal(event_type, "push.json");
  assert.match(client_payload.id, /^[0-9a-f]{32}$/);
  assert.deepEqual(client_payload, {
    service: "json",
    id: client_payload.id,
    type: "draft.saved",
    subject: "d1",
    data: draft.data,
    received_at: NOW.toISOString(),
  });
  // A retry keeps its id; a new revision gets a new one.
  await post("/json", body, { authorization: "Bearer ink" });
  const revised = JSON.stringify({ ...draft, data: { ...draft.data, text: "hello again" } });
  await post("/json", revised, { authorization: "Bearer ink" });
  assert.equal(sent[1].body.client_payload.id, client_payload.id);
  assert.notEqual(sent[2].body.client_payload.id, client_payload.id);
});

test("json: a bare object gets type json, no subject, and the body as data", async () => {
  await post("/json", JSON.stringify({ hello: "world" }), { authorization: "Bearer ink" });
  const { client_payload } = sent[0].body;
  assert.equal(client_payload.type, "json");
  assert.equal("subject" in client_payload, false);
  assert.deepEqual(client_payload.data, { hello: "world" });
});

test("json: a bad token or body is refused and nothing is sent", async () => {
  assert.equal((await post("/json", JSON.stringify(draft), { authorization: "Bearer nope" })).status, 401);
  assert.equal((await post("/json", "{", { authorization: "Bearer ink" })).status, 400);
  assert.equal((await post("/json", "[1]", { authorization: "Bearer ink" })).status, 400);
  assert.equal((await post("/json", JSON.stringify({ type: 3 }), { authorization: "Bearer ink" })).status, 400);
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

const vercelSigned = (body, secret = "vsecret") => ({
  "x-vercel-signature": createHmac("sha1", secret).update(body).digest("hex"),
});

test("vercel: a signed event is dispatched about its deployment", async () => {
  const body = JSON.stringify({
    id: "evt_1",
    type: "deployment.error",
    createdAt: 1763658000000,
    payload: { deployment: { id: "dpl_1", name: "push" }, project: { id: "prj_1" }, target: "production" },
  });
  assert.equal((await post("/vercel", body, vercelSigned(body))).status, 202);
  const { event_type, client_payload } = sent[0].body;
  assert.equal(event_type, "push.vercel");
  assert.equal(client_payload.id, "evt_1");
  assert.equal(client_payload.type, "com.vercel.deployment.error");
  assert.equal(client_payload.subject, "dpl_1");
  assert.equal(client_payload.data.payload.deployment.name, "push");
});

test("vercel: an event without a deployment is about its project, else itself", async () => {
  const project = JSON.stringify({ id: "evt_2", type: "project.created", payload: { project: { id: "prj_9" } } });
  const bare = JSON.stringify({ id: "evt_3", type: "domain.created", payload: {} });
  await post("/vercel", project, vercelSigned(project));
  await post("/vercel", bare, vercelSigned(bare));
  assert.equal(sent[0].body.client_payload.subject, "prj_9");
  assert.equal(sent[1].body.client_payload.subject, "evt_3");
});

test("vercel: a wrong or missing signature, or a body without id or type, is refused", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "deployment.created", payload: {} });
  assert.equal((await post("/vercel", body, vercelSigned(body, "other"))).status, 401);
  assert.equal((await post("/vercel", body)).status, 401);
  assert.equal((await post("/vercel", `${body} `, vercelSigned(body))).status, 401);
  const noType = JSON.stringify({ id: "evt_1" });
  assert.equal((await post("/vercel", noType, vercelSigned(noType))).status, 400);
  assert.equal(sent.length, 0);
});

test("routing: unknown or unsafe services 404, GET says how to use it", async () => {
  assert.equal((await post("/nope", "{}")).status, 404);
  assert.equal((await post("/..%2Flib%2Fpush", "{}")).status, 404);
  assert.equal((await post("/api?service=../lib/push", "{}")).status, 404);
  const root = await handle(new Request("https://push.example/"), env, NOW);
  assert.equal(root.status, 200);
  assert.equal((await handle(new Request("https://push.example/json"), env, NOW)).status, 405);
});

test("config: a missing target or variable is a 503, a failing target a 502", async () => {
  const body = JSON.stringify(draft);
  const auth = { authorization: "Bearer ink" };
  assert.equal((await post("/json", body, auth, { ...env, PUSH_TARGET: undefined })).status, 503);
  const res = await post("/json", body, auth, { ...env, GITHUB_TOKEN: "" });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /GITHUB_TOKEN/);
  targetStatus = 422;
  assert.equal((await post("/json", body, auth)).status, 502);
});

test("github target: a payload GitHub calls too large is a 413, not a retry", async () => {
  globalThis.fetch = async () => Response.json({ message: "client_payload is too large." }, { status: 422 });
  const res = await post("/json", JSON.stringify(draft), { authorization: "Bearer ink" });
  assert.equal(res.status, 413);
});

test("http target: posts the bare envelope with an optional bearer", async () => {
  const e = { PUSH_TARGET: "http", PUSH_URL: "https://hook.example/in", PUSH_TOKEN: "t", JSON_TOKEN: "ink" };
  assert.equal((await post("/json", JSON.stringify(draft), { authorization: "Bearer ink" }, e)).status, 202);
  assert.equal(sent[0].url, "https://hook.example/in");
  assert.equal(sent[0].headers.authorization, "Bearer t");
  assert.equal(sent[0].body.service, "json");
});
