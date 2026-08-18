# ── S3 Bucket: refael-browsers-cache ─────────────────────────────────────────

resource "aws_s3_bucket" "refael_browsers_cache" {
  bucket = "refael-browsers-cache"

  tags = {
    Name = "refael-browsers-cache"
  }
}

resource "aws_s3_bucket_versioning" "refael_browsers_cache" {
  bucket = aws_s3_bucket.refael_browsers_cache.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "refael_browsers_cache" {
  bucket = aws_s3_bucket.refael_browsers_cache.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Placeholder objects to establish prefix structure
resource "aws_s3_object" "refael_browsers_cache_linux_prefix" {
  bucket  = aws_s3_bucket.refael_browsers_cache.id
  key     = "linux/.keep"
  content = ""
}

resource "aws_s3_object" "refael_browsers_cache_windows_prefix" {
  bucket  = aws_s3_bucket.refael_browsers_cache.id
  key     = "windows/.keep"
  content = ""
}

resource "aws_s3_object" "refael_browsers_cache_macos_prefix" {
  bucket  = aws_s3_bucket.refael_browsers_cache.id
  key     = "macos-ios/.keep"
  content = ""
}

# ── S3 Bucket: refael-results ─────────────────────────────────────────────────

resource "aws_s3_bucket" "refael_results" {
  bucket = "refael-results"

  tags = {
    Name = "refael-results"
  }
}

resource "aws_s3_bucket_versioning" "refael_results" {
  bucket = aws_s3_bucket.refael_results.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "refael_results" {
  bucket = aws_s3_bucket.refael_results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Placeholder objects to establish prefix structure
resource "aws_s3_object" "refael_results_runs_prefix" {
  bucket  = aws_s3_bucket.refael_results.id
  key     = "runs/.keep"
  content = ""
}

resource "aws_s3_object" "refael_results_results_prefix" {
  bucket  = aws_s3_bucket.refael_results.id
  key     = "results/.keep"
  content = ""
}

resource "aws_s3_object" "refael_results_window_elements_prefix" {
  bucket  = aws_s3_bucket.refael_results.id
  key     = "window_elements/.keep"
  content = ""
}

resource "aws_s3_object" "refael_results_interception_sessions_prefix" {
  bucket  = aws_s3_bucket.refael_results.id
  key     = "interception_sessions/.keep"
  content = ""
}

resource "aws_s3_object" "refael_results_interceptions_prefix" {
  bucket  = aws_s3_bucket.refael_results.id
  key     = "interceptions/.keep"
  content = ""
}

resource "aws_s3_object" "refael_results_athena_prefix" {
  bucket  = aws_s3_bucket.refael_results.id
  key     = "athena-results/.keep"
  content = ""
}
