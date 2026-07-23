# HTTP Client Detection

Bolta integration is framework-agnostic — the skill generates code in whatever HTTP client the target project already uses. Detect first; do not install a new dependency if one is present.

## Detection table

| Language | Signal | Preferred client | Fallback |
|----------|--------|------------------|----------|
| Node.js / TypeScript | `axios` in `package.json` | `axios` | `fetch` (built-in ≥ Node 18) |
| Node.js / TypeScript | `ky`, `got`, `node-fetch` in `package.json` | that package | `fetch` |
| Node.js / TypeScript | no HTTP lib | `fetch` (built-in) | — |
| Python | `httpx` in `requirements.txt` / `pyproject.toml` | `httpx` | `requests` |
| Python | `requests` in deps | `requests` | — |
| Python | no HTTP lib | `httpx` (async-friendly) | `urllib` |
| Go | — (stdlib only) | `net/http` | — |
| Java / Kotlin | `okhttp3` in `pom.xml` / `build.gradle` | OkHttp | `java.net.http.HttpClient` (JDK 11+) |
| Java / Kotlin | Spring Boot | `WebClient` / `RestTemplate` | OkHttp |
| Ruby | `faraday` in Gemfile | Faraday | `Net::HTTP` |
| PHP | Laravel | `Http` facade (Guzzle under the hood) | Guzzle directly |
| PHP | Symfony | `symfony/http-client` | Guzzle |
| C# / .NET | — | `HttpClient` | — |
| Rust | `reqwest` in `Cargo.toml` | `reqwest` | `hyper` |
| Shell / one-off | — | `curl` | `wget` |

## Detection procedure

1. Read the project's manifest file: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`, `Cargo.toml`, `*.csproj`.
2. Match against the table above — pick the topmost row that hits.
3. If no manifest or no matching dependency: ask the user which HTTP client to use, then generate code for that.
4. Do not add a new HTTP dependency unless the user explicitly asks.

## Reusable building blocks

Regardless of client, every Bolta call needs the same three things:

1. **Auth header builder** — one helper that takes `apiKey` and returns `"Basic " + base64(apiKey + ":")`.
2. **Idempotency key generator** — UUID v4, persisted alongside the invoice record.
3. **Response handler** — branch on 200 / 4xx / 5xx; retry only on 5xx with the same reference ID.

Encapsulate these in a single module (e.g., `bolta-client.ts`, `bolta_client.py`) so operation-specific code (issue, amend, etc.) stays thin.
