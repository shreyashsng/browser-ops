import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { workflowRouter } from './routes/workflow';
import { artifactsRouter } from './routes/artifacts';
import { sessionRouter } from './routes/sessions';

const app = express();
const port = process.env.PORT || 4000;

import path from 'path';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

app.use('/auth', authRouter);
app.use('/workflows', workflowRouter);
app.use('/artifacts', artifactsRouter);
app.use('/sessions', sessionRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: '@browser-ops/api' });
});

app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
