return {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    config = function()
      -- Install parsers
      require("nvim-treesitter").install({ "rust", "typescript", "javascript", "svelte", "html", "css" })

      -- Enable treesitter highlighting for all buffers
      vim.api.nvim_create_autocmd("FileType", {
        callback = function(args)
          pcall(vim.treesitter.start, args.buf)
        end,
      })
    end,
  },
}
