export * as ProviderSync from "./provider-sync.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Config } from "./config.js"
import { Integration } from "./integration.js"
import { refreshLocalProvider } from "./plugin/provider/local.js"
import { Provider } from "./provider.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("ProviderSync.NotFound", {
  providerID: Schema.String,
}) {
  override get message() {
    return `Provider not found: ${this.providerID}`
  }
}

/** The provider has no model listing endpoint that sync knows how to reach, or the listing request failed. */
export class RequestError extends Schema.TaggedError<RequestError>()("ProviderSync.Request", {
  providerID: Schema.String,
  detail: Schema.String,
}) {
  override get message() {
    return `Cannot sync models for ${this.providerID}: ${this.detail}`
  }
}

export type Error = NotFoundError | RequestError

export interface Result {
  /**
   * Models the provider did not list before the sync. Remote providers get them written to the global
   * config; local providers (Ollama, LM Studio, vLLM) only rediscover them, since their inventory is live.
   */
  readonly added: readonly string[]
  /** Chat models the provider endpoint returned. */
  readonly total: number
}

export interface Interface {
  readonly sync: (providerID: Provider.ID) => Effect.Effect<Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderSync") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const integrations = yield* Integration.Service
    const config = yield* Config.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

    const sync = Effect.fn("ProviderSync.sync")(function* (providerID: Provider.ID) {
      const definition = (yield* providers.snapshot()).records.get(providerID)
      const failure = (detail: string) => new RequestError({ providerID, detail })
      const known = new Set<string>(
        [...(definition?.models.values() ?? [])].flatMap((model) => [model.id, model.modelID]),
      )

      // Local servers are polled by their plugin; writing their models to config would keep deleted models listed.
      const local = refreshLocalProvider(providerID)
      if (local) {
        const ids = yield* local.pipe(
          Effect.timeout("30 seconds"),
          Effect.mapError((error) => failure(error instanceof globalThis.Error ? error.message : String(error))),
        )
        return { added: ids.filter((id) => !known.has(id)), total: ids.length }
      }

      if (!definition) return yield* new NotFoundError({ providerID })
      const provider = definition.provider

      const connection = yield* integrations.connection.active(
        provider.integrationID ?? Integration.ID.make(providerID),
      )
      const credential = connection
        ? yield* integrations.connection.resolve(connection).pipe(Effect.mapError((error) => failure(error.message)))
        : undefined
      const configuredKey = provider.settings?.apiKey
      const key =
        credential?.type === "key"
          ? credential.key
          : credential?.type === "oauth"
            ? credential.access
            : typeof configuredKey === "string" && configuredKey !== ""
              ? configuredKey
              : undefined

      const baseURL = endpoint(provider)
      if (!baseURL) return yield* failure("the provider has no API base URL")
      const style = authStyle(provider)

      const response = yield* http
        .execute(
          HttpClientRequest.get(`${baseURL}/models`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeaders({ ...provider.headers, ...authHeaders(style, key) }),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Listing)),
          Effect.timeout("15 seconds"),
          Effect.mapError((error) => failure(error.message)),
        )

      const remote = listed(response).filter((model) => !NON_CHAT.test(model.id))
      const added = remote.filter((model) => !known.has(model.id))
      if (added.length === 0) return { added: [], total: remote.length }
      if (!config.addProviderModels) return yield* failure("config updates are unavailable")

      yield* config
        .addProviderModels(
          providerID,
          Object.fromEntries(
            added.map((model) => [
              model.id,
              {
                ...(model.name && model.name !== model.id ? { name: model.name } : {}),
                ...(model.context || model.output
                  ? {
                      limit: {
                        ...(model.context ? { context: model.context } : {}),
                        ...(model.output ? { output: model.output } : {}),
                      },
                    }
                  : {}),
              },
            ]),
          ),
        )
        .pipe(Effect.mapError((error) => failure(error.message)))
      return { added: added.map((model) => model.id), total: remote.length }
    })

    return Service.of({ sync })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Provider.node, Integration.node, Config.node, httpClient],
})

// Embeddings, speech, image, and moderation models share the listing endpoint but cannot drive a chat session.
const NON_CHAT = /embed|whisper|tts|dall-e|moderation|transcribe|realtime|rerank|sora|(^|[-/])image|babbage|davinci/i

const OptionalInt = Schema.optional(Schema.NullOr(Schema.Finite))

// OpenAI-compatible and Anthropic endpoints return `data`; Gemini returns `models` with a `models/` prefix.
const Listing = Schema.Struct({
  data: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.optional(Schema.NullOr(Schema.String)),
        display_name: Schema.optional(Schema.NullOr(Schema.String)),
        context_length: OptionalInt,
        context_window: OptionalInt,
        max_model_len: OptionalInt,
      }),
    ),
  ),
  models: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        displayName: Schema.optional(Schema.String),
        inputTokenLimit: OptionalInt,
        outputTokenLimit: OptionalInt,
        supportedGenerationMethods: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
})

function listed(response: typeof Listing.Type) {
  const openai = (response.data ?? []).map((model) => ({
    id: model.id,
    name: model.display_name ?? model.name ?? undefined,
    context: model.context_length ?? model.context_window ?? model.max_model_len ?? undefined,
    output: undefined,
  }))
  const gemini = (response.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent") ?? true)
    .map((model) => ({
      id: model.name.replace(/^models\//, ""),
      name: model.displayName,
      context: model.inputTokenLimit ?? undefined,
      output: model.outputTokenLimit ?? undefined,
    }))
  return [...openai, ...gemini].filter((model) => model.id.length > 0)
}

// First-party SDK packages carry their endpoint internally, so the catalog leaves these providers without a base URL.
const DEFAULT_BASE_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  cerebras: "https://api.cerebras.ai/v1",
  togetherai: "https://api.together.xyz/v1",
}

function endpoint(provider: Provider.Info) {
  const configured = provider.settings?.baseURL
  const baseURL =
    typeof configured === "string" && configured !== ""
      ? configured
      : DEFAULT_BASE_URL[provider.canonical ?? provider.id]
  if (!baseURL) return undefined
  const resolved = baseURL.replace(/\$\{([^}]+)\}/g, (placeholder, name: string) => process.env[name] ?? placeholder)
  if (resolved.includes("${") || !URL.canParse(resolved)) return undefined
  return resolved.replace(/\/+$/, "")
}

function authStyle(provider: Provider.Info) {
  const name = Provider.packageName(provider.package) ?? ""
  const id = provider.canonical ?? provider.id
  if (name.includes("vertex")) return "bearer"
  if (id === "anthropic" || name.includes("anthropic")) return "anthropic"
  if (id === "google" || name.includes("/google")) return "google"
  return "bearer"
}

function authHeaders(style: ReturnType<typeof authStyle>, key: string | undefined): Record<string, string> {
  if (style === "anthropic")
    return { "anthropic-version": "2023-06-01", ...(key === undefined ? {} : { "x-api-key": key }) }
  if (key === undefined) return {}
  if (style === "google") return { "x-goog-api-key": key }
  return { authorization: `Bearer ${key}` }
}
