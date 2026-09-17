# RDS for PostgreSQL in the private subnets (create_database = true).

resource "aws_db_subnet_group" "this" {
  count = var.create_database ? 1 : 0

  name_prefix = "${var.name}-"
  subnet_ids  = var.private_subnet_ids
}

resource "aws_security_group" "db" {
  count = var.create_database ? 1 : 0

  name_prefix = "${var.name}-db-"
  description = "Turbo EA database"
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_task" {
  count = var.create_database ? 1 : 0

  security_group_id            = aws_security_group.db[0].id
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
  referenced_security_group_id = aws_security_group.task.id
}

resource "aws_db_instance" "this" {
  count = var.create_database ? 1 : 0

  identifier     = var.name
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_user
  password = random_password.db[0].result
  port     = var.db_port

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this[0].name
  vpc_security_group_ids = [aws_security_group.db[0].id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period    = var.db_backup_retention_days
  auto_minor_version_upgrade = true
  apply_immediately          = false
  deletion_protection        = var.db_deletion_protection
  skip_final_snapshot        = var.db_skip_final_snapshot
  final_snapshot_identifier  = var.db_skip_final_snapshot ? null : "${var.name}-final"
}
