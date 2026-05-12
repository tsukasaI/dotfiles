return {
  {
    'mfussenegger/nvim-dap',
    dependencies = {
      'rcarriga/nvim-dap-ui',
      'nvim-neotest/nvim-nio', -- required by nvim-dap-ui
      'theHamsta/nvim-dap-virtual-text',
    },
    keys = {
      { '<F5>',       function() require('dap').continue() end,                                                    desc = 'DAP: continue / start' },
      { '<F10>',      function() require('dap').step_over() end,                                                   desc = 'DAP: step over' },
      { '<F11>',      function() require('dap').step_into() end,                                                   desc = 'DAP: step into' },
      { '<F12>',      function() require('dap').step_out() end,                                                    desc = 'DAP: step out' },
      { '<leader>b',  function() require('dap').toggle_breakpoint() end,                                           desc = 'DAP: toggle breakpoint' },
      { '<leader>B',  function() require('dap').set_breakpoint(vim.fn.input('Condition: ')) end,                   desc = 'DAP: conditional breakpoint' },
      { '<leader>lp', function() require('dap').set_breakpoint(nil, nil, vim.fn.input('Log point message: ')) end, desc = 'DAP: log point' },
      { '<leader>dr', function() require('dap').repl.open() end,                                                   desc = 'DAP: open REPL' },
      { '<leader>dl', function() require('dap').run_last() end,                                                    desc = 'DAP: run last' },
      { '<leader>dq', function() require('dap').terminate() end,                                                   desc = 'DAP: terminate' },
      { '<leader>du', function() require('dapui').toggle() end,                                                    desc = 'DAP: toggle UI' },
    },
    config = function()
      local dap = require('dap')
      local dapui = require('dapui')

      dapui.setup()
      require('nvim-dap-virtual-text').setup({})

      dap.listeners.before.attach.dapui_config           = function() dapui.open() end
      dap.listeners.before.launch.dapui_config           = function() dapui.open() end
      dap.listeners.before.event_terminated.dapui_config = function() dapui.close() end
      dap.listeners.before.event_exited.dapui_config     = function() dapui.close() end

      vim.fn.sign_define('DapBreakpoint',          { text = 'B', texthl = 'DiagnosticError' })
      vim.fn.sign_define('DapBreakpointCondition', { text = 'C', texthl = 'DiagnosticError' })
      vim.fn.sign_define('DapLogPoint',            { text = 'L', texthl = 'DiagnosticInfo' })
      vim.fn.sign_define('DapStopped',             { text = '▶', texthl = 'DiagnosticWarn', linehl = 'Visual' })
      vim.fn.sign_define('DapBreakpointRejected',  { text = '!', texthl = 'DiagnosticError' })
    end,
  },
}
