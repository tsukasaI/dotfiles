-- リーダーキー (lazy.nvim より前に設定する必要がある)
vim.g.mapleader = " "

require("config.lazy")

-- 基本オプション
vim.opt.number = true           -- 行番号
vim.opt.tabstop = 2             -- タブ幅
vim.opt.shiftwidth = 2          -- インデント幅
vim.opt.expandtab = true        -- スペースに展開
vim.opt.smartindent = true      -- スマートインデント
vim.opt.ignorecase = true       -- 検索時大文字小文字無視
vim.opt.smartcase = true        -- 大文字含むと区別
vim.opt.splitright = true       -- 右に分割
vim.opt.splitbelow = true       -- 下に分割
vim.opt.clipboard = 'unnamedplus'
vim.opt.mouse = ''
vim.opt.signcolumn = 'yes'
vim.opt.undofile = true         -- 永続undo
vim.opt.scrolloff = 10          -- スクロール余白
vim.opt.showmode = false        -- lualineに任せる
vim.opt.updatetime = 250        -- CursorHold高速化
vim.opt.inccommand = 'split'    -- 置換リアルタイムプレビュー
vim.opt.breakindent = true      -- 折り返しインデント維持
vim.opt.cursorline = true

-- Transparent background (let terminal handle opacity)
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

-- Diagnostics
vim.diagnostic.config({
  virtual_text = { current_line = true },
  signs = true,
  underline = true,
  float = { border = 'rounded' },
})
vim.keymap.set('n', '<leader>e', vim.diagnostic.open_float, { desc = 'Show diagnostic' })

-- Keymaps
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

-- LSP
vim.lsp.config('gopls', {
  cmd = { 'gopls' },
  filetypes = { 'go', 'gomod', 'gowork', 'gotmpl' },
  root_markers = { 'go.mod', 'go.work', '.git' },
  settings = {
    gopls = {
      analyses = {
        nilness = true,
        unusedparams = true,
        unusedwrite = true,
        useany = true,
      },
      staticcheck = true,
      gofumpt = true,
      completeUnimported = true,
      semanticTokens = true,
      codelenses = {
        gc_details = true,
        generate = true,
        run_govulncheck = true,
        test = true,
        tidy = true,
      },
      hints = {
        assignVariableTypes = true,
        compositeLiteralFields = true,
        constantValues = true,
        parameterNames = true,
      },
    },
  },
})
vim.lsp.enable('gopls')
