return {
  'ThePrimeagen/harpoon',
  branch = 'harpoon2',
  dependencies = { 'nvim-lua/plenary.nvim' },
  opts = {},
  config = function(_, opts)
    require('harpoon'):setup(opts)
  end,
  keys = function()
    local h = require('harpoon')
    return {
      { '<leader>ha', function() h:list():add() end,                       desc = 'Harpoon: add file' },
      { '<leader>hh', function() h.ui:toggle_quick_menu(h:list()) end,     desc = 'Harpoon: menu' },
      { '<leader>1',  function() h:list():select(1) end,                   desc = 'Harpoon: slot 1' },
      { '<leader>2',  function() h:list():select(2) end,                   desc = 'Harpoon: slot 2' },
      { '<leader>3',  function() h:list():select(3) end,                   desc = 'Harpoon: slot 3' },
      { '<leader>4',  function() h:list():select(4) end,                   desc = 'Harpoon: slot 4' },
      { '<leader>hn', function() h:list():next() end,                      desc = 'Harpoon: next' },
      { '<leader>hp', function() h:list():prev() end,                      desc = 'Harpoon: prev' },
    }
  end,
}
