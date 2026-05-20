-- Parsers are managed by Nix (see nix-darwin/flake.nix).
-- treesitter-context / textobjects 自体は lazy で管理。
return {
  {
    'nvim-treesitter/nvim-treesitter-context',
    event = 'BufReadPost',
    opts = {
      max_lines = 3,
      multiline_threshold = 1,
      trim_scope = 'outer',
    },
    keys = {
      {
        '[c',
        function() require('treesitter-context').go_to_context(vim.v.count1) end,
        desc = 'Jump to context (treesitter)',
      },
    },
  },
  {
    'nvim-treesitter/nvim-treesitter-textobjects',
    branch = 'master', -- nixpkgs の nvim-treesitter (master) と整合
    event = 'BufReadPost',
    config = function()
      require('nvim-treesitter.configs').setup({
        textobjects = {
          select = {
            enable = true,
            lookahead = true,
            keymaps = {
              ['af'] = '@function.outer',
              ['if'] = '@function.inner',
              ['ac'] = '@class.outer',
              ['ic'] = '@class.inner',
              ['ab'] = '@block.outer',
              ['ib'] = '@block.inner',
            },
          },
          move = {
            enable = true,
            set_jumps = true,
            goto_next_start     = { [']m'] = '@function.outer', [']]'] = '@class.outer' },
            goto_next_end       = { [']M'] = '@function.outer', [']['] = '@class.outer' },
            goto_previous_start = { ['[m'] = '@function.outer', ['[['] = '@class.outer' },
            goto_previous_end   = { ['[M'] = '@function.outer', ['[]'] = '@class.outer' },
          },
        },
      })
    end,
  },
}
