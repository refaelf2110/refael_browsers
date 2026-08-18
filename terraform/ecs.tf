# ── CloudWatch Log Groups ─────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "refael_linux_task" {
  name              = "/ecs/refael-linux-task"
  retention_in_days = 30

  tags = {
    Name = "refael-linux-task-logs"
  }
}

resource "aws_cloudwatch_log_group" "refael_windows_task" {
  name              = "/ecs/refael-windows-task"
  retention_in_days = 30

  tags = {
    Name = "refael-windows-task-logs"
  }
}

# ── ECS Cluster ───────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "refael" {
  name = "refael-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "refael-cluster"
  }
}

# ── Linux Fargate Task Definition ─────────────────────────────────────────────

resource "aws_ecs_task_definition" "refael_linux" {
  family                   = "refael-linux-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_linux_cpu)
  memory                   = tostring(var.ecs_linux_memory)
  execution_role_arn       = aws_iam_role.refael_ecs_execution.arn
  task_role_arn            = aws_iam_role.refael_ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name  = "refael-linux"
      image = "${aws_ecr_repository.refael_linux.repository_url}:latest"

      essential = true

      environment = [
        {
          name  = "BROWSERS_CACHE_BUCKET"
          value = aws_s3_bucket.refael_browsers_cache.id
        },
        {
          name  = "BROWSERS_CACHE_LINUX_PREFIX"
          value = "linux/"
        },
        {
          name  = "RESULTS_BUCKET"
          value = aws_s3_bucket.refael_results.id
        },
        {
          name  = "RESULTS_RUNS_PREFIX"
          value = "runs/"
        },
        {
          name  = "RESULTS_RESULTS_PREFIX"
          value = "results/"
        },
        {
          name  = "RESULTS_WINDOW_ELEMENTS_PREFIX"
          value = "window_elements/"
        },
        {
          name  = "RESULTS_INTERCEPTION_SESSIONS_PREFIX"
          value = "interception_sessions/"
        },
        {
          name  = "RESULTS_INTERCEPTIONS_PREFIX"
          value = "interceptions/"
        },
        {
          name  = "RUN_MODE"
          value = ""
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.refael_linux_task.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = {
    Name = "refael-linux-task"
  }
}

# ── Windows Fargate Task Definition ──────────────────────────────────────────
# platform_version must be "1.0.0" for Windows Fargate (LATEST is Linux-only).

resource "aws_ecs_task_definition" "refael_windows" {
  family                   = "refael-windows-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_windows_cpu)
  memory                   = tostring(var.ecs_windows_memory)
  execution_role_arn       = aws_iam_role.refael_ecs_execution.arn
  task_role_arn            = aws_iam_role.refael_ecs_task.arn

  runtime_platform {
    # Windows Server 2022 Full (Desktop Experience) — includes WinRT COM classes
    # required by Chromium/Edge renderer subprocesses.
    operating_system_family = "WINDOWS_SERVER_2022_FULL"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name  = "refael-windows"
      image = "${aws_ecr_repository.refael_windows.repository_url}:latest"

      essential = true

      environment = [
        {
          name  = "BROWSERS_CACHE_BUCKET"
          value = aws_s3_bucket.refael_browsers_cache.id
        },
        {
          name  = "BROWSERS_CACHE_WINDOWS_PREFIX"
          value = "windows/"
        },
        {
          name  = "RESULTS_BUCKET"
          value = aws_s3_bucket.refael_results.id
        },
        {
          name  = "RESULTS_RUNS_PREFIX"
          value = "runs/"
        },
        {
          name  = "RESULTS_RESULTS_PREFIX"
          value = "results/"
        },
        {
          name  = "RESULTS_WINDOW_ELEMENTS_PREFIX"
          value = "window_elements/"
        },
        {
          name  = "RESULTS_INTERCEPTION_SESSIONS_PREFIX"
          value = "interception_sessions/"
        },
        {
          name  = "RESULTS_INTERCEPTIONS_PREFIX"
          value = "interceptions/"
        },
        {
          name  = "RUN_MODE"
          value = ""
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.refael_windows_task.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = {
    Name = "refael-windows-task"
  }
}
