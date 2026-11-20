import { Target } from "../lib/target.js";

/**
 * A GitHub repository_dispatch: `on: repository_dispatch` with `types: [push.<service>]` runs a workflow, and the
 * envelope is `github.event.client_payload`. GITHUB_TOKEN needs write access to GITHUB_REPO's contents
 * (a fine-grained token with Contents: read and write on that one repo is enough).
 */
export default class GitHub extends Target {
  static env = ["GITHUB_REPO", "GITHUB_TOKEN"];

  send(envelope) {
    return this.post(
      `https://api.github.com/repos/${this.env.GITHUB_REPO}/dispatches`,
      { event_type: `push.${envelope.service}`, client_payload: envelope },
      {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        "user-agent": "push",
        "x-github-api-version": "2022-11-28",
      },
    );
  }
}
