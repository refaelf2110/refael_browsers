# ── REST API ──────────────────────────────────────────────────────────────────

resource "aws_api_gateway_rest_api" "refael" {
  name        = "refael-api"
  description = "REST API for refael browser-matrix jobs and results"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = {
    Name = "refael-api"
  }
}

# ── Helper: CORS OPTIONS integration for a given resource ────────────────────
# Terraform doesn't support dynamic module blocks for per-resource CORS,
# so each resource gets its own OPTIONS method defined explicitly below.

locals {
  cors_headers = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  cors_response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

# ── Lambda permissions ────────────────────────────────────────────────────────

resource "aws_lambda_permission" "refael_job_submitter_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.refael_job_submitter.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.refael.execution_arn}/*/*"
}

resource "aws_lambda_permission" "refael_results_api_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.refael_results_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.refael.execution_arn}/*/*"
}

# ── /jobs ─────────────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "jobs" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_rest_api.refael.root_resource_id
  path_part   = "jobs"
}

# POST /jobs → job-submitter
resource "aws_api_gateway_method" "jobs_post" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.jobs.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "jobs_post" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.jobs.id
  http_method             = aws_api_gateway_method.jobs_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_job_submitter.invoke_arn
}

# OPTIONS /jobs — CORS preflight
resource "aws_api_gateway_method" "jobs_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.jobs.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "jobs_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.jobs.id
  http_method = aws_api_gateway_method.jobs_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "jobs_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.jobs.id
  http_method = aws_api_gateway_method.jobs_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "jobs_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.jobs.id
  http_method = aws_api_gateway_method.jobs_options.http_method
  status_code = aws_api_gateway_method_response.jobs_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.jobs_options]
}

# ── /runs ─────────────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "runs" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_rest_api.refael.root_resource_id
  path_part   = "runs"
}

# GET /runs → results-api
resource "aws_api_gateway_method" "runs_get" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.runs.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "runs_get" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.runs.id
  http_method             = aws_api_gateway_method.runs_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_results_api.invoke_arn
}

# OPTIONS /runs
resource "aws_api_gateway_method" "runs_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.runs.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "runs_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.runs.id
  http_method = aws_api_gateway_method.runs_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "runs_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.runs.id
  http_method = aws_api_gateway_method.runs_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "runs_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.runs.id
  http_method = aws_api_gateway_method.runs_options.http_method
  status_code = aws_api_gateway_method_response.runs_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.runs_options]
}

# ── /runs/{id} ────────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "runs_id" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_resource.runs.id
  path_part   = "{id}"
}

resource "aws_api_gateway_method" "runs_id_get" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.runs_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "runs_id_get" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.runs_id.id
  http_method             = aws_api_gateway_method.runs_id_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_results_api.invoke_arn
}

resource "aws_api_gateway_method" "runs_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.runs_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "runs_id_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.runs_id.id
  http_method = aws_api_gateway_method.runs_id_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "runs_id_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.runs_id.id
  http_method = aws_api_gateway_method.runs_id_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "runs_id_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.runs_id.id
  http_method = aws_api_gateway_method.runs_id_options.http_method
  status_code = aws_api_gateway_method_response.runs_id_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.runs_id_options]
}

# ── /interceptions ────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "interceptions" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_rest_api.refael.root_resource_id
  path_part   = "interceptions"
}

resource "aws_api_gateway_method" "interceptions_get" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.interceptions.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "interceptions_get" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.interceptions.id
  http_method             = aws_api_gateway_method.interceptions_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_results_api.invoke_arn
}

resource "aws_api_gateway_method" "interceptions_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.interceptions.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "interceptions_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.interceptions.id
  http_method = aws_api_gateway_method.interceptions_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "interceptions_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.interceptions.id
  http_method = aws_api_gateway_method.interceptions_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "interceptions_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.interceptions.id
  http_method = aws_api_gateway_method.interceptions_options.http_method
  status_code = aws_api_gateway_method_response.interceptions_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.interceptions_options]
}

# ── /interceptions/{id} ───────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "interceptions_id" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_resource.interceptions.id
  path_part   = "{id}"
}

resource "aws_api_gateway_method" "interceptions_id_get" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.interceptions_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "interceptions_id_get" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.interceptions_id.id
  http_method             = aws_api_gateway_method.interceptions_id_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_results_api.invoke_arn
}

resource "aws_api_gateway_method" "interceptions_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.interceptions_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "interceptions_id_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.interceptions_id.id
  http_method = aws_api_gateway_method.interceptions_id_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "interceptions_id_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.interceptions_id.id
  http_method = aws_api_gateway_method.interceptions_id_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "interceptions_id_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.interceptions_id.id
  http_method = aws_api_gateway_method.interceptions_id_options.http_method
  status_code = aws_api_gateway_method_response.interceptions_id_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.interceptions_id_options]
}

# ── /extractor ────────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "extractor" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_rest_api.refael.root_resource_id
  path_part   = "extractor"
}

# /extractor/browsers
resource "aws_api_gateway_resource" "extractor_browsers" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_resource.extractor.id
  path_part   = "browsers"
}

resource "aws_api_gateway_method" "extractor_browsers_get" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.extractor_browsers.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "extractor_browsers_get" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.extractor_browsers.id
  http_method             = aws_api_gateway_method.extractor_browsers_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_results_api.invoke_arn
}

