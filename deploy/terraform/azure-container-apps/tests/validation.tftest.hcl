mock_provider "azurerm" {}

variables {
  subscription_id     = "00000000-0000-0000-0000-000000000000"
  resource_group_name = "rg-turbo-ea"
  location            = "westeurope"
  public_url          = "https://ea.example.com"
  image_tag           = "2.141.0"
  secret_key          = "0123456789abcdef0123456789abcdef0123456789abcdef"
}

run "byo_without_host" {
  command = plan

  variables {
    create_database = false
    db_password     = "pw"
  }

  expect_failures = [var.db_host]
}

run "delegated_subnet_without_dns_zone" {
  command = plan

  variables {
    postgresql_delegated_subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet/subnets/postgres"
  }

  expect_failures = [var.postgresql_delegated_subnet_id]
}

run "bad_storage_account_name" {
  command = plan

  variables {
    storage_account_name = "Turbo-EA-Data"
  }

  expect_failures = [var.storage_account_name]
}

run "latest_tag" {
  command = plan

  variables {
    image_tag = "latest"
  }

  expect_failures = [var.image_tag]
}

run "bad_backup_retention" {
  command = plan

  variables {
    db_backup_retention_days = 3
  }

  expect_failures = [var.db_backup_retention_days]
}
