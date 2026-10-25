import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getSupabaseClient } from '../../../db/client.js';

export interface CandidateFormData {
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  email: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  [key: string]: any;
}

export interface FormSubmitterInput {
  applicationUrl: string;
  candidateData: CandidateFormData;
  resumePath: string;
  applicationId?: string;
}

export interface FormSubmitterResult {
  status: 'READY_TO_SUBMIT' | 'FAILED';
  screenshotBase64: string;
  submitButtonDetected: boolean;
  fieldsFilled: string[];
  error?: string;
}

/**
 * Humanized typing with randomized per-character delay between 50ms and 150ms.
 */
async function humanType(page: Page, selector: string, value: string): Promise<void> {
  const element = await page.$(selector);
  if (!element) return;

  await element.click();
  for (const char of value) {
    const delay = Math.floor(Math.random() * (150 - 50 + 1)) + 50;
    await page.type(selector, char, { delay });
  }
}

/**
 * Automates physical form entry up to the pre-submission verification stage.
 */
export async function executeFormStaging(input: FormSubmitterInput): Promise<FormSubmitterResult> {
  const { applicationUrl, candidateData, resumePath, applicationId } = input;
  const fieldsFilled: string[] = [];

  // Verify resume file existence
  const resolvedResume = path.resolve(resumePath);
  if (!fs.existsSync(resolvedResume)) {
    throw new Error(`Resume file not found at path: ${resolvedResume}`);
  }

  const browser: Browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  try {
    // 1. Navigate to target portal and wait for network idle
    await page.goto(applicationUrl, {
      waitUntil: 'networkidle',
      timeout: 45000,
    });

    // 2. Field Resolution & Input Simulation
    const firstName = candidateData.first_name || candidateData.firstName || '';
    const lastName = candidateData.last_name || candidateData.lastName || '';
    const email = candidateData.email || '';
    const phone = candidateData.phone || '';

    // First Name
    if (firstName) {
      const fnSelector = 'input[name*="first_name" i], input[name*="firstName" i], input#first_name, input[aria-label*="First Name" i]';
      const el = await page.$(fnSelector);
      if (el) {
        await humanType(page, fnSelector, firstName);
        fieldsFilled.push('first_name');
      }
    }

    // Last Name
    if (lastName) {
      const lnSelector = 'input[name*="last_name" i], input[name*="lastName" i], input#last_name, input[aria-label*="Last Name" i]';
      const el = await page.$(lnSelector);
      if (el) {
        await humanType(page, lnSelector, lastName);
        fieldsFilled.push('last_name');
      }
    }

    // Email
    if (email) {
      const emailSelector = 'input[type="email"], input[name*="email" i], input#email, input[aria-label*="Email" i]';
      const el = await page.$(emailSelector);
      if (el) {
        await humanType(page, emailSelector, email);
        fieldsFilled.push('email');
      }
    }

    // Phone
    if (phone) {
      const phoneSelector = 'input[type="tel"], input[name*="phone" i], input#phone, input[aria-label*="Phone" i]';
      const el = await page.$(phoneSelector);
      if (el) {
        await humanType(page, phoneSelector, phone);
        fieldsFilled.push('phone');
      }
    }

    // 3. File Upload Simulation
    const fileSelector = 'input[type="file"][name*="resume" i], input[type="file"][name*="cv" i], input[type="file"]';
    const fileInput = await page.$(fileSelector);
    if (fileInput) {
      await fileInput.setInputFiles(resolvedResume);
      fieldsFilled.push('resume_file');
    }

    // 4. Locate Submission Button (Safety Gate: DO NOT CLICK)
    const submitBtnSelector =
      'button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit"), button:has-text("Apply")';
    const submitBtn = await page.$(submitBtnSelector);
    const submitButtonDetected = submitBtn !== null;

    // Small stabilization pause
    await page.waitForTimeout(1000);

    // 5. Capture Full-Page Base64 Screenshot for Verification
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    // 6. Persist status in Supabase if applicationId provided
    try {
      const supabase = getSupabaseClient();
      if (supabase && applicationId) {
        await supabase
          .from('applications')
          .update({
            status: 'READY_TO_SUBMIT',
            notes: `Form staged automatically. Fields detected: ${fieldsFilled.join(', ')}`,
            metadata: {
              submitButtonDetected,
              stagedAt: new Date().toISOString(),
              screenshotSample: screenshotBase64.slice(0, 200) + '...',
            },
          })
          .eq('id', applicationId);
      }
    } catch (dbErr) {
      console.warn('[form-submitter] Could not update Supabase state:', (dbErr as Error).message);
    }

    await browser.close();

    return {
      status: 'READY_TO_SUBMIT',
      screenshotBase64,
      submitButtonDetected,
      fieldsFilled,
    };
  } catch (err) {
    await browser.close();
    return {
      status: 'FAILED',
      screenshotBase64: '',
      submitButtonDetected: false,
      fieldsFilled,
      error: (err as Error).message,
    };
  }
}
