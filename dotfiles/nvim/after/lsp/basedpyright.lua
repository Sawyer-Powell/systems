---@type vim.lsp.Config
return {
  settings = {
    basedpyright = {
      analysis = {
        autoSearchPaths = true,
        diagnosticMode = "openFilesOnly",
        typeCheckingMode = "standard",
      },
    },
  },
  before_init = function(_, config)
    local venv = config.root_dir .. "/opt/python"
    local stat = (vim.uv or vim.loop).fs_stat(venv)
    if stat then
      config.settings.python = {
        pythonPath = venv .. "/bin/python",
        venvPath = config.root_dir .. "/opt",
        venv = "python",
      }
    end
  end,
}
