return {
  cmd = { 'gopls' },
  filetypes = { 'go', 'gomod', 'gowork' },
  -- 順序 = 優先度。go.work を先にしないと最寄りの go.mod が勝ち、ワークスペース内でモジュールごとに client が立つ
  root_markers = { 'go.work', 'go.mod', '.git' },
  settings = {
    gopls = {
      analyses = {
        nilness = true,
        unusedparams = true,
        unusedwrite = true,
      },
      staticcheck = true,
      gofumpt = true,
      semanticTokens = true,
      codelenses = {
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
}
