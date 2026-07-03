return {
  "stevearc/conform.nvim",
  event = { "BufWritePre" },
  cmd = { "ConformInfo" },
  opts = {
    formatters_by_ft = {
      python = {
        "isort",
        "autopep8",
        "ruff_fix",
      },
    },
    format_on_save = { timeout_ms = 500 },
  },
}
