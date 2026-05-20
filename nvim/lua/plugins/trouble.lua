return {
  'folke/trouble.nvim',
  cmd = 'Trouble',
  opts = {
    focus = true,
  },
  keys = {
    -- リスト性が要る時用。一回限りの絞り込みは fzf-lua (<leader>s*) を使う。
    { '<leader>xx', '<cmd>Trouble diagnostics toggle<cr>',                  desc = 'Trouble: diagnostics' },
    { '<leader>xX', '<cmd>Trouble diagnostics toggle filter.buf=0<cr>',     desc = 'Trouble: buffer diagnostics' },
    { '<leader>xr', '<cmd>Trouble lsp_references toggle focus=false<cr>',   desc = 'Trouble: references' },
    { '<leader>xi', '<cmd>Trouble lsp_implementations toggle<cr>',          desc = 'Trouble: implementations' },
    { '<leader>xs', '<cmd>Trouble symbols toggle focus=false<cr>',          desc = 'Trouble: symbols' },
    { '<leader>xq', '<cmd>Trouble qflist toggle<cr>',                       desc = 'Trouble: quickfix' },
  },
}
