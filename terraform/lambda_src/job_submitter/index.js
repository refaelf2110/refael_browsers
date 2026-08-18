'use strict';

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const sqs = new SQSClient({});
const QUEUE_URL = process.env.SQS_QUEUE_URL;

const VALID_PLATFORMS = ['linux', 'windows'];
const VALID_RUN_MODES = ['mini', 'full', 'extractor', 'extractor-mini', 'interceptions', 'debug', 'download'];

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }

  const { platform, run_mode } = body;

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return response(400, {
      error: `platform is required and must be one of: ${VALID_PLATFORMS.join(', ')}`,
    });
  }

  if (!run_mode || !VALID_RUN_MODES.includes(run_mode)) {
    return response(400, {
      error: `run_mode is required and must be one of: ${VALID_RUN_MODES.join(', ')}`,
    });
  }

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const message = {
    jobId,
    platform,
    run_mode,
    submittedAt: new Date().toISOString(),
  };

  await sqs.send(new SendMessageCommand({
    QueueUrl:    QUEUE_URL,
    MessageBody: JSON.stringify(message),
    MessageAttributes: {
      platform: { DataType: 'String', StringValue: platform },
      run_mode: { DataType: 'String', StringValue: run_mode },
    },
  }));

  return response(202, { jobId, status: 'queued', message });
};
