return {
  "nvim-telescope/telescope.nvim",
  version = "*",
  dependencies = {
    "nvim-lua/plenary.nvim",
    { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
  },
  keys = {
    { "<leader>sf", "<cmd>Telescope git_files<cr>", desc = "Search git files" },
    { "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Find files" },
    { "<leader>bs", "<cmd>Telescope lsp_document_symbols<cr>", desc = "Buffer symbols" },
    { "<leader>ps", "<cmd>Telescope lsp_workspace_symbols<cr>", desc = "Project symbols" },
    { "<leader>ss", "<cmd>Telescope live_grep<cr>", desc = "Search text in repo" },
    { "<leader><leader>", "<cmd>Telescope buffers<cr>", desc = "Find buffers" },
  },
  config = function()
    require("telescope").setup({
      defaults = {
        layout_strategy = "flex",
        layout_config = {
          flex = {
            flip_columns = 160,
          },
          vertical = {
            preview_cutoff = 20,
            mirror = false,
          },
        },
      },
    })
    require("telescope").load_extension("fzf")
  end,
}