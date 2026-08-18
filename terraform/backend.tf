terraform {
  backend "s3" {
    bucket  = "terraform-696416492068-us-east-1-an"
    key     = "refael/terraform.tfstate"
    region  = "us-east-1"
    profile = "terraform"
  }
}
