return {
  'ThePrimeagen/harpoon',
  branch = 'harpoon2',
  dependencies = { 'nvim-lua/plenary.nvim' },
  opts = {},
  config = function(_, opts)
    require('harpoon'):setup(opts)
  end,
  keys = {
    { '<leader>ha', function() require('harpoon'):list():add() end,                                          desc = 'Harpoon: add file' },
    { '<leader>hh', function() local h = require('harpoon'); h.ui:toggle_quick_menu(h:list()) end,           desc = 'Harpoon: menu' },
    { '<leader>1',  function() require('harpoon'):list():select(1) end,                                      desc = 'Harpoon: slot 1' },
    { '<leader>2',  function() require('harpoon'):list():select(2) end,                                      desc = 'Harpoon: slot 2' },
    { '<leader>3',  function() require('harpoon'):list():select(3) end,                                      desc = 'Harpoon: slot 3' },
    { '<leader>4',  function() require('harpoon'):list():select(4) end,                                      desc = 'Harpoon: slot 4' },
    { '<leader>hn', function() require('harpoon'):list():next() end,                                         desc = 'Harpoon: next' },
    { '<leader>hp', function() require('harpoon'):list():prev() end,                                         desc = 'Harpoon: prev' },
  },
}
