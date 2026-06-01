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
    branch = 'main', -- nixpkgs の nvim-treesitter (main 書き直し版) と整合
    event = 'BufReadPost',
    config = function()
      require('nvim-treesitter-textobjects').setup({
        select = { lookahead = true },
        move = { set_jumps = true },
      })

      local select = require('nvim-treesitter-textobjects.select')
      for lhs, capture in pairs({
        ['af'] = '@function.outer',
        ['if'] = '@function.inner',
        ['ac'] = '@class.outer',
        ['ic'] = '@class.inner',
        ['ab'] = '@block.outer',
        ['ib'] = '@block.inner',
      }) do
        vim.keymap.set({ 'x', 'o' }, lhs, function()
          select.select_textobject(capture, 'textobjects')
        end)
      end

      local move = require('nvim-treesitter-textobjects.move')
      local moves = {
        goto_next_start     = { [']m'] = '@function.outer', [']]'] = '@class.outer' },
        goto_next_end       = { [']M'] = '@function.outer', [']['] = '@class.outer' },
        goto_previous_start = { ['[m'] = '@function.outer', ['[['] = '@class.outer' },
        goto_previous_end   = { ['[M'] = '@function.outer', ['[]'] = '@class.outer' },
      }
      for fn, maps in pairs(moves) do
        for lhs, capture in pairs(maps) do
          vim.keymap.set({ 'n', 'x', 'o' }, lhs, function()
            move[fn](capture, 'textobjects')
          end)
        end
      end
    end,
  },
}
