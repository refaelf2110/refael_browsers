# ── Dead-Letter Queue ─────────────────────────────────────────────────────────

resource "aws_sqs_queue" "refael_jobs_dlq" {
  name                      = "refael-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "refael-jobs-dlq"
  }
}

# ── Main Queue ────────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "refael_jobs" {
  name                       = "refael-jobs"
  visibility_timeout_seconds = var.sqs_visibility_timeout
  message_retention_seconds  = 86400 # 1 day

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.refael_jobs_dlq.arn
    maxReceiveCount     = var.sqs_max_receive_count
  })

  tags = {
    Name = "refael-jobs"
  }
}

# Allow the DLQ to receive messages via the redrive policy
resource "aws_sqs_queue_redrive_allow_policy" "refael_jobs_dlq" {
  queue_url = aws_sqs_queue.refael_jobs_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.refael_jobs.arn]
  })
}
