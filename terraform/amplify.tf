# ── Amplify App ───────────────────────────────────────────────────────────────
# GitHub OAuth must be connected manually in the AWS Console after first apply.
# The resource structure is set up here; Amplify will prompt for OAuth on first visit.

resource "aws_amplify_app" "refael_dashboard" {
  name         = "refael-dashboard"
  repository   = var.github_repo
  access_token = var.github_access_token

  # No build spec yet — React app does not exist yet.
  # Amplify will detect a React app automatically once code is pushed.
  build_spec = <<-EOT
    version: 1
    applications:
      - appRoot: dashboard
        frontend:
          phases:
            preBuild:
              commands:
                - nvm install 18
                - nvm use 18
                - npm install --legacy-peer-deps
            build:
              commands:
                - npm run build
          artifacts:
            baseDirectory: build
            files:
              - '**/*'
          cache:
            paths:
              - node_modules/**/*
  EOT

  environment_variables = {
    REACT_APP_API_URL = "https://${aws_api_gateway_rest_api.refael.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_api_gateway_stage.refael_prod.stage_name}"
    _CUSTOM_IMAGE      = "aws/codebuild/standard:7.0"
    NODE_VERSION       = "18"
  }

  # Allow Amplify to auto-detect the framework
  enable_auto_branch_creation = false
  enable_branch_auto_deletion = false

  tags = {
    Name = "refael-dashboard"
  }
}

# ── Amplify Branch ────────────────────────────────────────────────────────────

resource "aws_amplify_branch" "refael_main" {
  app_id      = aws_amplify_app.refael_dashboard.id
  branch_name = var.amplify_branch

  # Enable automatic builds on push once GitHub is connected
  enable_auto_build = true

  tags = {
    Name = "refael-dashboard-main"
  }
}
