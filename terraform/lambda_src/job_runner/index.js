'use strict';

const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');

const ecs = new ECSClient({});

const CLUSTER          = process.env.ECS_CLUSTER_ARN;
const LINUX_TASK_DEF   = process.env.LINUX_TASK_DEF_ARN;
const WINDOWS_TASK_DEF = process.env.WINDOWS_TASK_DEF_ARN;
const SUBNETS          = (process.env.PUBLIC_SUBNET_IDS || '').split(',');
const SECURITY_GROUP   = process.env.ECS_SECURITY_GROUP_ID;

exports.handler = async (event) => {
  for (const record of event.Records) {
    let message;
    try {
      message = JSON.parse(record.body);
    } catch (err) {
      console.error('Failed to parse SQS message:', record.body, err);
      continue;
    }

    const { jobId, platform, run_mode } = message;
    console.log(`Processing job ${jobId}: platform=${platform} run_mode=${run_mode}`);

    const taskDefinition = platform === 'windows' ? WINDOWS_TASK_DEF : LINUX_TASK_DEF;

    const result = await ecs.send(new RunTaskCommand({
      cluster:        CLUSTER,
      taskDefinition,
      launchType:     'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets:        SUBNETS,
          securityGroups: [SECURITY_GROUP],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [{
          name: platform === 'windows' ? 'refael-windows' : 'refael-linux',
          environment: [
            { name: 'RUN_MODE',  value: run_mode },
            { name: 'JOB_ID',    value: jobId },
          ],
        }],
      },
      tags: [
        { key: 'Project',  value: 'refael' },
        { key: 'JobId',    value: jobId },
        { key: 'RunMode',  value: run_mode },
        { key: 'Platform', value: platform },
      ],
    }));

    if (result.failures && result.failures.length > 0) {
      console.error(`ECS RunTask failures for job ${jobId}:`, JSON.stringify(result.failures));
      throw new Error(`ECS RunTask failed: ${result.failures[0].reason}`);
    }

    const taskArn = result.tasks[0].taskArn;
    console.log(`Job ${jobId} launched ECS task: ${taskArn}`);
  }
};
