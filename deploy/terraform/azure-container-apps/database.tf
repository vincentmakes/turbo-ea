# Azure Database for PostgreSQL Flexible Server (create_database = true).
# Private access (delegated subnet + private DNS zone) when both inputs are
# given, the public endpoint restricted to Azure services otherwise.

resource "random_password" "db" {
  count = var.create_database ? 1 : 0

  length           = 32
  override_special = "!#$%^&*()-_=+"
}

resource "azurerm_postgresql_flexible_server" "this" {
  count = var.create_database ? 1 : 0

  name                = local.postgresql_server_name
  resource_group_name = var.resource_group_name
  location            = var.location
  version             = var.postgresql_version
  sku_name            = var.postgresql_sku_name
  storage_mb          = var.postgresql_storage_mb
  zone                = var.postgresql_zone

  administrator_login    = var.db_user
  administrator_password = random_password.db[0].result

  backup_retention_days = var.db_backup_retention_days

  delegated_subnet_id           = var.postgresql_delegated_subnet_id
  private_dns_zone_id           = var.postgresql_private_dns_zone_id
  public_network_access_enabled = !local.postgresql_private

  tags = var.tags

  lifecycle {
    # Azure picks a zone (and a standby zone) when none was asked for.
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  count = var.create_database ? 1 : 0

  name      = var.db_name
  server_id = azurerm_postgresql_flexible_server.this[0].id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Public endpoint: only Azure-internal traffic (the Container Apps
# environment) may reach the server.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  count = var.create_database && !local.postgresql_private ? 1 : 0

  name             = "azure-services"
  server_id        = azurerm_postgresql_flexible_server.this[0].id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Azure has no deletion-protection flag on a Flexible Server; a resource lock
# is the equivalent. Terraform removes it before destroying the server.
resource "azurerm_management_lock" "db" {
  count = var.create_database && var.db_deletion_protection ? 1 : 0

  name       = "turbo-ea-data"
  scope      = azurerm_postgresql_flexible_server.this[0].id
  lock_level = "CanNotDelete"
  notes      = "Holds the Turbo EA database"
}
