return {
	'mrcjkb/rustaceanvim',
	version = '^8',
	lazy = false,
	init = function()
		---@type RustaceanOpts
		vim.g.rustaceanvim = {
			server = {
				default_settings = {
					['rust-analyzer'] = {
						check = {
							command = 'check',
							extraArgs = { '--target-dir', 'target/ra-check' },
						},
						cargo = {
							buildScripts = { enable = true },
						},
						procMacro = { enable = true },
						completion = {
							limit = 30,
						},
						cachePriming = { enable = false },
						lru = { capacity = 64 },
					},
				},
			},
		}
	end,
}
