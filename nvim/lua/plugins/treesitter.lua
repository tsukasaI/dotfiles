return {
  'nvim-treesitter/nvim-treesitter',
  lazy = false,
  build = ':TSUpdate',
  config = function()
    require('nvim-treesitter').install({ 'rust', 'toml', 'go', 'gomod', 'gowork', 'gosum' })

    vim.api.nvim_create_autocmd('FileType', {
      pattern = { 'rust', 'toml', 'go', 'gomod' },
      callback = function()
				if pcall(vim.treesitter.start) then end
      end,
    })
  end,
}
