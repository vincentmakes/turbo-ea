# Azure Files share for /app/data (installed extensions, uploads, transfer
# bundles). SMB permissions are fixed at mount time, hence uid/gid 1000 in the
# volume's mount options — the user every Turbo EA image runs as.

resource "azurerm_storage_account" "data" {
  name                     = local.storage_account_name
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = var.tags
}

resource "azurerm_storage_share" "data" {
  name               = var.file_share_name
  storage_account_id = azurerm_storage_account.data.id
  quota              = var.file_share_quota_gb
}

resource "azurerm_container_app_environment_storage" "data" {
  name                         = "data"
  container_app_environment_id = azurerm_container_app_environment.this.id
  account_name                 = azurerm_storage_account.data.name
  share_name                   = azurerm_storage_share.data.name
  access_key                   = azurerm_storage_account.data.primary_access_key
  access_mode                  = "ReadWrite"
}

resource "azurerm_management_lock" "storage" {
  count = var.storage_deletion_protection ? 1 : 0

  name       = "turbo-ea-data"
  scope      = azurerm_storage_account.data.id
  lock_level = "CanNotDelete"
  notes      = "Holds Turbo EA's /app/data (extensions, uploads, transfer bundles)"
}
