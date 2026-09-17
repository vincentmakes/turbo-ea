output "release_name" {
  value = helm_release.this.name
}

output "namespace" {
  value = helm_release.this.namespace
}

output "chart_version" {
  value = helm_release.this.version
}

output "status" {
  description = "Helm release status (deployed, failed…)."
  value       = helm_release.this.status
}

output "secret_name" {
  description = "The Secret the backend reads SECRET_KEY and POSTGRES_PASSWORD from. Back SECRET_KEY up with the database."
  value       = local.secret_name
}

output "nginx_service_name" {
  description = "The edge nginx Service, e.g. for `kubectl port-forward svc/<this> 8080:80` before an Ingress exists."
  value       = "${var.release_name}-nginx"
}
