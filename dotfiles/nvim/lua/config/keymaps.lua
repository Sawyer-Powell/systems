vim.keymap.set("n", "<leader>cp", '<cmd>let @+ = expand("%:p")<cr>', { desc = "Copy file path" })
vim.keymap.set("n", "<leader>cl", function() vim.fn.setreg("+", vim.fn.expand("%:p") .. ":" .. vim.fn.line(".")) end, { desc = "Copy file path:line" })
vim.keymap.set("n", "<leader>ca", "<cmd>ClaudeCodeDiffAccept<cr>", { desc = "Accept Claude Code diff" })
vim.keymap.set("n", "<leader>e", "<cmd>Explore<cr>", { desc = "File explorer" })
vim.keymap.set("n", "<leader>;", "<cmd>only<cr>", { desc = "Close all other panes" })
vim.keymap.set("n", "<leader>d", vim.diagnostic.open_float, { desc = "Line diagnostics" })

-- Exit terminal mode with Escape
vim.keymap.set("t", "<Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })

-- Pane navigation
vim.keymap.set("n", "<leader>h", "<C-w>h", { desc = "Focus left pane" })
vim.keymap.set("n", "<leader>j", "<C-w>j", { desc = "Focus below pane" })
vim.keymap.set("n", "<leader>k", "<C-w>k", { desc = "Focus above pane" })
vim.keymap.set("n", "<leader>l", "<C-w>l", { desc = "Focus right pane" })

-- Pane moving
vim.keymap.set("n", "<leader>H", "<C-w>H", { desc = "Move pane left" })
vim.keymap.set("n", "<leader>J", "<C-w>J", { desc = "Move pane down" })
vim.keymap.set("n", "<leader>K", "<C-w>K", { desc = "Move pane up" })
vim.keymap.set("n", "<leader>L", "<C-w>L", { desc = "Move pane right" })

-- Pane splitting and closing
vim.keymap.set("n", "<leader>.", "<cmd>split<cr>", { desc = "Split vertical" })
vim.keymap.set("n", "<leader>/", "<cmd>vsplit<cr>", { desc = "Split horizontal" })
vim.keymap.set("n", "<leader>w", function()
  if #vim.api.nvim_tabpage_list_wins(0) == 1 then
    vim.cmd("bd")
  else
    vim.cmd("wincmd q")
  end
end, { desc = "Close pane or buffer" })

-- Disable auto-folding in Octo diff views
vim.api.nvim_create_autocmd("BufEnter", {
  pattern = "octo://*",
  command = "if &diff | set nofoldenable | endif",
})

vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    local opts = { buffer = args.buf }
    vim.keymap.set("n", "gd", vim.lsp.buf.definition, vim.tbl_extend("force", opts, { desc = "Go to definition" }))
    vim.keymap.set("n", "gr", "<cmd>Telescope lsp_references<cr>", vim.tbl_extend("force", opts, { desc = "References" }))
    vim.keymap.set("n", "g.", vim.lsp.buf.code_action, vim.tbl_extend("force", opts, { desc = "Code actions" }))
    vim.keymap.set("n", "<leader><Tab>", function() vim.lsp.buf.format({ async = true }) end, vim.tbl_extend("force", opts, { desc = "Format buffer" }))
  end,
})
