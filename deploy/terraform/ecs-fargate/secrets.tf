# The module always owns the two Secrets Manager secrets the task reads —
# whether the database was created here or brought along — so the task
# definition has one shape.

resource "random_password" "db" {
  count = var.create_database ? 1 : 0

  length           = 32
  override_special = "!#$%^&*()-_=+"
}

resource "aws_secretsmanager_secret" "secret_key" {
  name_prefix = "${var.name}/secret-key-"
  description = "Turbo EA SECRET_KEY (HMAC + Fernet)"
}

resource "aws_secretsmanager_secret_version" "secret_key" {
  secret_id     = aws_secretsmanager_secret.secret_key.id
  secret_string = var.secret_key
}

resource "aws_secretsmanager_secret" "db_password" {
  name_prefix = "${var.name}/db-password-"
  description = "Turbo EA PostgreSQL password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = local.db_password
}
