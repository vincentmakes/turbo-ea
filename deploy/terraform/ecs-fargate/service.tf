resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
}

locals {
  log_configuration = {
    for c in ["backend", "frontend", "nginx", "mcp-server"] :
    c => {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = var.region
        awslogs-stream-prefix = c
      }
    }
  }

  # One task runs the whole stack as sidecars sharing localhost. Sizes add up
  # to exactly the task size (2048 / 4096) with the MCP server included.
  backend_container = {
    name      = "backend"
    image     = local.images["backend"]
    essential = true
    cpu       = 1024
    memory    = 2048
    environment = [
      for k, v in local.backend_env : { name = k, value = v }
    ]
    secrets = [
      { name = "POSTGRES_PASSWORD", valueFrom = aws_secretsmanager_secret.db_password.arn },
      { name = "SECRET_KEY", valueFrom = aws_secretsmanager_secret.secret_key.arn },
    ]
    mountPoints = [
      { sourceVolume = "data", containerPath = "/app/data", readOnly = false },
    ]
    # Migrations and seeding run before /api/health answers (startPeriod).
    healthCheck = {
      command = [
        "CMD-SHELL",
        "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')\"",
      ]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 300
    }
    logConfiguration = local.log_configuration["backend"]
  }

  frontend_container = {
    name      = "frontend"
    image     = local.images["frontend"]
    essential = true
    cpu       = 256
    memory    = 512
    healthCheck = {
      command  = ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/ >/dev/null"]
      interval = 30
      timeout  = 5
      retries  = 3
    }
    logConfiguration = local.log_configuration["frontend"]
  }

  nginx_container = {
    name      = "nginx"
    image     = local.images["nginx"]
    essential = true
    cpu       = 256
    memory    = 512
    portMappings = [
      { containerPort = 8920, protocol = "tcp" },
    ]
    dependsOn = concat(
      [
        { containerName = "backend", condition = "HEALTHY" },
        { containerName = "frontend", condition = "HEALTHY" },
      ],
      var.deploy_mcp ? [{ containerName = "mcp-server", condition = "HEALTHY" }] : [],
    )
    environment = [
      for k, v in local.nginx_env : { name = k, value = v }
    ]
    healthCheck = {
      command  = ["CMD-SHELL", "wget -qO- http://127.0.0.1:8920/api/health >/dev/null"]
      interval = 30
      timeout  = 5
      retries  = 3
    }
    logConfiguration = local.log_configuration["nginx"]
  }

  mcp_container = {
    name      = "mcp-server"
    image     = local.images["mcp-server"]
    essential = false
    cpu       = 512
    memory    = 1024
    dependsOn = [
      { containerName = "backend", condition = "HEALTHY" },
    ]
    environment = [
      for k, v in local.mcp_env : { name = k, value = v }
    ]
    healthCheck = {
      command = [
        "CMD-SHELL",
        "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health')\"",
      ]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
    logConfiguration = local.log_configuration["mcp-server"]
  }

  container_definitions = concat(
    [local.backend_container, local.frontend_container, local.nginx_container],
    var.deploy_mcp ? [local.mcp_container] : [],
  )
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  cpu                      = "2048"
  memory                   = "4096"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  volume {
    name = "data"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      transit_encryption = "ENABLED"

      authorization_config {
        access_point_id = aws_efs_access_point.data.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode(local.container_definitions)
}

resource "aws_ecs_service" "this" {
  name             = var.name
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.this.arn
  launch_type      = "FARGATE"
  platform_version = "1.4.0"
  desired_count    = 1

  # Stop the running task before starting its replacement: never two
  # backends, never two tasks on the volume. Costs one to two minutes of
  # downtime per deploy.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  enable_execute_command            = true
  health_check_grace_period_seconds = 600

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = "nginx"
    container_port   = 8920
  }

  depends_on = [
    aws_lb_listener.https,
    aws_lb_listener.http,
    aws_efs_mount_target.data,
    aws_iam_role_policy.read_secrets,
    aws_iam_role_policy.task,
  ]
}
