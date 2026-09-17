output "fqdn" {
  description = "Default FQDN of the app. Set public_url to https://<this> on the first deploy, or bind a custom domain (az containerapp hostname add/bind)."
  value       = azurerm_container_app.this.ingress[0].fqdn
}

output "container_app_name" {
  value = azurerm_container_app.this.name
}

output "environment_name" {
  value = azurerm_container_app_environment.this.name
}

output "environment_id" {
  value = azurerm_container_app_environment.this.id
}

output "custom_domain_verification_id" {
  description = "TXT record value (asuid.<host>) a custom domain must carry before it can be bound."
  value       = azurerm_container_app_environment.this.custom_domain_verification_id
}

output "postgres_fqdn" {
  description = "FQDN of the created Flexible Server; null when the database was brought along."
  value       = var.create_database ? azurerm_postgresql_flexible_server.this[0].fqdn : null
}

output "storage_account_name" {
  description = "Storage account holding the /app/data file share (extensions, uploads, transfer bundles)."
  value       = azurerm_storage_account.data.name
}
