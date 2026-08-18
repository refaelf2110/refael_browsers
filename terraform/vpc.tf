# ── VPC ──────────────────────────────────────────────────────────────────────

resource "aws_vpc" "refael" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "refael-vpc"
  }
}

# ── Subnets ───────────────────────────────────────────────────────────────────

resource "aws_subnet" "refael_public" {
  count                   = 2
  vpc_id                  = aws_vpc.refael.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "refael-public-subnet-${count.index + 1}"
  }
}

resource "aws_subnet" "refael_private" {
  count             = 2
  vpc_id            = aws_vpc.refael.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "refael-private-subnet-${count.index + 1}"
  }
}

# ── Internet Gateway ──────────────────────────────────────────────────────────

resource "aws_internet_gateway" "refael" {
  vpc_id = aws_vpc.refael.id

  tags = {
    Name = "refael-igw"
  }
}

# ── Elastic IP + NAT Gateway (in first public subnet) ────────────────────────

resource "aws_eip" "refael_nat" {
  domain = "vpc"

  tags = {
    Name = "refael-nat-eip"
  }

  depends_on = [aws_internet_gateway.refael]
}

resource "aws_nat_gateway" "refael" {
  allocation_id = aws_eip.refael_nat.id
  subnet_id     = aws_subnet.refael_public[0].id

  tags = {
    Name = "refael-nat-gw"
  }

  depends_on = [aws_internet_gateway.refael]
}

# ── Route Tables ──────────────────────────────────────────────────────────────

# Public: route all traffic through IGW
resource "aws_route_table" "refael_public" {
  vpc_id = aws_vpc.refael.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.refael.id
  }

  tags = {
    Name = "refael-public-rt"
  }
}

resource "aws_route_table_association" "refael_public" {
  count          = 2
  subnet_id      = aws_subnet.refael_public[count.index].id
  route_table_id = aws_route_table.refael_public.id
}

# Private: route all traffic through NAT GW
resource "aws_route_table" "refael_private" {
  vpc_id = aws_vpc.refael.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.refael.id
  }

  tags = {
    Name = "refael-private-rt"
  }
}

resource "aws_route_table_association" "refael_private" {
  count          = 2
  subnet_id      = aws_subnet.refael_private[count.index].id
  route_table_id = aws_route_table.refael_private.id
}

# ── Security Groups ───────────────────────────────────────────────────────────

# Lambda security group — outbound only (reaches Athena/S3 via internet or VPC endpoints)
resource "aws_security_group" "refael_lambda" {
  name        = "refael-lambda-sg"
  description = "Security group for Lambda functions - egress only"
  vpc_id      = aws_vpc.refael.id

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "refael-lambda-sg"
  }
}

# ECS tasks security group — outbound only
resource "aws_security_group" "refael_ecs" {
  name        = "refael-ecs-sg"
  description = "Security group for ECS Fargate tasks - egress only"
  vpc_id      = aws_vpc.refael.id

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "refael-ecs-sg"
  }
}
