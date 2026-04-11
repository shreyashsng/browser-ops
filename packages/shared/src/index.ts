import { z } from 'zod';

export const stepActionSchema = z.enum([
  'goto',
  'click',
  'type',
  'wait',
  'extract',
  'screenshot',
  'scroll',
  'select',
  'upload'
]);

export const workflowStepSchema = z.object({
  action: stepActionSchema,
  selector: z.string().optional(),
  url: z.string().optional(),
  value: z.string().optional(),
  timeout: z.number().optional()
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  steps: z.array(workflowStepSchema),
  maxRetries: z.number().optional().default(0)
});

export type Workflow = z.infer<typeof workflowSchema>;
