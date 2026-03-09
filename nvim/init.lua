-- リーダーキー (lazy.nvim より前に設定する必要がある)
vim.g.mapleader = " "

require("config.lazy")

-- 基本オプション
vim.opt.number = true           -- 行番号
vim.opt.tabstop = 2             -- タブ幅
vim.opt.shiftwidth = 2          -- インデント幅
vim.opt.smartindent = true      -- スマートインデント
vim.opt.smartcase = true        -- 大文字含むと区別
vim.opt.splitright = true       -- 右に分割
vim.opt.splitbelow = true       -- 下に分割
vim.opt.clipboard = 'unnamedplus'
vim.opt.mouse = ''
vim.opt.signcolumn = 'yes'

vim.api.nvim_set_hl(0, "Normal", { bg = "none" })
vim.api.nvim_set_hl(0, "NormalFloat", { bg = "none" })

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
