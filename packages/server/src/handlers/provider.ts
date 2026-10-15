import { Provider } from "@opencode/core/provider"
import { ProviderSync } from "@opencode/core/provider-sync"
import { ProviderNotFoundError, ProviderSyncError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const providers = yield* Provider.Service
          return yield* response(providers.available())
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const providers = yield* Provider.Service
          const provider = yield* providers.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          return yield* response(Effect.succeed(provider))
        }),
      )
      .handle(
        "provider.sync",
        Effect.fn(function* (ctx) {
          const sync = yield* ProviderSync.Service
          return yield* response(
            sync.sync(ctx.params.providerID).pipe(
              Effect.catchTags({
                "ProviderSync.NotFound": (error) =>
                  Effect.fail(new ProviderNotFoundError({ providerID: error.providerID, message: error.message })),
                "ProviderSync.Request": (error) =>
                  Effect.fail(new ProviderSyncError({ providerID: error.providerID, message: error.detail })),
              }),
            ),
          )
        }),
      )
  }),
)