resource "aws_api_gateway_method" "extractor_browsers_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.extractor_browsers.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "extractor_browsers_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_browsers.id
  http_method = aws_api_gateway_method.extractor_browsers_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "extractor_browsers_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_browsers.id
  http_method = aws_api_gateway_method.extractor_browsers_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "extractor_browsers_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_browsers.id
  http_method = aws_api_gateway_method.extractor_browsers_options.http_method
  status_code = aws_api_gateway_method_response.extractor_browsers_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.extractor_browsers_options]
}

# /extractor/diff
resource "aws_api_gateway_resource" "extractor_diff" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_resource.extractor.id
  path_part   = "diff"
}

resource "aws_api_gateway_method" "extractor_diff_get" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.extractor_diff.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "extractor_diff_get" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.extractor_diff.id
  http_method             = aws_api_gateway_method.extractor_diff_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_results_api.invoke_arn
}

resource "aws_api_gateway_method" "extractor_diff_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.extractor_diff.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "extractor_diff_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_diff.id
  http_method = aws_api_gateway_method.extractor_diff_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "extractor_diff_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_diff.id
  http_method = aws_api_gateway_method.extractor_diff_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "extractor_diff_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_diff.id
  http_method = aws_api_gateway_method.extractor_diff_options.http_method
  status_code = aws_api_gateway_method_response.extractor_diff_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.extractor_diff_options]
}

# /extractor/functions
resource "aws_api_gateway_resource" "extractor_functions" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  parent_id   = aws_api_gateway_resource.extractor.id
  path_part   = "functions"
}

resource "aws_api_gateway_method" "extractor_functions_get" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.extractor_functions.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "extractor_functions_get" {
  rest_api_id             = aws_api_gateway_rest_api.refael.id
  resource_id             = aws_api_gateway_resource.extractor_functions.id
  http_method             = aws_api_gateway_method.extractor_functions_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.refael_results_api.invoke_arn
}

resource "aws_api_gateway_method" "extractor_functions_options" {
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  resource_id   = aws_api_gateway_resource.extractor_functions.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "extractor_functions_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_functions.id
  http_method = aws_api_gateway_method.extractor_functions_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "extractor_functions_options_200" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_functions.id
  http_method = aws_api_gateway_method.extractor_functions_options.http_method
  status_code = "200"
  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "extractor_functions_options" {
  rest_api_id = aws_api_gateway_rest_api.refael.id
  resource_id = aws_api_gateway_resource.extractor_functions.id
  http_method = aws_api_gateway_method.extractor_functions_options.http_method
  status_code = aws_api_gateway_method_response.extractor_functions_options_200.status_code
  response_parameters = local.cors_headers
  depends_on  = [aws_api_gateway_integration.extractor_functions_options]
}

# ── Deployment & Stage ────────────────────────────────────────────────────────

resource "aws_api_gateway_deployment" "refael" {
  rest_api_id = aws_api_gateway_rest_api.refael.id

  # Force re-deployment when any method/integration changes
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.jobs.id,
      aws_api_gateway_method.jobs_post.id,
      aws_api_gateway_integration.jobs_post.id,
      aws_api_gateway_resource.runs.id,
      aws_api_gateway_method.runs_get.id,
      aws_api_gateway_integration.runs_get.id,
      aws_api_gateway_resource.runs_id.id,
      aws_api_gateway_method.runs_id_get.id,
      aws_api_gateway_integration.runs_id_get.id,
      aws_api_gateway_resource.interceptions.id,
      aws_api_gateway_method.interceptions_get.id,
      aws_api_gateway_integration.interceptions_get.id,
      aws_api_gateway_resource.interceptions_id.id,
      aws_api_gateway_method.interceptions_id_get.id,
      aws_api_gateway_integration.interceptions_id_get.id,
      aws_api_gateway_resource.extractor_browsers.id,
      aws_api_gateway_method.extractor_browsers_get.id,
      aws_api_gateway_integration.extractor_browsers_get.id,
      aws_api_gateway_resource.extractor_diff.id,
      aws_api_gateway_method.extractor_diff_get.id,
      aws_api_gateway_integration.extractor_diff_get.id,
      aws_api_gateway_resource.extractor_functions.id,
      aws_api_gateway_method.extractor_functions_get.id,
      aws_api_gateway_integration.extractor_functions_get.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.jobs_post,
    aws_api_gateway_integration.jobs_options,
    aws_api_gateway_integration.runs_get,
    aws_api_gateway_integration.runs_options,
    aws_api_gateway_integration.runs_id_get,
    aws_api_gateway_integration.runs_id_options,
    aws_api_gateway_integration.interceptions_get,
    aws_api_gateway_integration.interceptions_options,
    aws_api_gateway_integration.interceptions_id_get,
    aws_api_gateway_integration.interceptions_id_options,
    aws_api_gateway_integration.extractor_browsers_get,
    aws_api_gateway_integration.extractor_browsers_options,
    aws_api_gateway_integration.extractor_diff_get,
    aws_api_gateway_integration.extractor_diff_options,
    aws_api_gateway_integration.extractor_functions_get,
    aws_api_gateway_integration.extractor_functions_options,
  ]
}

resource "aws_api_gateway_stage" "refael_prod" {
  deployment_id = aws_api_gateway_deployment.refael.id
  rest_api_id   = aws_api_gateway_rest_api.refael.id
  stage_name    = "prod"

  tags = {
    Name = "refael-api-prod"
  }
}
