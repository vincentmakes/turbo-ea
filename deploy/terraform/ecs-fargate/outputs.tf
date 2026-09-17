output "alb_dns_name" {
  description = "Point the public hostname at this (CNAME or Route 53 alias) unless route53_zone_id was set."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "Hosted zone of the load balancer, for an alias record managed elsewhere."
  value       = aws_lb.this.zone_id
}

output "task_security_group_id" {
  description = "Allow the database port from this group when db_security_group_id was not given."
  value       = aws_security_group.task.id
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "efs_file_system_id" {
  description = "The EFS file system holding /app/data (extensions, uploads, transfer bundles)."
  value       = aws_efs_file_system.data.id
}

output "db_endpoint" {
  description = "Endpoint of the created RDS instance; null when the database was brought along."
  value       = var.create_database ? aws_db_instance.this[0].endpoint : null
}

output "db_password_secret_arn" {
  description = "Secrets Manager secret holding the database password."
  value       = aws_secretsmanager_secret.db_password.arn
}

output "secret_key_secret_arn" {
  description = "Secrets Manager secret holding SECRET_KEY. Back it up with the database."
  value       = aws_secretsmanager_secret.secret_key.arn
}
