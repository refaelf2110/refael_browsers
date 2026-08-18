# ── API Gateway ───────────────────────────────────────────────────────────────

output "api_gateway_url" {
  description = "Base URL for the refael-api REST API (prod stage)"
  value       = "https://${aws_api_gateway_rest_api.refael.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_api_gateway_stage.refael_prod.stage_name}"
}

output "api_gateway_id" {
  description = "REST API ID"
  value       = aws_api_gateway_rest_api.refael.id
}

# ── Amplify ───────────────────────────────────────────────────────────────────

output "amplify_app_id" {
  description = "Amplify App ID"
  value       = aws_amplify_app.refael_dashboard.id
}

output "amplify_default_domain" {
  description = "Amplify default domain (before custom domain is attached)"
  value       = "https://${var.amplify_branch}.${aws_amplify_app.refael_dashboard.default_domain}"
}

# ── ECR ───────────────────────────────────────────────────────────────────────

output "ecr_linux_repo_url" {
  description = "ECR repository URL for the Linux container image"
  value       = aws_ecr_repository.refael_linux.repository_url
}

output "ecr_windows_repo_url" {
  description = "ECR repository URL for the Windows container image"
  value       = aws_ecr_repository.refael_windows.repository_url
}

# ── S3 ────────────────────────────────────────────────────────────────────────

output "browsers_cache_bucket" {
  description = "S3 bucket name for browser binary cache"
  value       = aws_s3_bucket.refael_browsers_cache.id
}

output "results_bucket" {
  description = "S3 bucket name for test results"
  value       = aws_s3_bucket.refael_results.id
}

# ── SQS ──────────────────────────────────────────────────────────────────────

output "sqs_jobs_url" {
  description = "URL of the refael-jobs SQS queue"
  value       = aws_sqs_queue.refael_jobs.url
}

output "sqs_jobs_dlq_url" {
  description = "URL of the refael-jobs-dlq SQS queue"
  value       = aws_sqs_queue.refael_jobs_dlq.url
}

# ── ECS ───────────────────────────────────────────────────────────────────────

output "ecs_cluster_arn" {
  description = "ARN of the refael ECS cluster"
  value       = aws_ecs_cluster.refael.arn
}

output "ecs_linux_task_definition_arn" {
  description = "ARN of the Linux Fargate task definition"
  value       = aws_ecs_task_definition.refael_linux.arn
}

output "ecs_windows_task_definition_arn" {
  description = "ARN of the Windows Fargate task definition"
  value       = aws_ecs_task_definition.refael_windows.arn
}

# ── VPC ───────────────────────────────────────────────────────────────────────

output "vpc_id" {
  description = "ID of the refael VPC"
  value       = aws_vpc.refael.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.refael_public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = aws_subnet.refael_private[*].id
}

# ── Athena ────────────────────────────────────────────────────────────────────

output "athena_workgroup" {
  description = "Name of the Athena workgroup"
  value       = aws_athena_workgroup.refael.name
}

output "athena_database" {
  description = "Name of the Glue catalog database"
  value       = aws_glue_catalog_database.refael_browser_matrix.name
}
