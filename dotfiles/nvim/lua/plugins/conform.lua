return {
  "stevearc/conform.nvim",
  event = { "BufWritePre" },
  cmd = { "ConformInfo" },
  opts = {
    formatters_by_ft = {
      -- ruff_fix applies lint fixes + import sorting, ruff_format formats.
      python = { "ruff_fix", "ruff_format" },
    },
    format_on_save = { timeout_ms = 500 },
  },
}
