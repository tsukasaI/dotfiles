require("config.lazy")

-- リーダーキー
vim.g.mapleader = " "

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

vim.api.nvim_set_hl(0, "Normal", { bg = "none" })
vim.api.nvim_set_hl(0, "NormalFloat", { bg = "none" })
