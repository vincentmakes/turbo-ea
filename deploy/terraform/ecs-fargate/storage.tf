# Persistent /app/data: installed extensions, uploads, transfer bundles.

resource "aws_efs_file_system" "data" {
  encrypted       = true
  throughput_mode = "elastic"

  tags = { Name = "${var.name}-data" }
}

resource "aws_efs_backup_policy" "data" {
  file_system_id = aws_efs_file_system.data.id

  backup_policy {
    status = "ENABLED"
  }
}

resource "aws_efs_mount_target" "data" {
  for_each = toset(slice(var.private_subnet_ids, 0, 2))

  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

# Every Turbo EA image runs as uid/gid 1000; the access point enforces it.
resource "aws_efs_access_point" "data" {
  file_system_id = aws_efs_file_system.data.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/turbo-ea"

    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0755"
    }
  }

  tags = { Name = "${var.name}-data" }
}
