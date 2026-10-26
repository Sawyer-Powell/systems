vim.keymap.set("n", "<leader>cp", '<cmd>let @+ = expand("%:p")<cr>', { desc = "Copy file path" })
vim.keymap.set("n", "<leader>cl", function() vim.fn.setreg("+", vim.fn.expand("%:p") .. ":" .. vim.fn.line(".")) end, { desc = "Copy file path:line" })
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

vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    local opts = { buffer = args.buf }
    vim.keymap.set("n", "gd", vim.lsp.buf.definition, vim.tbl_extend("force", opts, { desc = "Go to definition" }))
    vim.keymap.set("n", "gr", "<cmd>Telescope lsp_references<cr>", vim.tbl_extend("force", opts, { desc = "References" }))
    vim.keymap.set("n", "g.", vim.lsp.buf.code_action, vim.tbl_extend("force", opts, { desc = "Code actions" }))
    vim.keymap.set("n", "<leader><Tab>", function() vim.lsp.buf.format({ async = true }) end, vim.tbl_extend("force", opts, { desc = "Format buffer" }))
  end,
})

-- Insert a NOTE(agent) comment using the buffer's comment syntax
vim.keymap.set({ "n", "x" }, "<leader>na", function()
  local cs = vim.bo.commentstring
  if cs == "" or not cs:find("%%s") then
    cs = "// %s"
  end
  local marker = "NOTE(agent): "
  local anchor = vim.fn.line(".")
  if vim.fn.mode():find("[vV\22]") then
    anchor = math.min(vim.fn.line("v"), vim.fn.line("."))
  end
  local text = string.format(cs, marker)
  vim.api.nvim_buf_set_lines(0, anchor - 1, anchor - 1, false, { text })
  local at = text:find(marker, 1, true)
  -- Cursor can't rest past EOL in normal mode, so sit on the marker's last
  -- char (the trailing space), start insert, then step right so typed text
  -- lands after the space instead of before it.
  local marker_end = at and (at - 1 + #marker) or #text
  vim.api.nvim_win_set_cursor(0, { anchor, math.max(0, marker_end - 1) })
  vim.cmd("startinsert")
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Right>", true, false, true), "n", false)
end, { desc = "Note to agent" })
