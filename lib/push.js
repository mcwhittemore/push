import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Rejected, missing } from "./service.js";

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The default export of `<dir>/<name>.js`, or undefined when there's no such file. */
async function load(dir, name) {
  if (!NAME.test(name)) return undefined;
  const url = new URL(`../${dir}/${name}.js`, import.meta.url);
  if (!existsSync(fileURLToPath(url))) return undefined;
  return (await import(url.href)).default;
}

const answer = (status, body) => Response.json(body, { status });

/** The service a request is for: `?service=` from the rewrite, or the path's one segment. */
function serviceOf(request) {
  const url = new URL(request.url);
  return url.searchParams.get("service") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "";
}

/**
 * POST /<service>: services/<service>.js parses and checks the request, and the target that PUSH_TARGET names
 * (targets/<name>.js) gets the envelope. Nothing is stored here: a target that fails answers 502 so the sender retries.
 */
export async function handle(request, env = process.env, now = new Date()) {
  const name = serviceOf(request);
  if (request.method !== "POST") {
    return name ? answer(405, { error: "POST only" }) : answer(200, { push: "POST /<service>" });
  }
  try {
    const ServiceClass = await load("services", name);
    if (!ServiceClass) throw new Rejected(404, `no service ${name}`);
    const targetName = env.PUSH_TARGET ?? "";
    const TargetClass = await load("targets", targetName);
    if (!TargetClass) throw new Rejected(503, `PUSH_TARGET ${targetName || "isn't set"}: no such target`);
    const unset = missing([...ServiceClass.env, ...TargetClass.env], env);
    if (unset.length) throw new Rejected(503, `${unset.join(", ")} not set`);

    const parsed = new ServiceClass(env).parse({ headers: request.headers, body: await request.text(), receivedAt: now });
    if (!parsed) return answer(200, { ignored: true });
    const envelope = { service: name, ...parsed, received_at: now.toISOString() };
    await new TargetClass(env).send(envelope);
    return answer(202, { pushed: envelope.id });
  } catch (err) {
    if (err instanceof Rejected) return answer(err.status, { error: err.message });
    console.error(err);
    return answer(500, { error: "push failed" });
  }
}
