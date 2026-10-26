-- All language servers come from the Nix profile (no mason).
local function nix_executable(name)
  local nixos_profile = "/etc/profiles/per-user/" .. vim.env.USER .. "/bin/" .. name
  return vim.fn.executable(nixos_profile) == 1 and nixos_profile or vim.fn.expand("~/.nix-profile/bin/" .. name)
end

return {
  "neovim/nvim-lspconfig",
  config = function()
    -- Servers whose binary name differs from the LSP config name, or that
    -- must be pinned to the Nix-provided build.
    vim.lsp.config("rust_analyzer", { cmd = { nix_executable("rust-analyzer") } })
    vim.lsp.config("basedpyright", { cmd = { nix_executable("basedpyright-langserver"), "--stdio" } })
    vim.lsp.config("gopls", { cmd = { nix_executable("gopls") } })

    vim.lsp.enable({
      "rust_analyzer",
      "basedpyright",
      "ruff",
      "gopls",
      "ts_ls",
      "svelte",
    })
  end,
}
