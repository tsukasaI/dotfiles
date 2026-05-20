return {
  'folke/todo-comments.nvim',
  event = 'BufReadPost',
  dependencies = { 'nvim-lua/plenary.nvim' },
  opts = {
    signs = false, -- signcolumn を圧迫しない
    highlight = {
      pattern = [[.*<(KEYWORDS)\s*:]], -- `// TODO(owner): ...` も拾う
      keyword = 'wide',
      multiline = false,
    },
  },
  keys = {
    { '<leader>st', '<cmd>TodoFzfLua<cr>',                desc = 'Search TODOs' },
    { ']t', function() require('todo-comments').jump_next() end, desc = 'Next TODO' },
    { '[t', function() require('todo-comments').jump_prev() end, desc = 'Prev TODO' },
  },
}
