return {
  "pwntester/octo.nvim",
  cmd = "Octo",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim",
    "nvim-tree/nvim-web-devicons",
  },
  opts = {
    use_local_fs = true,
    picker = "telescope",
    enable_builtin = true,
    mappings = {
      notification = {
        read = { lhs = "<leader>r", desc = "mark notification as read" },
        done = { lhs = "<leader>d", desc = "mark notification as done" },
      },
    },
  },
  keys = {
    { "<leader>op", "<cmd>Octo notification list<cr>", desc = "PR notifications" },
    { "<leader>oP", "<cmd>Octo search is:pr is:open reviewed-by:Sawyer-Powell -review:approved<cr>", desc = "PRs I reviewed, not yet approved" },
    { "<leader>oi", "<cmd>Octo issue list<cr>", desc = "List issues" },
    { "<leader>os", "<cmd>Octo search<cr>", desc = "Search GitHub" },
  },
}
