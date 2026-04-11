import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { executeWorkflowSteps } from './executor';
import { prisma } from '@browser-ops/db';
import { WorkflowStep } from '@browser-ops/shared';

// Redis connection - using the docker-compose hostname/port
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { 
  maxRetriesPerRequest: null,
  tls: redisUrl.startsWith('rediss://') ? {} : undefined
});

console.log('[Worker] Starting up...');

const worker = new Worker('workflow-runs', async (job: Job) => {
  const { runId, stepsJson, maxRetries } = job.data;
  console.log(`[Worker] Picked up job ${job.id} for run ${runId} (maxRetries: ${maxRetries || 0})`);
  
  // Mark run as "RUNNING"
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: new Date() }
  });

  // Execute instructions
  const steps = stepsJson as WorkflowStep[];
  await executeWorkflowSteps(runId, steps, maxRetries || 0);
}, { connection });

worker.on('ready', () => {
  console.log('[Worker] Connected to Redis, listening for jobs...');
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[Worker] Job ${job?.id} failed with error ${err.message}`);
});
