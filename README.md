# push

A tiny webhook proxy. Apps that can only call a URL post to `push`. It checks each delivery and sends it on to one
place, such as a GitHub repository_dispatch. It stores nothing and runs nothing else.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmcwhittemore%2Fpush&project-name=push&env=PUSH_TARGET&envDescription=PUSH_TARGET%20names%20a%20file%20in%20targets%2F%20(github%20or%20http).%20Then%20add%20that%20target%27s%20and%20your%20services%27%20variables%20from%20the%20README.&envLink=https%3A%2F%2Fgithub.com%2Fmcwhittemore%2Fpush%23config)

```
POST https://<your push>/<service>
  -> services/<service>.js   parses and checks it (signature, token, shape)
  -> targets/<PUSH_TARGET>.js sends { service, id, type, subject, received_at, data }
```

## Answers

| Status | When |
| --- | --- |
| `202 {pushed: <id>}` | parsed and accepted by the target |
| `200 {ignored: true}` | a valid delivery with nothing in it, such as a test ping |
| `400` / `401` | the service rejected it: bad body, token or signature |
| `404` | no `services/<service>.js` |
| `405` | not a POST |
| `413` | too large for the target, such as a GitHub dispatch over ~64 KB |
| `502` | the target refused it. The sender should retry |
| `503` | `PUSH_TARGET`, or a variable the service or target needs, isn't set |

## Config

Everything comes from environment variables, so a fork changes no code. `PUSH_TARGET` picks the target.

| Target | Variables |
| --- | --- |
| `github` | `GITHUB_REPO` (`owner/name`) and `GITHUB_TOKEN`, with write access to that repo's contents. It sends `event_type: push.<service>` with the envelope as `client_payload` |
| `http` | `PUSH_URL`, plus `PUSH_TOKEN` if you want `Authorization: Bearer` on the request. It posts the envelope as JSON |

| Service | Variables | Sender setup |
| --- | --- | --- |
| `json` | `JSON_TOKEN` | For any sender that can set a header. POST a JSON object to `https://<your push>/json` with `Authorization: Bearer <JSON_TOKEN>`. The optional `type` (default `json`), `id` (becomes `subject`) and `data` (default: the whole body) shape the envelope. The envelope `id` is a hash of the body, so a retry keeps its id |
| `granola` | `GRANOLA_SECRET` | Granola → Settings → Connectors → Webhooks: paste `https://<your push>/granola`, then set `GRANOLA_SECRET` to the `whsec_` secret it shows and redeploy. Events carry only `note_id`, so fetch the note with a Granola API key |
| `vercel` | `VERCEL_WEBHOOK_SECRET` | Vercel → Team Settings → Webhooks: add `https://<your push>/vercel` and pick the events you want. Then set `VERCEL_WEBHOOK_SECRET` to the secret it shows and redeploy. The envelope's `type` is `com.vercel.<event>`, and its `subject` is the deployment, else the project |

A service whose variable isn't set answers `503`, so you can deploy with only the services you use.

## A GitHub workflow on the other end

```yaml
on:
  repository_dispatch:
    types: [push.json, push.granola, push.vercel]
jobs:
  land:
    runs-on: ubuntu-latest
    steps:
      - run: echo '${{ toJSON(github.event.client_payload) }}'
```

GitHub limits `client_payload` to 10 top-level keys, and the envelope uses six. It also caps the payload's size at
about 64 KB (60 KB goes through, 100 KB doesn't). Anything bigger gets `413`, since a retry won't fix it.

## Adding a service or target

Add `services/<name>.js` with a default export that extends `Service` from `lib/service.js`. Set `static env` to the
variables it needs. `parse({ headers, body, receivedAt })` returns `{ id, type, subject, data }`, returns `null` to
ignore the delivery, or throws `new Rejected(status, message)`. `id` is unique per delivery, so the receiver can
de-duplicate retries.

A target extends `Target` from `lib/target.js` and implements `send(envelope)`. It should throw if the envelope
didn't land.

```sh
npm test
```
