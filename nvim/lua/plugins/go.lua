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
	{
		'leoluz/nvim-dap-go',
		ft = 'go',
		dependencies = { 'mfussenegger/nvim-dap' },
		opts = {},
		keys = {
			{ '<leader>dt', function() require('dap-go').debug_test() end, ft = 'go', desc = 'DAP: debug nearest Go test' },
			{ '<leader>dT', function() require('dap-go').debug_last_test() end, ft = 'go', desc = 'DAP: debug last Go test' },
		},
	},
}
