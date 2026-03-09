return {
  'saghen/blink.cmp',
  version = '1.*',
  opts = {
    keymap = {
      preset = 'enter',
      ['<Tab>'] = { 'select_next', 'snippet_forward', 'fallback' },
      ['<S-Tab>'] = { 'select_prev', 'snippet_backward', 'fallback' },
      ['<C-space>'] = { 'show', 'show_documentation', 'hide_documentation' },
    },
    sources = {
      default = { 'lsp', 'path' },
    },
  },
  opts_extend = { 'sources.default' },
}
