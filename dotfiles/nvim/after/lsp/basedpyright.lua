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
  -- Monorepos (uv workspaces) nest a pyproject.toml/setup.py in every package,
  -- so the default markers root the server at e.g. py/data_ingress, where the
  -- repo-level venv is invisible and sibling packages don't resolve. Prefer the
  -- directory that owns a .venv, then fall back to the lspconfig defaults.
  root_dir = function(bufnr, on_dir)
    on_dir(vim.fs.root(bufnr, { ".venv" }) or vim.fs.root(bufnr, {
      "pyrightconfig.json",
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
      ".git",
    }))
  end,
  before_init = function(_, config)
    local root = config.root_dir
    local uv = vim.uv or vim.loop
    -- { venv dir, venvPath, venv name }
    local candidates = {
      { root .. "/.venv", root, ".venv" },
      { root .. "/opt/python", root .. "/opt", "python" },
    }
    for _, c in ipairs(candidates) do
      if uv.fs_stat(c[1]) then
        config.settings.python = { pythonPath = c[1] .. "/bin/python", venvPath = c[2], venv = c[3] }
        return
      end
    end
  end,
}
