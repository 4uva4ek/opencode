import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createDesktopNotify } from "./notifications"

const originalNotification = globalThis.Notification

const originalSetAdd = Set.prototype.add

const originalSetDelete = Set.prototype.delete

const retained = new Set<FakeNotification>()

const created: FakeNotification[] = []

const events: string[] = []

class FakeNotification extends EventTarget implements Notification {
  static readonly permission: NotificationPermission = "granted"

  static async requestPermission(): Promise<NotificationPermission> {
    return "granted"
  }

  onclick: ((this: Notification, ev: Event) => void) | null = null
  onclose: ((this: Notification, ev: Event) => void) | null = null
  onerror: ((this: Notification, ev: Event) => void) | null = null
  onshow: ((this: Notification, ev: Event) => void) | null = null

  readonly body: string
  readonly data = null
  readonly dir: NotificationDirection = "auto"
  readonly icon: string
  readonly lang = ""
  readonly silent: boolean | null
  readonly tag = ""
  readonly title: string

  constructor(title: string, options?: NotificationOptions) {
    super()
    this.title = title
    this.body = options?.body ?? ""
    this.icon = options?.icon ?? ""
    this.silent = options?.silent ?? null
    events.push(`created:${title}:${this.body}`)
    created.push(this)
  }

  close() {
    events.push("notification.close")
    this.onclose?.call(this, new Event("close"))
  }
}

beforeEach(() => {
  Set.prototype.add = function (value) {
    if (value instanceof FakeNotification) originalSetAdd.call(retained, value)

    return originalSetAdd.call(this, value)
  }

  Set.prototype.delete = function (value) {
    if (value instanceof FakeNotification) originalSetDelete.call(retained, value)

    return originalSetDelete.call(this, value)
  }
})

afterEach(() => {
  Set.prototype.add = originalSetAdd
  Set.prototype.delete = originalSetDelete
  retained.clear()
  created.length = 0
  events.length = 0
  globalThis.Notification = originalNotification
})

describe("desktop notifications", () => {
  test("retains active Notification in a Set, shows and focuses the window on click, and releases it on close", async () => {
    globalThis.Notification = FakeNotification

    const notify = createDesktopNotify({
      getWindowFocused: async () => false,
      showWindow: async () => {
        events.push("api.showWindow")
      },
      setWindowFocus: async () => {
        events.push("api.setWindowFocus")
      },
    })

    await notify("Response ready", "Refactor auth flow", () => {
      events.push("session.select")
    })

    const notification = created[0]
    expect(notification).toBeDefined()
    expect(notification ? retained.has(notification) : false).toBe(true)

    notification?.onclick?.call(notification, new Event("click"))

    expect(events).toEqual([
      "created:Response ready:Refactor auth flow",
      "api.showWindow",
      "api.setWindowFocus",
      "session.select",
      "notification.close",
    ])
    expect(notification ? retained.has(notification) : true).toBe(false)
    expect(notification?.onclick).toBeNull()
  })

  test.each([{ event: "close" as const }, { event: "error" as const }])(
    "releases the Notification wrapper when $event fires without a click",
    async ({ event }) => {
      globalThis.Notification = FakeNotification

      const notify = createDesktopNotify({
        getWindowFocused: async () => false,
        showWindow: async () => {},
        setWindowFocus: async () => {},
      })

      await notify("Session error")

      const notification = created[0]
      expect(notification).toBeDefined()
      expect(notification ? retained.has(notification) : false).toBe(true)

      if (event === "close") {
        notification?.onclose?.call(notification, new Event("close"))
      } else {
        notification?.onerror?.call(notification, new Event("error"))
      }

      expect(notification ? retained.has(notification) : true).toBe(false)
      expect(notification?.onclick).toBeNull()
      expect(notification?.onclose).toBeNull()
      expect(notification?.onerror).toBeNull()
    },
  )

  test("suppresses desktop notifications while the window is already focused", async () => {
    globalThis.Notification = FakeNotification

    const notify = createDesktopNotify({
      getWindowFocused: async () => true,
      showWindow: async () => {},
      setWindowFocus: async () => {},
    })

    await notify("Response ready", "Active session")
    expect(events).toEqual([])
    expect(created).toEqual([])
  })
})
