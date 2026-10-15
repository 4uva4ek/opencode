import { Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useSettings } from "@/settings/model"

// Native controls: 14px left inset, two 20px button pitches, and a 14px button.
export const macTrafficLightsBaseWidth = 68

// The toggle's 28px plus a 4px gap before the header contents.
const slotWidth = 32

// The session screen's 8px inset plus the header's 10px start padding.
const sessionHeaderStart = 18

export function SidebarToggle() {
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const keybind = () => command.keybindParts("sidebar.toggle")

  return (
    <Tooltip
      class="shrink-0 [app-region:no-drag]"
      placement="bottom"
      value={
        <>
          {language.t("command.sidebar.toggle")}
          <Show when={keybind().length > 0}>
            <Keybind keys={keybind()} variant="neutral" />
          </Show>
        </>
      }
    >
      <IconButton
        type="button"
        variant="ghost-muted"
        size="large"
        class="shrink-0"
        state={settings.appearance.sidebarOpen() ? "pressed" : undefined}
        onClick={() => settings.appearance.setSidebarOpen(!settings.appearance.sidebarOpen())}
        aria-label={language.t("command.sidebar.toggle")}
        aria-expanded={settings.appearance.sidebarOpen()}
        aria-controls="vertical-tabs-sidebar"
        icon={<Icon name="layout-left" />}
      />
    </Tooltip>
  )
}

// Slides the toggle in from the header's start edge as the sidebar closes, pushing the contents along with it.
// Windows keeps its titlebar in vertical tabs mode, so the toggle lives there instead.
export function SessionHeaderSidebarSlot() {
  const platform = usePlatform()
  const settings = useSettings()
  const desktop = createMediaQuery("(min-width: 768px)")
  const windows = () => platform.platform === "desktop" && platform.os === "windows"
  const mac = () => platform.platform === "desktop" && platform.os === "macos" && !platform.windowFullscreen?.()

  // Keep the toggle clear of the traffic lights, which end 68px from the window edge.
  const width = () =>
    mac() ? macTrafficLightsBaseWidth / (platform.webviewZoom?.() ?? 1) - sessionHeaderStart + slotWidth : slotWidth

  return (
    <Show when={desktop() && !windows() && settings.appearance.tabLayout() === "vertical"}>
      <div
        class="flex shrink-0 justify-end overflow-hidden transition-[width] duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
        style={{ width: settings.appearance.sidebarOpen() ? "0px" : `${width()}px` }}
        inert={settings.appearance.sidebarOpen()}
      >
        <div class="flex shrink-0 pe-1">
          <SidebarToggle />
        </div>
      </div>
    </Show>
  )
}
