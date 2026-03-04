return {
  'saghen/blink.cmp',
  version = '1.*',
  opts = {
    keymap = {
      preset = 'enter',
      ['<C-space>'] = { 'show', 'show_documentation', 'hide_documentation' },
    },
    sources = {
      default = { 'lsp', 'path' },
    },
  },
  opts_extend = { 'sources.default' },
}
