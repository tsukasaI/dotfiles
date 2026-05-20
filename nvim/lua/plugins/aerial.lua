return {
  'stevearc/aerial.nvim',
  cmd = { 'AerialToggle', 'AerialOpen', 'AerialNavToggle' },
  dependencies = { 'nvim-tree/nvim-web-devicons' },
  keys = {
    { '<leader>o', '<cmd>AerialToggle!<cr>', desc = 'Symbol outline (aerial)' },
    { '<leader>O', '<cmd>AerialNavToggle<cr>', desc = 'Aerial nav popup' },
  },
  opts = {
    backends = { 'lsp', 'treesitter', 'markdown' },
    layout = { default_direction = 'right', min_width = 30 },
    show_guides = true,
    -- statusline 連携 (lualine_c に 'aerial' を追加で breadcrumb 化できる)
  },
}
