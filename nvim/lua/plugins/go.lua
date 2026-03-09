return {
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
