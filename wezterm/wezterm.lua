local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Appearance
config.color_scheme = "GitHub Dark"
config.window_background_opacity = 0.8
config.window_decorations = "RESIZE"
config.window_padding = { left = 2, right = 2, top = 2, bottom = 2 }

-- Font
config.font = wezterm.font_with_fallback({
  "BlexMono Nerd Font",
  "PlemolJP Console NF",
})
config.font_size = 12.0

-- Cursor
config.default_cursor_style = "SteadyBar"

-- Tab bar
config.hide_tab_bar_if_only_one_tab = true
config.show_new_tab_button_in_tab_bar = false

-- IME
config.use_ime = true
config.macos_forward_to_ime_modifier_mask = "SHIFT|CTRL"

-- Keyboard
config.enable_kitty_keyboard = true

-- Misc
config.automatically_reload_config = true

return config
