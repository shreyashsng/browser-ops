import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '@browser-ops/db';
import { z } from 'zod';

const artifactsRouter = Router();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.png');
  }
});

const upload = multer({ storage });

artifactsRouter.post('/upload', upload.single('screenshot'), async (req, res) => {
  try {
    const { runId, stepIndex } = req.body;
    const file = req.file;

    if (!file || !runId) {
      return res.status(400).json({ error: 'Screenshot file and runId are required' });
    }

    // Determine absolute URL
    const fileUrl = `http://localhost:4000/uploads/${file.filename}`;

    // Optionally attach to a specific step log if stepIndex is provided
    if (stepIndex !== undefined) {
      await prisma.stepLog.updateMany({
        where: { runId, stepIndex: parseInt(stepIndex, 10) },
        data: { screenshotUrl: fileUrl }
      });
    }

    res.status(201).json({ fileUrl });
  } catch (err: any) {
    console.error('Artifact upload error:', err);
    res.status(500).json({ error: 'Failed to upload artifact' });
  }
});

export { artifactsRouter };
