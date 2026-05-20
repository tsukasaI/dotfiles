return {
  'RRethy/vim-illuminate',
  event = 'BufReadPost',
  config = function()
    require('illuminate').configure({
      providers = { 'lsp', 'treesitter', 'regex' },
      delay = 200,
      filetypes_denylist = { 'aerial', 'trouble', 'harpoon', 'fzf', 'qf' },
    })
    -- ジャンプは LSP の gd / fzf-lua / treesitter-textobjects に任せ、
    -- illuminate は同一シンボルのハイライト責務のみ。
  end,
}
