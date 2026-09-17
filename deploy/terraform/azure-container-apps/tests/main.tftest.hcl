# Offline tests: the azurerm provider is mocked (real schema, invented
# values), so these prove the wiring the guide depends on — one replica, the
# edge on 8920, secrets by reference, the Azure Files volume owned by
# 1000:1000 — not that Azure would accept the plan.

mock_provider "azurerm" {
  mock_resource "azurerm_container_app_environment" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/mock" }
  }
  mock_resource "azurerm_log_analytics_workspace" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/mock" }
  }
  mock_resource "azurerm_storage_account" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/mock" }
  }
  mock_resource "azurerm_postgresql_flexible_server" {
    defaults = {
      id   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.DBforPostgreSQL/flexibleServers/mock"
      fqdn = "mock.postgres.database.azure.com"
    }
  }
}

variables {
  subscription_id     = "00000000-0000-0000-0000-000000000000"
  resource_group_name = "rg-turbo-ea"
  location            = "westeurope"
  public_url          = "https://ea.example.com"
  image_tag           = "2.141.0"
  secret_key          = "0123456789abcdef0123456789abcdef0123456789abcdef"
}

run "defaults" {
  assert {
    condition     = length(azurerm_postgresql_flexible_server.this) == 1 && length(azurerm_postgresql_flexible_server_database.this) == 1
    error_message = "the database is created by default"
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.this[0].public_network_access_enabled == true && length(azurerm_postgresql_flexible_server_firewall_rule.azure_services) == 1
    error_message = "without a delegated subnet the server has a public endpoint restricted to Azure services"
  }

  assert {
    condition     = azurerm_container_app_environment.this.logs_destination == "log-analytics"
    error_message = "container logs go to the workspace"
  }

  assert {
    condition     = azurerm_container_app.this.revision_mode == "Single" && azurerm_container_app.this.template[0].min_replicas == 1 && azurerm_container_app.this.template[0].max_replicas == 1
    error_message = "exactly one replica, never scaled to zero"
  }

  assert {
    condition     = azurerm_container_app.this.ingress[0].target_port == 8920 && azurerm_container_app.this.ingress[0].external_enabled
    error_message = "external ingress reaches the edge nginx on 8920"
  }

  assert {
    condition     = [for c in azurerm_container_app.this.template[0].container : c.name] == ["backend", "frontend", "nginx"]
    error_message = "backend, frontend and nginx by default"
  }

  assert {
    condition = {
      for e in [for c in azurerm_container_app.this.template[0].container : c.env if c.name == "nginx"][0] : e.name => e.value
      } == {
      NGINX_HTTP_PORT                = "8920"
      NGINX_BACKEND_UPSTREAM         = "http://127.0.0.1:8000"
      NGINX_FRONTEND_UPSTREAM        = "http://127.0.0.1:8080"
      NGINX_MCP_UPSTREAM             = "http://127.0.0.1:8001"
      TURBO_EA_TLS_ENABLED           = "false"
      TURBO_EA_PUBLIC_URL            = "https://ea.example.com"
      TURBO_EA_EMBED_ALLOWED_ORIGINS = ""
    }
    error_message = "the edge nginx environment must match deploy/azure-container-apps/main.bicep"
  }

  assert {
    condition = {
      for e in [for c in azurerm_container_app.this.template[0].container : c.env if c.name == "backend"][0] : e.name => e.secret_name if e.secret_name != null
    } == { POSTGRES_PASSWORD = "postgres-password", SECRET_KEY = "secret-key" }
    error_message = "the backend reads both secrets by reference"
  }

  assert {
    condition = {
      for e in [for c in azurerm_container_app.this.template[0].container : c.env if c.name == "backend"][0] : e.name => e.value if e.value != null
    }["POSTGRES_HOST"] == "mock.postgres.database.azure.com"
    error_message = "the backend points at the created server"
  }

  assert {
    condition     = sort([for s in azurerm_container_app.this.secret : s.name]) == tolist(["postgres-password", "secret-key"])
    error_message = "both secrets exist on the app"
  }

  assert {
    condition     = alltrue([for c in azurerm_container_app.this.template[0].container : c.startup_probe[0].failure_count_threshold <= 10])
    error_message = "Container Apps caps the startup failure threshold at 10"
  }

  assert {
    condition     = [for c in azurerm_container_app.this.template[0].container : c.volume_mounts[0].path if c.name == "backend"][0] == "/app/data"
    error_message = "the backend mounts the data volume at /app/data"
  }

  assert {
    condition     = azurerm_container_app.this.template[0].volume[0].storage_type == "AzureFile" && azurerm_container_app.this.template[0].volume[0].mount_options == "dir_mode=0777,file_mode=0777,uid=1000,gid=1000,mfsymlinks,nobrl,cache=none"
    error_message = "the Azure Files volume is mounted as 1000:1000"
  }

  assert {
    condition     = azurerm_container_app_environment_storage.data.access_mode == "ReadWrite" && azurerm_storage_share.data.name == "turbo-ea-data"
    error_message = "the environment storage links the file share read-write"
  }

  assert {
    condition     = azurerm_storage_account.data.name == "turboeadata"
    error_message = "the storage account name is derived from name"
  }

  assert {
    condition     = length(azurerm_management_lock.db) == 1 && length(azurerm_management_lock.storage) == 1 && azurerm_management_lock.db[0].lock_level == "CanNotDelete"
    error_message = "the server and the storage account are locked against deletion by default"
  }
}

run "private_database" {
  variables {
    postgresql_delegated_subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet/subnets/postgres"
    postgresql_private_dns_zone_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-net/providers/Microsoft.Network/privateDnsZones/turbo-ea.postgres.database.azure.com"
    infrastructure_subnet_id       = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet/subnets/aca"
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.this[0].public_network_access_enabled == false && length(azurerm_postgresql_flexible_server_firewall_rule.azure_services) == 0
    error_message = "private access disables the public endpoint"
  }

  assert {
    condition     = azurerm_container_app_environment.this.infrastructure_subnet_id != null
    error_message = "the environment joins the VNet"
  }
}

run "mcp" {
  variables {
    deploy_mcp = true
  }

  assert {
    condition     = [for c in azurerm_container_app.this.template[0].container : c.name] == ["backend", "frontend", "nginx", "mcp-server"]
    error_message = "the MCP server is a fourth sidecar"
  }

  assert {
    condition = {
      for e in [for c in azurerm_container_app.this.template[0].container : c.env if c.name == "mcp-server"][0] : e.name => e.value
    }["MCP_PUBLIC_URL"] == "https://ea.example.com/mcp"
    error_message = "the MCP server is published under /mcp"
  }
}

run "byo_database" {
  variables {
    create_database = false
    db_host         = "db.internal"
    db_password     = "correct horse battery staple"
  }

  assert {
    condition     = length(azurerm_postgresql_flexible_server.this) == 0 && length(azurerm_postgresql_flexible_server_firewall_rule.azure_services) == 0 && length(azurerm_management_lock.db) == 0
    error_message = "no database resources when bringing your own"
  }

  assert {
    condition = {
      for e in [for c in azurerm_container_app.this.template[0].container : c.env if c.name == "backend"][0] : e.name => e.value if e.value != null
    }["POSTGRES_HOST"] == "db.internal"
    error_message = "the backend points at the given host"
  }

  assert {
    condition     = [for s in azurerm_container_app.this.secret : nonsensitive(s.value) if s.name == "postgres-password"][0] == "correct horse battery staple"
    error_message = "the given password lands in the app secret"
  }
}
