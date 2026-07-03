---@type vim.lsp.Config
return {
  on_attach = function(client)
    -- Disable hover in favor of basedpyright
    client.server_capabilities.hoverProvider = false
  end,
}
