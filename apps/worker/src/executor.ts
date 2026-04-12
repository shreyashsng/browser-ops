import { chromium, Page } from 'playwright';
import { prisma } from '@browser-ops/db';
import { WorkflowStep } from '@browser-ops/shared';

// Converts the generic steps into Playwright commands
export async function executeWorkflowSteps(runId: string, steps: WorkflowStep[], maxRetries: number = 0) {
  console.log(`[Executor] Starting run ${runId} with maxRetries: ${maxRetries}`);

  const browser = await chromium.launch({ headless: false }); // User requested headed mode initially

  // Phase 6: Session Vault Injection
  // ... (rest of session logic)
  let storageState: any = undefined;
  try {
    const runData = await prisma.run.findUnique({ where: { id: runId } });
    if (runData?.triggeredById) {
      const session = await prisma.session.findFirst({
        where: { userId: runData.triggeredById },
        orderBy: { createdAt: 'desc' }
      });
      if (session && session.encryptedCookies) {
        const parsedCookies = JSON.parse(session.encryptedCookies);
        if (Array.isArray(parsedCookies)) {
          const sanitizedCookies = parsedCookies.map((c: any) => {
            // Playwright strictly requires SameSite to be "Strict", "Lax", or "None"
            let sameSite = 'Lax';
            if (c.sameSite && typeof c.sameSite === 'string') {
              const normalized = c.sameSite.charAt(0).toUpperCase() + c.sameSite.slice(1).toLowerCase();
              if (['Strict', 'Lax', 'None'].includes(normalized)) {
                sameSite = normalized;
              } else if (normalized === 'No_restriction' || normalized === 'Unspecified') {
                sameSite = 'None';
              }
            }

            return {
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path || '/',
              expires: typeof c.expires === 'number' ? c.expires : undefined,
              httpOnly: Boolean(c.httpOnly),
              secure: sameSite === 'None' ? true : Boolean(c.secure), // sameSite 'None' strictly requires 'secure'
              sameSite: sameSite
            };
          });

          storageState = { cookies: sanitizedCookies, origins: [] };
          console.log(`[Executor] Injected session cookies for domain ${session.domain}`);
        }
      }
    }
  } catch (err) {
    console.error(`[Executor] Failed to parse injected cookies:`, err);
  }

  const context = await browser.newContext(storageState ? { storageState } : undefined);
  const page = await context.newPage();

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      let status = 'SUCCESS';
      let message = `Executed ${step.action}`;
      const startedAt = new Date();

      let lastError = null;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Executor] Executing step ${i + 1} (Attempt ${attempt}/${maxRetries})`);
          await executeStepAction(page, step);
          status = 'SUCCESS';
          message = `Executed ${step.action} in ${attempt} attempt(s)`;

          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          console.error(
            `[Executor] Step ${i + 1} failed on attempt ${attempt}: ${err.message}`
          );

          if (attempt < maxRetries) {
            console.log(
              `[Executor] Retrying step ${i + 1} (Next attempt: ${attempt + 1}/${maxRetries})`
            );

            // exponential backoff (better than linear)
            const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
            await page.waitForTimeout(delay);

          } else {
            // FINAL FAILURE
            status = 'FAILED';
            message = `Step ${i + 1} failed after ${maxRetries} attempts: ${err.message}`;

            throw new Error(message);
          }
        }
      }

      // Step Screenshot Capture
      const finishedAt = new Date();
      let screenshotUrl = null;
      try {
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        const formData = new FormData();
        formData.append('runId', runId);
        formData.append('stepIndex', i.toString());
        formData.append('screenshot', new Blob([screenshotBuffer as any]), 'screenshot.png');

        const apiUrl = process.env.API_URL || 'http://localhost:4000';
        const uploadRes = await fetch(`${apiUrl}/artifacts/upload`, {
          method: 'POST',
          body: formData
        });

        if (uploadRes.ok) {
          const artifactData = await uploadRes.json();
          screenshotUrl = artifactData.fileUrl;
        }
      } catch (uploadErr) {
        console.error('Failed to capture or upload screenshot', uploadErr);
      }

      // Log the step to the database
      await prisma.stepLog.create({
        data: {
          runId,
          stepIndex: i,
          action: step.action,
          status: status as any,
          message,
          inputJson: JSON.parse(JSON.stringify(step)),
          screenshotUrl,
          startedAt,
          finishedAt
        }
      });

      if (status === 'FAILED') {
        throw new Error(`Run failed at step ${i}`);
      }
    }

    // Success update
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'SUCCESS', finishedAt: new Date() }
    });

  } catch (error: any) {
    console.error(`[Executor] Run ${runId} Failed:`, error.message);
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'FAILED', errorMessage: error.message, finishedAt: new Date() }
    });
  } finally {
    await browser.close();
  }
}

async function executeStepAction(page: Page, step: WorkflowStep) {
  const timeout = step.timeout || 30000;
  switch (step.action) {
    case 'goto':
      if (!step.url) throw new Error("URL is required for 'goto' action");
      await page.goto(step.url, { timeout });
      break;
    case 'click':
      if (!step.selector) throw new Error("Selector is required for 'click' action");
      await page.click(step.selector, { timeout });
      break;
    case 'type':
      if (!step.selector || step.value === undefined) throw new Error("Selector and Value required for 'type' action");
      await page.fill(step.selector, step.value, { timeout });
      break;
    case 'wait':
      if (!step.timeout) throw new Error("Timeout required for 'wait' action");
      await page.waitForTimeout(step.timeout);
      break;
    default:
      throw new Error(`Action ${step.action} is not yet implemented.`);
  }
}
