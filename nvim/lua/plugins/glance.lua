return {
  'dnlhc/glance.nvim',
  cmd = 'Glance',
  keys = {
    -- Not `gd`: it stays Vim's native in-buffer search (issue #27).
    { 'gpd', '<cmd>Glance definitions<cr>',      desc = 'Glance: definitions' },
    { 'gpr', '<cmd>Glance references<cr>',       desc = 'Glance: references' },
    { 'gpi', '<cmd>Glance implementations<cr>',  desc = 'Glance: implementations' },
    { 'gpt', '<cmd>Glance type_definitions<cr>', desc = 'Glance: type defs' },
  },
  opts = {
    height = 18,
    border = { enable = true },
    list = { position = 'right', width = 0.33 },
  },
}
