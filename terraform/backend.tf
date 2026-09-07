terraform {
  backend "s3" {
    bucket  = "terraform-993942172925-us-east-1"
    key     = "refael/terraform.tfstate"
    region  = "us-east-1"
    profile = "llm"
  }
}
