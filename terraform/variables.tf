variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "terraform"
}

variable "project" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "refael"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for the public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for the private subnets"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "availability_zones" {
  description = "Availability zones to use"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "github_repo" {
  description = "GitHub repository URL for Amplify"
  type        = string
  default     = "https://github.com/refaelf2110/refael_browsers"
}

variable "github_access_token" {
  description = "GitHub personal access token for Amplify to connect to the repo"
  type        = string
  sensitive   = true
}

variable "amplify_branch" {
  description = "GitHub branch for Amplify"
  type        = string
  default     = "main"
}

variable "sqs_visibility_timeout" {
  description = "SQS visibility timeout in seconds"
  type        = number
  default     = 900
}

variable "sqs_max_receive_count" {
  description = "Number of failed receives before moving to DLQ"
  type        = number
  default     = 3
}

variable "lambda_runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "nodejs20.x"
}

variable "ecs_linux_cpu" {
  description = "CPU units for Linux ECS task"
  type        = number
  default     = 2048
}

variable "ecs_linux_memory" {
  description = "Memory (MiB) for Linux ECS task"
  type        = number
  default     = 4096
}

variable "ecs_windows_cpu" {
  description = "CPU units for Windows ECS task"
  type        = number
  default     = 2048
}

variable "ecs_windows_memory" {
  description = "Memory (MiB) for Windows ECS task"
  type        = number
  default     = 4096
}

variable "athena_results_prefix" {
  description = "S3 prefix for Athena query results"
  type        = string
  default     = "athena-results/"
}
