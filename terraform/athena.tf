# ── Athena Workgroup ──────────────────────────────────────────────────────────

resource "aws_athena_workgroup" "refael" {
  name        = "refael-workgroup"
  description = "Workgroup for refael browser-matrix queries"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.refael_results.id}/${var.athena_results_prefix}"
    }
  }

  tags = {
    Name = "refael-workgroup"
  }
}

# ── Glue Catalog Database ─────────────────────────────────────────────────────

resource "aws_glue_catalog_database" "refael_browser_matrix" {
  name        = "refael_browser_matrix"
  description = "Database for refael browser-matrix Parquet tables"
}

# ── Glue Catalog Tables (Parquet, stored in refael-results) ───────────────────

# runs (id, run_type, completed_at, elapsed)
resource "aws_glue_catalog_table" "runs" {
  name          = "runs"
  database_name = aws_glue_catalog_database.refael_browser_matrix.name

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"       = "parquet"
    "parquet.compression"  = "SNAPPY"
    "EXTERNAL"             = "TRUE"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.refael_results.id}/runs/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      name                  = "runs-serde"
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
      parameters = {
        "serialization.format" = "1"
      }
    }

    columns {
      name = "id"
      type = "string"
    }
    columns {
      name = "run_type"
      type = "string"
    }
    columns {
      name = "completed_at"
      type = "string"
    }
    columns {
      name = "elapsed"
      type = "string"
    }
  }
}

# results (id, run_id, framework, label, major, mode, all_reasons, error)
resource "aws_glue_catalog_table" "results" {
  name          = "results"
  database_name = aws_glue_catalog_database.refael_browser_matrix.name

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"       = "parquet"
    "parquet.compression"  = "SNAPPY"
    "EXTERNAL"             = "TRUE"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.refael_results.id}/results/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      name                  = "results-serde"
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
      parameters = {
        "serialization.format" = "1"
      }
    }

    columns {
      name = "id"
      type = "string"
    }
    columns {
      name = "run_id"
      type = "string"
    }
    columns {
      name = "framework"
      type = "string"
    }
    columns {
      name = "label"
      type = "string"
    }
    columns {
      name = "major"
      type = "string"
    }
    columns {
      name = "mode"
      type = "string"
    }
    columns {
      name = "all_reasons"
      type = "string"
    }
    columns {
      name = "error"
      type = "string"
    }
  }
}

# window_elements (id, browser_label, collected_at, name, type, value, raw)
resource "aws_glue_catalog_table" "window_elements" {
  name          = "window_elements"
  database_name = aws_glue_catalog_database.refael_browser_matrix.name

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"       = "parquet"
    "parquet.compression"  = "SNAPPY"
    "EXTERNAL"             = "TRUE"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.refael_results.id}/window_elements/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      name                  = "window-elements-serde"
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
      parameters = {
        "serialization.format" = "1"
      }
    }

    columns {
      name = "id"
      type = "string"
    }
    columns {
      name = "browser_label"
      type = "string"
    }
    columns {
      name = "collected_at"
      type = "string"
    }
    columns {
      name = "name"
      type = "string"
    }
    columns {
      name = "type"
      type = "string"
    }
    columns {
      name = "value"
      type = "string"
    }
    columns {
      name = "raw"
      type = "string"
    }
  }
}

# interception_sessions (id, framework, browser_label, started_at, completed_at, action_count, call_count)
resource "aws_glue_catalog_table" "interception_sessions" {
  name          = "interception_sessions"
  database_name = aws_glue_catalog_database.refael_browser_matrix.name

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"       = "parquet"
    "parquet.compression"  = "SNAPPY"
    "EXTERNAL"             = "TRUE"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.refael_results.id}/interception_sessions/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      name                  = "interception-sessions-serde"
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
      parameters = {
        "serialization.format" = "1"
      }
    }

    columns {
      name = "id"
      type = "string"
    }
    columns {
      name = "framework"
      type = "string"
    }
    columns {
      name = "browser_label"
      type = "string"
    }
    columns {
      name = "started_at"
      type = "string"
    }
    columns {
      name = "completed_at"
      type = "string"
    }
    columns {
      name = "action_count"
      type = "int"
    }
    columns {
      name = "call_count"
      type = "int"
    }
  }
}

# interceptions (id, session_id, seq, action, fn_name, args_json, this_arg,
#                caller, return_val, is_constructor, duration_ms, stack, triggered_at)
resource "aws_glue_catalog_table" "interceptions" {
  name          = "interceptions"
  database_name = aws_glue_catalog_database.refael_browser_matrix.name

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"       = "parquet"
    "parquet.compression"  = "SNAPPY"
    "EXTERNAL"             = "TRUE"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.refael_results.id}/interceptions/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      name                  = "interceptions-serde"
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
      parameters = {
        "serialization.format" = "1"
      }
    }

    columns {
      name = "id"
      type = "string"
    }
    columns {
      name = "session_id"
      type = "string"
    }
    columns {
      name = "seq"
      type = "int"
    }
    columns {
      name = "action"
      type = "string"
    }
    columns {
      name = "fn_name"
      type = "string"
    }
    columns {
      name = "args_json"
      type = "string"
    }
    columns {
      name = "this_arg"
      type = "string"
    }
    columns {
      name = "caller"
      type = "string"
    }
    columns {
      name = "return_val"
      type = "string"
    }
    columns {
      name = "is_constructor"
      type = "boolean"
    }
    columns {
      name = "duration_ms"
      type = "double"
    }
    columns {
      name = "stack"
      type = "string"
    }
    columns {
      name = "triggered_at"
      type = "string"
    }
  }
}
