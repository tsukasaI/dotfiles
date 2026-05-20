return {
  'sindrets/diffview.nvim',
  cmd = { 'DiffviewOpen', 'DiffviewClose', 'DiffviewFileHistory', 'DiffviewRefresh' },
  keys = {
    { '<leader>gd', '<cmd>DiffviewOpen<cr>',            desc = 'Diffview: working tree' },
    { '<leader>gh', '<cmd>DiffviewFileHistory %<cr>',   desc = 'Diffview: current file history' },
    { '<leader>gH', '<cmd>DiffviewFileHistory<cr>',     desc = 'Diffview: repo history' },
    { '<leader>gq', '<cmd>DiffviewClose<cr>',           desc = 'Diffview: close' },
  },
  opts = {},
}
