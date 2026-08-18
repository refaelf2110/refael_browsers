# ── IAM: job-runner role ──────────────────────────────────────────────────────

resource "aws_iam_role" "refael_job_runner" {
  name               = "refael-job-runner-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Name = "refael-job-runner-role"
  }
}

resource "aws_iam_role_policy_attachment" "refael_job_runner_basic" {
  role       = aws_iam_role.refael_job_runner.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_policy" "refael_job_runner_policy" {
  name        = "refael-job-runner-policy"
  description = "Allows job-runner Lambda to launch ECS tasks and consume SQS messages"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSConsume"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = aws_sqs_queue.refael_jobs.arn
      },
      {
        Sid    = "ECSRunTask"
        Effect = "Allow"
        Action = ["ecs:RunTask"]
        Resource = [
          aws_ecs_task_definition.refael_linux.arn,
          aws_ecs_task_definition.refael_windows.arn,
          # Allow any revision of these task definitions
          "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/refael-linux-task:*",
          "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/refael-windows-task:*",
        ]
      },
      {
        Sid    = "ECSTagResource"
        Effect = "Allow"
        Action = ["ecs:TagResource"]
        Resource = "*"
      },
      {
        Sid    = "PassRoleToECS"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.refael_ecs_execution.arn,
          aws_iam_role.refael_ecs_task.arn,
        ]
      },
    ]
  })

  tags = {
    Name = "refael-job-runner-policy"
  }
}

resource "aws_iam_role_policy_attachment" "refael_job_runner_policy" {
  role       = aws_iam_role.refael_job_runner.name
  policy_arn = aws_iam_policy.refael_job_runner_policy.arn
}

# ── CloudWatch Log Group ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "refael_job_runner" {
  name              = "/aws/lambda/refael-job-runner"
  retention_in_days = 30

  tags = {
    Name = "refael-job-runner-logs"
  }
}

# ── Lambda Function ───────────────────────────────────────────────────────────

data "archive_file" "refael_job_runner_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src/job_runner"
  output_path = "${path.module}/lambda_src/job_runner.zip"
}

resource "aws_lambda_function" "refael_job_runner" {
  function_name = "refael-job-runner"
  description   = "Consumes SQS job messages and launches ECS Fargate tasks"
  role          = aws_iam_role.refael_job_runner.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime
  timeout       = 60
  memory_size   = 256

  filename         = data.archive_file.refael_job_runner_zip.output_path
  source_code_hash = data.archive_file.refael_job_runner_zip.output_base64sha256

  environment {
    variables = {
      ECS_CLUSTER_ARN        = aws_ecs_cluster.refael.arn
      LINUX_TASK_DEF_ARN     = aws_ecs_task_definition.refael_linux.arn
      WINDOWS_TASK_DEF_ARN   = aws_ecs_task_definition.refael_windows.arn
      PUBLIC_SUBNET_IDS      = join(",", aws_subnet.refael_public[*].id)
      ECS_SECURITY_GROUP_ID  = aws_security_group.refael_ecs.id
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.refael_job_runner,
    aws_iam_role_policy_attachment.refael_job_runner_basic,
  ]

  tags = {
    Name = "refael-job-runner"
  }
}

# ── SQS → Lambda trigger ──────────────────────────────────────────────────────

resource "aws_lambda_event_source_mapping" "refael_sqs_to_job_runner" {
  event_source_arn                   = aws_sqs_queue.refael_jobs.arn
  function_name                      = aws_lambda_function.refael_job_runner.arn
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
}
