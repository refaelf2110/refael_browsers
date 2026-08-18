# ── ECS Task Execution Role ───────────────────────────────────────────────────
# Used by the ECS agent itself to pull images and send logs.

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "refael_ecs_execution" {
  name               = "refael-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = {
    Name = "refael-ecs-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "refael_ecs_execution_policy" {
  role       = aws_iam_role.refael_ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ── ECS Task Role ─────────────────────────────────────────────────────────────
# Used by the application code running inside the container.

resource "aws_iam_role" "refael_ecs_task" {
  name               = "refael-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = {
    Name = "refael-ecs-task-role"
  }
}

data "aws_iam_policy_document" "refael_ecs_task_policy" {
  # Read browser binaries from the cache bucket
  statement {
    sid    = "BrowsersCacheRead"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.refael_browsers_cache.arn,
      "${aws_s3_bucket.refael_browsers_cache.arn}/*",
    ]
  }

  # Write test results to the results bucket
  statement {
    sid    = "ResultsWrite"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.refael_results.arn,
      "${aws_s3_bucket.refael_results.arn}/*",
    ]
  }
}

resource "aws_iam_policy" "refael_ecs_task_policy" {
  name        = "refael-ecs-task-policy"
  description = "Allows ECS task containers to read browsers-cache and write results"
  policy      = data.aws_iam_policy_document.refael_ecs_task_policy.json

  tags = {
    Name = "refael-ecs-task-policy"
  }
}

resource "aws_iam_role_policy_attachment" "refael_ecs_task_policy" {
  role       = aws_iam_role.refael_ecs_task.name
  policy_arn = aws_iam_policy.refael_ecs_task_policy.arn
}
