return {
	{
		'neovim/nvim-lspconfig',
		ft = { 'go', 'gomod' },
		config = function()
			require('lspconfig').gopls.setup({
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
		end,
	},

	{
		'stevearc/conform.nvim',
		ft = 'go',
		opts = {
			formatters_by_ft = {
				go = { 'goimports', 'gofumpt' },
			},
			format_on_save = {
				timeout_ms = 3000,
				lsp_format = 'fallback',
			},
		},
	},
}
