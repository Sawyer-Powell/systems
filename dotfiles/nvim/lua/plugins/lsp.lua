local function nix_executable(name)
  local nixos_profile = "/etc/profiles/per-user/" .. vim.env.USER .. "/bin/" .. name
  return vim.fn.executable(nixos_profile) == 1 and nixos_profile or vim.fn.expand("~/.nix-profile/bin/" .. name)
end

local rust_analyzer = nix_executable("rust-analyzer")
local basedpyright = nix_executable("basedpyright-langserver")
local gopls = nix_executable("gopls")

return {
  {
    "mason-org/mason-lspconfig.nvim",
    opts = {
      -- Nix provides Rust, Python, and Go language servers.
      ensure_installed = { "ruff", "ts_ls", "svelte" },
      automatic_enable = {
        -- The config callback below enables Nix-built servers instead.
        exclude = { "rust_analyzer", "basedpyright", "gopls" },
      },
    },
    config = function(_, opts)
      require("mason-lspconfig").setup(opts)
      vim.lsp.config("rust_analyzer", { cmd = { rust_analyzer } })
      vim.lsp.config("basedpyright", { cmd = { basedpyright, "--stdio" } })
      vim.lsp.config("gopls", { cmd = { gopls } })

      vim.lsp.enable("rust_analyzer")
      vim.lsp.enable("basedpyright")
      vim.lsp.enable("gopls")
    end,
    dependencies = {
      { "mason-org/mason.nvim", opts = {} },
      "neovim/nvim-lspconfig",
    },
  },
}
