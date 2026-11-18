vim.loader.enable()

-- Before lazy.nvim: mappings defined while loading plugins read it.
vim.g.mapleader = " "

require("config.lazy")

vim.opt.number = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.splitright = true
vim.opt.splitbelow = true
vim.schedule(function()
  vim.opt.clipboard = 'unnamedplus'
end)
vim.opt.mouse = ''
vim.opt.signcolumn = 'yes'
vim.opt.undofile = true
vim.opt.scrolloff = 10
vim.opt.showmode = false        -- lualine shows the mode
vim.opt.updatetime = 250
vim.opt.inccommand = 'split'
vim.opt.breakindent = true
vim.opt.cursorline = true

local function set_transparent()
  local groups = {
    "Normal", "NormalNC", "NormalFloat",
    "SignColumn", "LineNr", "CursorLineNr",
    "StatusLine", "StatusLineNC",
    "EndOfBuffer", "FoldColumn",
    "WinSeparator",
  }
  for _, group in ipairs(groups) do
    vim.api.nvim_set_hl(0, group, { bg = "none" })
  end
  vim.api.nvim_set_hl(0, "CursorLine", { bg = "#3a3a50" })
end
set_transparent()
vim.api.nvim_create_autocmd("ColorScheme", {
  callback = set_transparent,
})

vim.diagnostic.config({
  virtual_text = { current_line = true },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = 'E',
      [vim.diagnostic.severity.WARN]  = 'W',
      [vim.diagnostic.severity.INFO]  = 'I',
      [vim.diagnostic.severity.HINT]  = 'H',
    },
  },
  severity_sort = true,
  underline = true,
  float = { border = 'rounded' },
})
vim.keymap.set('n', '<leader>e', vim.diagnostic.open_float, { desc = 'Show diagnostic' })

vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')
vim.keymap.set('n', '<C-h>', '<C-w><C-h>', { desc = 'Focus left window' })
vim.keymap.set('n', '<C-j>', '<C-w><C-j>', { desc = 'Focus lower window' })
vim.keymap.set('n', '<C-k>', '<C-w><C-k>', { desc = 'Focus upper window' })
vim.keymap.set('n', '<C-l>', '<C-w><C-l>', { desc = 'Focus right window' })
vim.keymap.set('n', '<C-d>', '<C-d>zz')
vim.keymap.set('n', '<C-u>', '<C-u>zz')
vim.keymap.set('x', '<', '<gv')
vim.keymap.set('x', '>', '>gv')
vim.keymap.set('n', '<A-j>', '<cmd>m .+1<cr>==', { desc = 'Move line down' })
vim.keymap.set('n', '<A-k>', '<cmd>m .-2<cr>==', { desc = 'Move line up' })

-- Per-server settings live in nvim/lsp/<name>.lua (auto-loaded since 0.12).
vim.lsp.config('*', {
  capabilities = require('blink.cmp').get_lsp_capabilities(),
})
vim.lsp.enable('gopls')
