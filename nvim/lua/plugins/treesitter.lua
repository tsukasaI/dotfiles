return {
  'nvim-treesitter/nvim-treesitter',
  lazy = false,
  build = ':TSUpdate',
  config = function()
    require('nvim-treesitter').install({ 'rust', 'toml' })

    vim.api.nvim_create_autocmd('FileType', {
      pattern = { 'rust', 'toml' },
      callback = function()
				if pcall(vim.treesitter.start) then end
      end,
    })
  end,
}
