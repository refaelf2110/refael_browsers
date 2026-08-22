# ── Lambda placeholder zip archives ──────────────────────────────────────────

data "archive_file" "refael_job_submitter_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src/job_submitter"
  output_path = "${path.module}/lambda_src/job_submitter.zip"
}

data "archive_file" "refael_results_api_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src/results_api"
  output_path = "${path.module}/lambda_src/results_api.zip"
}

# ── IAM: job-submitter role ───────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "refael_job_submitter" {
  name               = "refael-job-submitter-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Name = "refael-job-submitter-role"
  }
}

# Basic execution (CloudWatch logs) + VPC networking
resource "aws_iam_role_policy_attachment" "refael_job_submitter_basic" {
  role       = aws_iam_role.refael_job_submitter.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "refael_job_submitter_policy" {
  statement {
    sid    = "SQSSend"
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
    ]
    resources = [
      aws_sqs_queue.refael_jobs.arn,
    ]
  }
}

resource "aws_iam_policy" "refael_job_submitter_policy" {
  name        = "refael-job-submitter-policy"
  description = "Allows job-submitter Lambda to send messages to refael-jobs SQS"
  policy      = data.aws_iam_policy_document.refael_job_submitter_policy.json

  tags = {
    Name = "refael-job-submitter-policy"
  }
}

resource "aws_iam_role_policy_attachment" "refael_job_submitter_sqs" {
  role       = aws_iam_role.refael_job_submitter.name
  policy_arn = aws_iam_policy.refael_job_submitter_policy.arn
}

# ── IAM: results-api role ─────────────────────────────────────────────────────

resource "aws_iam_role" "refael_results_api" {
  name               = "refael-results-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Name = "refael-results-api-role"
  }
}

resource "aws_iam_role_policy_attachment" "refael_results_api_basic" {
  role       = aws_iam_role.refael_results_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "refael_results_api_policy" {
  statement {
    sid    = "AthenaQuery"
    effect = "Allow"
    actions = [
      "athena:StartQueryExecution",
      "athena:GetQueryExecution",
      "athena:GetQueryResults",
    ]
    resources = [
      "arn:aws:athena:${var.aws_region}:${data.aws_caller_identity.current.account_id}:workgroup/refael-workgroup",
    ]
  }

  statement {
    sid    = "GlueCatalogRead"
    effect = "Allow"
    actions = [
      "glue:GetDatabase",
      "glue:GetTable",
      "glue:GetPartitions",
    ]
    resources = [
      "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:catalog",
      "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:database/refael_browser_matrix",
      "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/refael_browser_matrix/*",
    ]
  }

  statement {
    sid    = "ResultsS3Access"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [
      aws_s3_bucket.refael_results.arn,
      "${aws_s3_bucket.refael_results.arn}/*",
    ]
  }

  statement {
    sid    = "BrowsersCacheList"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.refael_browsers_cache.arn,
    ]
  }
}

resource "aws_iam_policy" "refael_results_api_policy" {
  name        = "refael-results-api-policy"
  description = "Allows results-api Lambda to query Athena and access refael-results S3"
  policy      = data.aws_iam_policy_document.refael_results_api_policy.json

  tags = {
    Name = "refael-results-api-policy"
  }
}

resource "aws_iam_role_policy_attachment" "refael_results_api_athena" {
  role       = aws_iam_role.refael_results_api.name
  policy_arn = aws_iam_policy.refael_results_api_policy.arn
}

# ── CloudWatch Log Groups for Lambda ─────────────────────────────────────────

resource "aws_cloudwatch_log_group" "refael_job_submitter" {
  name              = "/aws/lambda/refael-job-submitter"
  retention_in_days = 30

  tags = {
    Name = "refael-job-submitter-logs"
  }
}

resource "aws_cloudwatch_log_group" "refael_results_api" {
  name              = "/aws/lambda/refael-results-api"
  retention_in_days = 30

  tags = {
    Name = "refael-results-api-logs"
  }
}

# ── Lambda Function: refael-job-submitter ─────────────────────────────────────

resource "aws_lambda_function" "refael_job_submitter" {
  function_name = "refael-job-submitter"
  description   = "Receives job requests from API Gateway, validates and enqueues them to SQS"
  role          = aws_iam_role.refael_job_submitter.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.refael_job_submitter_zip.output_path
  source_code_hash = data.archive_file.refael_job_submitter_zip.output_base64sha256

  vpc_config {
    subnet_ids         = aws_subnet.refael_private[*].id
    security_group_ids = [aws_security_group.refael_lambda.id]
  }

  environment {
    variables = {
      SQS_QUEUE_URL = aws_sqs_queue.refael_jobs.url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.refael_job_submitter,
    aws_iam_role_policy_attachment.refael_job_submitter_basic,
  ]

  tags = {
    Name = "refael-job-submitter"
  }
}

# ── Lambda Function: refael-results-api ───────────────────────────────────────

resource "aws_lambda_function" "refael_results_api" {
  function_name = "refael-results-api"
  description   = "Receives queries from API Gateway and returns results from Athena"
  role          = aws_iam_role.refael_results_api.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime
  timeout       = 60
  memory_size   = 256

  filename         = data.archive_file.refael_results_api_zip.output_path
  source_code_hash = data.archive_file.refael_results_api_zip.output_base64sha256

  vpc_config {
    subnet_ids         = aws_subnet.refael_private[*].id
    security_group_ids = [aws_security_group.refael_lambda.id]
  }

  environment {
    variables = {
      ATHENA_WORKGROUP       = aws_athena_workgroup.refael.name
      ATHENA_DATABASE        = aws_glue_catalog_database.refael_browser_matrix.name
      ATHENA_RESULTS_BUCKET  = "s3://${aws_s3_bucket.refael_results.id}/${var.athena_results_prefix}"
      BROWSERS_CACHE_BUCKET  = aws_s3_bucket.refael_browsers_cache.id
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.refael_results_api,
    aws_iam_role_policy_attachment.refael_results_api_basic,
  ]

  tags = {
    Name = "refael-results-api"
  }
}
