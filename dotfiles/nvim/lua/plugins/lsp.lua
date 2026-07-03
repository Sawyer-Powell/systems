return {
  {
    "mason-org/mason-lspconfig.nvim",
    opts = {
      ensure_installed = { "basedpyright", "ruff", "rust_analyzer", "ts_ls", "svelte" },
    },
    dependencies = {
      { "mason-org/mason.nvim", opts = {} },
      "neovim/nvim-lspconfig",
    },
  },
}
