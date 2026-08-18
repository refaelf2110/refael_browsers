# ── ECR Repository: refael-linux ─────────────────────────────────────────────

resource "aws_ecr_repository" "refael_linux" {
  name                 = "refael-linux"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "refael-linux"
  }
}

resource "aws_ecr_lifecycle_policy" "refael_linux" {
  repository = aws_ecr_repository.refael_linux.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ── ECR Repository: refael-windows ───────────────────────────────────────────

resource "aws_ecr_repository" "refael_windows" {
  name                 = "refael-windows"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "refael-windows"
  }
}

resource "aws_ecr_lifecycle_policy" "refael_windows" {
  repository = aws_ecr_repository.refael_windows.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
