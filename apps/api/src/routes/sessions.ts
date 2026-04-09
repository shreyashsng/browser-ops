import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@browser-ops/db';

import { authMiddleware } from './workflow';

export const sessionRouter = Router();
sessionRouter.use(authMiddleware);

const sessionSchema = z.object({
  domain: z.string(),
  cookiesJson: z.string() // stringified JSON array
});

sessionRouter.get('/', async (req: any, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' }
    });
    
    // Do not return raw cookies to UI for security, just metadata
    const safeSessions = sessions.map(s => ({
      id: s.id,
      domain: s.domain,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));

    res.json(safeSessions);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

sessionRouter.post('/', async (req: any, res) => {
  try {
    const { domain, cookiesJson } = sessionSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Upsert session
    const existing = await prisma.session.findFirst({
      where: { userId: user.id, domain }
    });

    if (existing) {
      const updated = await prisma.session.update({
        where: { id: existing.id },
        data: { encryptedCookies: cookiesJson, encryptedStorageState: '{}' }
      });
      return res.status(200).json({ id: updated.id, domain: updated.domain });
    }

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        domain,
        encryptedCookies: cookiesJson,
        encryptedStorageState: '{}'
      }
    });

    res.status(201).json({ id: session.id, domain: session.domain });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
