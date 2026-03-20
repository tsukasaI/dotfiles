return {
  'ibhagwan/fzf-lua',
  dependencies = { 'nvim-tree/nvim-web-devicons' },
  keys = {
    { '<leader>sf', '<cmd>FzfLua files<cr>', desc = 'Search files' },
    { '<leader>sg', '<cmd>FzfLua live_grep<cr>', desc = 'Search by grep' },
    { '<leader>sb', '<cmd>FzfLua buffers<cr>', desc = 'Search buffers' },
    { '<leader>sd', '<cmd>FzfLua diagnostics_document<cr>', desc = 'Search diagnostics' },
    { '<leader><leader>', '<cmd>FzfLua buffers<cr>', desc = 'Find buffers' },
    { '<leader>/', '<cmd>FzfLua grep_curbuf<cr>', desc = 'Search in buffer' },
  },
  opts = {},
}
