# Offline tests: the aws provider is mocked (real schema, invented values), so
# these prove the wiring the guide depends on — one backend, the edge on 8920,
# secrets by reference, the data volume — not that AWS would accept the plan.

mock_provider "aws" {
  # The provider validates ARN-shaped arguments even against mocked values,
  # so the resources other resources reference by ARN get plausible ones.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:mock-AbCdEf" }
  }
  mock_resource "aws_efs_file_system" {
    defaults = { arn = "arn:aws:elasticfilesystem:eu-west-1:123456789012:file-system/fs-0123456789abcdef0" }
  }
  mock_resource "aws_efs_access_point" {
    defaults = { arn = "arn:aws:elasticfilesystem:eu-west-1:123456789012:access-point/fsap-0123456789abcdef0" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/mock/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/mock/0123456789abcdef" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:eu-west-1:123456789012:cluster/mock" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:eu-west-1:123456789012:task-definition/mock:1" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/ecs/mock" }
  }
}

variables {
  region             = "eu-west-1"
  public_url         = "https://ea.example.com"
  image_tag          = "2.141.0"
  secret_key         = "0123456789abcdef0123456789abcdef0123456789abcdef"
  vpc_id             = "vpc-0123456789abcdef0"
  public_subnet_ids  = ["subnet-0aaaaaaaaaaaaaaa1", "subnet-0aaaaaaaaaaaaaaa2"]
  private_subnet_ids = ["subnet-0bbbbbbbbbbbbbbb1", "subnet-0bbbbbbbbbbbbbbb2"]
  certificate_arn    = "arn:aws:acm:eu-west-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
}

run "defaults" {
  assert {
    condition     = length(aws_db_instance.this) == 1
    error_message = "the database is created by default"
  }

  assert {
    condition     = aws_ecs_service.this.desired_count == 1 && aws_ecs_service.this.deployment_minimum_healthy_percent == 0 && aws_ecs_service.this.deployment_maximum_percent == 100
    error_message = "exactly one task, replaced stop-then-start"
  }

  assert {
    condition     = aws_ecs_service.this.platform_version == "1.4.0" && aws_ecs_service.this.enable_execute_command
    error_message = "Fargate 1.4.0 (EFS) with ECS Exec"
  }

  assert {
    condition     = aws_lb.this.idle_timeout == 4000
    error_message = "the event stream needs the maximum ALB idle timeout"
  }

  assert {
    condition     = aws_lb_target_group.this.health_check[0].path == "/api/health" && aws_lb_target_group.this.port == 8920
    error_message = "the target group must probe the edge nginx on 8920"
  }

  assert {
    condition     = aws_efs_access_point.data.posix_user[0].uid == 1000 && aws_efs_access_point.data.root_directory[0].creation_info[0].owner_gid == 1000
    error_message = "the volume must be owned by 1000:1000"
  }

  assert {
    condition     = [for v in aws_ecs_task_definition.this.volume : v.efs_volume_configuration[0].authorization_config[0].iam][0] == "ENABLED"
    error_message = "EFS access goes through the access point with IAM"
  }

  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.this.container_definitions)) == 3
    error_message = "backend, frontend and nginx by default"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.name if try(length(c.portMappings), 0) > 0] == ["nginx"]
    error_message = "only the edge nginx exposes a port"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.portMappings[0].containerPort if c.name == "nginx"][0] == 8920
    error_message = "the edge nginx listens on 8920"
  }

  assert {
    condition = {
      for e in [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.environment if c.name == "nginx"][0] : e.name => e.value
      } == {
      NGINX_HTTP_PORT                = "8920"
      NGINX_BACKEND_UPSTREAM         = "http://127.0.0.1:8000"
      NGINX_FRONTEND_UPSTREAM        = "http://127.0.0.1:8080"
      NGINX_MCP_UPSTREAM             = "http://127.0.0.1:8001"
      TURBO_EA_TLS_ENABLED           = "false"
      TURBO_EA_PUBLIC_URL            = "https://ea.example.com"
      TURBO_EA_EMBED_ALLOWED_ORIGINS = ""
    }
    error_message = "the edge nginx environment must match deploy/ecs-fargate/template.yaml"
  }

  assert {
    condition = [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.dependsOn if c.name == "nginx"][0] == [
      { containerName = "backend", condition = "HEALTHY" },
      { containerName = "frontend", condition = "HEALTHY" },
    ]
    error_message = "nginx starts only once the backend and the frontend are healthy"
  }

  assert {
    condition = [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.secrets if c.name == "backend"][0] == [
      { name = "POSTGRES_PASSWORD", valueFrom = aws_secretsmanager_secret.db_password.arn },
      { name = "SECRET_KEY", valueFrom = aws_secretsmanager_secret.secret_key.arn },
    ]
    error_message = "the backend reads both secrets from Secrets Manager"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.mountPoints[0].containerPath if c.name == "backend"][0] == "/app/data"
    error_message = "the backend mounts the data volume at /app/data"
  }

  assert {
    condition = {
      for e in [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.environment if c.name == "backend"][0] : e.name => e.value
    }["ALLOWED_ORIGINS"] == "https://ea.example.com"
    error_message = "ALLOWED_ORIGINS defaults to the public origin"
  }

  assert {
    condition     = sum([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.cpu]) <= 2048 && sum([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.memory]) <= 4096
    error_message = "container sizes must fit the task size"
  }

  assert {
    condition     = length(aws_route53_record.alias) == 0 && length(aws_vpc_security_group_ingress_rule.byo_db) == 0
    error_message = "no DNS record and no bring-your-own rule by default"
  }
}

run "mcp" {
  variables {
    deploy_mcp = true
  }

  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.this.container_definitions)) == 4
    error_message = "the MCP server is a fourth sidecar"
  }

  assert {
    condition     = length([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.dependsOn if c.name == "nginx"][0]) == 3
    error_message = "nginx also waits for the MCP server"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.essential if c.name == "mcp-server"][0] == false
    error_message = "the MCP server is not essential"
  }

  assert {
    condition = {
      for e in [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.environment if c.name == "mcp-server"][0] : e.name => e.value
    }["MCP_PUBLIC_URL"] == "https://ea.example.com/mcp"
    error_message = "the MCP server is published under /mcp"
  }

  assert {
    condition     = sum([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.cpu]) == 2048 && sum([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.memory]) == 4096
    error_message = "with the MCP server the containers fill the task exactly"
  }
}

run "byo_database" {
  variables {
    create_database      = false
    db_host              = "db.internal"
    db_password          = "correct horse battery staple"
    db_security_group_id = "sg-0123456789abcdef0"
    route53_zone_id      = "Z0123456789ABCDEFGHIJ"
  }

  assert {
    condition     = length(aws_db_instance.this) == 0 && length(aws_db_subnet_group.this) == 0 && length(aws_security_group.db) == 0
    error_message = "no database resources when bringing your own"
  }

  assert {
    condition = {
      for e in [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.environment if c.name == "backend"][0] : e.name => e.value
    }["POSTGRES_HOST"] == "db.internal"
    error_message = "the backend points at the given host"
  }

  assert {
    condition     = nonsensitive(aws_secretsmanager_secret_version.db_password.secret_string) == "correct horse battery staple"
    error_message = "the given password lands in the module-owned secret"
  }

  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.byo_db) == 1 && aws_vpc_security_group_ingress_rule.byo_db[0].from_port == 5432
    error_message = "the database security group is opened from the task"
  }

  assert {
    condition     = length(aws_route53_record.alias) == 1 && aws_route53_record.alias[0].name == "ea.example.com"
    error_message = "the alias record carries the host of public_url"
  }
}
