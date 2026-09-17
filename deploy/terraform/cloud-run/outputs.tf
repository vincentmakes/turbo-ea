output "service_uri" {
  description = "The service's run.app URL (answers 403 while ingress is restricted to the load balancer)."
  value       = google_cloud_run_v2_service.this.uri
}

output "load_balancer_ip" {
  description = "Point the DNS A record of public_url's host at this; null when no load balancer was created."
  value       = var.create_load_balancer ? google_compute_global_address.lb[0].address : null
}

output "cloud_sql_private_ip" {
  description = "Private IP of the created Cloud SQL instance; null when the database was brought along."
  value       = var.create_database ? google_sql_database_instance.this[0].private_ip_address : null
}

output "cloud_sql_connection_name" {
  description = "Connection name of the created Cloud SQL instance (for the Auth Proxy or gcloud sql connect)."
  value       = var.create_database ? google_sql_database_instance.this[0].connection_name : null
}

output "filestore_ip" {
  description = "NFS address of the Filestore instance holding /app/data."
  value       = local.filestore_ip
}

output "service_account_email" {
  value = google_service_account.run.email
}

output "image_repository" {
  description = "Registry path the images are pulled from."
  value       = local.image_repository
}
