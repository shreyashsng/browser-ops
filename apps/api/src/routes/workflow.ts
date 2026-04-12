import { Router } from 'express';
import { prisma } from '@browser-ops/db';
import { workflowSchema } from '@browser-ops/shared';
import jwt from 'jsonwebtoken';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.startsWith('rediss://') ? {} : undefined
});
export const workflowQueue = new Queue('workflow-runs', { connection });

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-default-key-for-dev';

export const workflowRouter = Router();

export const authMiddleware = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'User token stale' });

    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

workflowRouter.use(authMiddleware);

workflowRouter.get('/', async (req: any, res) => {
  try {
    const workflows = await prisma.workflow.findMany({
      where: { userId: req.userId },
      include: {
        runs: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(workflows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

workflowRouter.get('/analytics', async (req: any, res) => {
  try {
    const totalRuns = await prisma.run.count({ where: { triggeredById: req.userId } });
    const successRuns = await prisma.run.count({ where: { triggeredById: req.userId, status: 'SUCCESS' } });
    const activeSessions = await prisma.session.count({ where: { userId: req.userId } });

    // Evaluate percentage bounded gracefully
    const successRate = totalRuns === 0 ? 0 : parseFloat(((successRuns / totalRuns) * 100).toFixed(1));

    res.json({
      totalExecutions: totalRuns,
      successRate,
      activeSessions
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

workflowRouter.get('/:id/runs', async (req: any, res) => {
  try {
    const runs = await prisma.run.findMany({
      where: { workflowId: req.params.id, triggeredById: req.userId },
      include: {
        logs: { orderBy: { stepIndex: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

workflowRouter.post('/', async (req: any, res) => {
  try {
    const payload = workflowSchema.parse(req.body);

    const workflow = await prisma.workflow.create({
      data: {
        name: payload.name,
        description: payload.description,
        userId: req.userId,
        steps: payload.steps as any,
        maxRetries: payload.maxRetries
      }
    });

    res.status(201).json(workflow);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

workflowRouter.get('/:id', async (req: any, res) => {
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id, userId: req.userId }
    });
    if (!workflow) return res.status(404).json({ error: 'Not found' });
    res.json(workflow);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

workflowRouter.post('/:id/run', async (req: any, res) => {
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id, userId: req.userId }
    });

    if (!workflow) return res.status(404).json({ error: 'Not found' });

    const run = await prisma.run.create({
      data: {
        workflowId: workflow.id,
        triggeredById: req.userId,
        status: 'QUEUED'
      }
    });

    await workflowQueue.add('run', {
      runId: run.id,
      stepsJson: workflow.steps,
      maxRetries: workflow.maxRetries
    });

    res.status(202).json(run);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
