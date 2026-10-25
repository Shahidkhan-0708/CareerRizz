import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { logger } from '../../../utils/logger.js';

/**
 * Enhanced Playwright Live Desktop Bot
 * Multi-pass intelligent form completion covering Ashby, Greenhouse, Lever, and Workday.
 */
export async function launchLivePlaywrightApplier(options) {
  const {
    jobUrl,
    candidateData = {},
    resumePath = null,
    headless = false,
    autoSubmit = false,
  } = options;

  if (!jobUrl) {
    throw new Error('jobUrl is required to launch live applier');
  }

  logger.info(`[Playwright Live Bot] Launching visible browser for: ${jobUrl}`);

  const browser = await chromium.launch({
    headless: headless,
    slowMo: 40, // Smooth humanized pacing so user sees the typing
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: null, // Full screen view
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // 1. Navigate to target portal
    logger.info(`[Playwright Live Bot] Navigating to ${jobUrl}...`);
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Allow dynamic single-page ATS frameworks (Ashby / React / Greenhouse) to mount
    await page.waitForTimeout(2500);

    // Profile data
    const firstName = candidateData.first_name || candidateData.firstName || 'Shahid';
    const lastName = candidateData.last_name || candidateData.lastName || 'Khan';
    const fullName = candidateData.name || `${firstName} ${lastName}`;
    const email = candidateData.email || 'shahidkhan07191@gmail.com';
    const phone = candidateData.phone || '+91-9876543210';
    const location = candidateData.location || 'India';
    const currentCompany = candidateData.currentCompany || 'Freelance / Open Source';
    const linkedin = candidateData.linkedin || 'https://www.linkedin.com/in/shahid';
    const github = candidateData.github || 'https://github.com/shahid';
    const portfolio = candidateData.portfolio || candidateData.website || 'https://github.com/shahid';
    const summary = candidateData.summary || 'Full-stack & AI engineer with hands-on experience in Node.js, TypeScript, Python, distributed systems, and modern web architectures.';

    const fieldsFilled = [];

    // Visual highlighter helper
    async function highlight(el) {
      try {
        await el.evaluate((node) => {
          node.style.outline = '2px solid #10b981';
          node.style.backgroundColor = '#ecfdf5';
        });
      } catch {
        // ignore highlight styling errors
      }
    }

    // Smart filler helper by selectors
    async function fillBySelectors(selectors, value, fieldName) {
      if (!value) return false;
      for (const sel of selectors) {
        try {
          const els = await page.$$(sel);
          for (const el of els) {
            if (await el.isVisible()) {
              await el.scrollIntoViewIfNeeded();
              const currentVal = await el.inputValue().catch(() => '');
              if (!currentVal) {
                await el.click();
                await el.fill(value);
                await highlight(el);
                fieldsFilled.push(fieldName);
                return true;
              }
            }
          }
        } catch {
          // continue
        }
      }
      return false;
    }

    // Smart filler helper by searching nearby label text
    async function fillByLabelText(labelTextMatch, value, fieldName) {
      if (!value) return false;
      try {
        const labels = await page.$$('label, span, div');
        for (const label of labels) {
          const text = (await label.innerText().catch(() => '')).trim();
          if (new RegExp(`^${labelTextMatch}`, 'i').test(text) || new RegExp(`\\b${labelTextMatch}\\b`, 'i').test(text)) {
            // Find input inside or immediately after label
            const input = await label.$('input, textarea');
            if (input && await input.isVisible()) {
              const currentVal = await input.inputValue().catch(() => '');
              if (!currentVal) {
                await input.scrollIntoViewIfNeeded();
                await input.fill(value);
                await highlight(input);
                fieldsFilled.push(fieldName);
                return true;
              }
            }
          }
        }
      } catch {
        // continue
      }
      return false;
    }

    // --- PASS 1: CORE IDENTITY FIELDS ---

    // First Name
    await fillBySelectors([
      'input[name*="first_name" i]',
      'input[name*="firstName" i]',
      'input[id*="first_name" i]',
      'input[aria-label*="First Name" i]',
      'input[placeholder*="First Name" i]',
    ], firstName, 'First Name');

    // Last Name
    await fillBySelectors([
      'input[name*="last_name" i]',
      'input[name*="lastName" i]',
      'input[id*="last_name" i]',
      'input[aria-label*="Last Name" i]',
      'input[placeholder*="Last Name" i]',
    ], lastName, 'Last Name');

    // Full Name (if individual first/last not present)
    await fillBySelectors([
      'input[name="name"]',
      'input[name="fullName"]',
      'input[id="name"]',
      'input[placeholder*="Full Name" i]',
      'input[aria-label*="Full Name" i]',
      'input[name*="candidate_name" i]',
    ], fullName, 'Full Name');

    // Email
    await fillBySelectors([
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[placeholder*="Email" i]',
      'input[aria-label*="Email" i]',
    ], email, 'Email');

    // Phone
    await fillBySelectors([
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[placeholder*="Phone" i]',
      'input[aria-label*="Phone" i]',
    ], phone, 'Phone');

    // --- PASS 2: LOCATION & EMPLOYMENT CONTEXT ---

    await fillBySelectors([
      'input[name*="location" i]',
      'input[id*="location" i]',
      'input[placeholder*="City" i]',
      'input[placeholder*="Location" i]',
      'input[aria-label*="Location" i]',
      'input[aria-label*="City" i]',
    ], location, 'Location');

    await fillBySelectors([
      'input[name*="company" i]',
      'input[id*="company" i]',
      'input[placeholder*="Company" i]',
      'input[aria-label*="Current Company" i]',
    ], currentCompany, 'Current Company');

    // --- PASS 3: SOCIAL & PORTFOLIO URLS ---

    // LinkedIn
    await fillBySelectors([
      'input[name*="linkedin" i]',
      'input[name*="urls[LinkedIn]" i]',
      'input[id*="linkedin" i]',
      'input[placeholder*="LinkedIn" i]',
      'input[aria-label*="LinkedIn" i]',
    ], linkedin, 'LinkedIn');

    // GitHub
    await fillBySelectors([
      'input[name*="github" i]',
      'input[name*="urls[GitHub]" i]',
      'input[id*="github" i]',
      'input[placeholder*="GitHub" i]',
      'input[aria-label*="GitHub" i]',
    ], github, 'GitHub');

    // Portfolio / Website
    await fillBySelectors([
      'input[name*="portfolio" i]',
      'input[name*="website" i]',
      'input[name*="urls[Portfolio]" i]',
      'input[name*="urls[Website]" i]',
      'input[placeholder*="Portfolio" i]',
      'input[placeholder*="Website" i]',
      'input[aria-label*="Portfolio" i]',
    ], portfolio, 'Portfolio');

    // --- PASS 4: TEXTAREAS (COVER LETTER / SUMMARY) ---

    await fillBySelectors([
      'textarea[name*="cover_letter" i]',
      'textarea[id*="cover_letter" i]',
      'textarea[placeholder*="Cover Letter" i]',
      'textarea[name*="summary" i]',
      'textarea[name*="comments" i]',
      'textarea[name*="additional" i]',
    ], summary, 'Cover Letter / Summary');

    // --- PASS 5: COMMON ATS SCREENING QUESTIONS (WORK AUTH / SPONSORSHIP) ---

    try {
      // Find all radio buttons & checkboxes
      const options = await page.$$('input[type="radio"], input[type="checkbox"]');
      for (const opt of options) {
        const parent = await opt.evaluateHandle((node) => node.closest('label') || node.parentElement);
        const text = (await parent.evaluate((node) => node?.innerText || '')).toLowerCase();

        // 1. Authorized to work: Click "Yes"
        if (text.includes('authorized to work') || text.includes('legally authorized')) {
          if (text.includes('yes')) {
            await opt.click();
            fieldsFilled.push('Work Authorization (Yes)');
          }
        }
        // 2. Visa sponsorship required: Click "No"
        if (text.includes('sponsorship') || text.includes('require visa')) {
          if (text.includes('no')) {
            await opt.click();
            fieldsFilled.push('Visa Sponsorship (No)');
          }
        }
        // 3. Privacy Policy / Consent terms: Check box
        if (text.includes('agree') || text.includes('privacy') || text.includes('consent') || text.includes('terms')) {
          const isChecked = await opt.isChecked().catch(() => false);
          if (!isChecked) {
            await opt.check();
            fieldsFilled.push('Consent / Privacy Agreement');
          }
        }
      }
    } catch {
      // radio evaluation safe fallback
    }

    // --- PASS 6: STANDARD DROPDOWNS (<select>) ---

    try {
      const selects = await page.$$('select');
      for (const sel of selects) {
        const label = (await sel.evaluate((node) => {
          const l = node.closest('label') || document.querySelector(`label[for="${node.id}"]`);
          return l ? l.innerText : (node.name || '');
        })).toLowerCase();

        // Work Auth dropdown
        if (label.includes('authorized') || label.includes('work authorization')) {
          await sel.selectOption({ label: 'Yes' }).catch(() => sel.selectOption({ index: 1 }));
          fieldsFilled.push('Dropdown: Work Auth (Yes)');
        }
        // Sponsorship dropdown
        else if (label.includes('sponsorship') || label.includes('require')) {
          await sel.selectOption({ label: 'No' }).catch(() => sel.selectOption({ index: 2 }));
          fieldsFilled.push('Dropdown: Sponsorship (No)');
        }
        // EEO / Gender
        else if (label.includes('gender')) {
          await sel.selectOption({ label: 'Male' }).catch(() => sel.selectOption({ index: 1 }));
          fieldsFilled.push('Dropdown: Gender');
        }
        // EEO / Veteran
        else if (label.includes('veteran')) {
          await sel.selectOption({ label: 'I am not a protected veteran' }).catch(() => sel.selectOption({ index: 1 }));
          fieldsFilled.push('Dropdown: Veteran');
        }
        // EEO / Disability
        else if (label.includes('disability')) {
          await sel.selectOption({ label: 'No, I do not have a disability' }).catch(() => sel.selectOption({ index: 2 }));
          fieldsFilled.push('Dropdown: Disability');
        }
      }
    } catch {
      // select fallback
    }

    // --- PASS 7: RESUME FILE UPLOAD (VISIBLE OR HIDDEN) ---

    let resumeAttached = false;
    let actualResumePath = resumePath;

    if (!actualResumePath) {
      const candidateDocs = [
        path.resolve('RESUME_ATS_FAANG.md'),
        path.resolve('test/email_personalization_test_dataset.pdf'),
      ];
      for (const doc of candidateDocs) {
        if (fs.existsSync(doc)) {
          actualResumePath = doc;
          break;
        }
      }
    }

    if (actualResumePath && fs.existsSync(actualResumePath)) {
      try {
        // Set file on all input[type="file"] regardless of visibility
        const fileInputs = await page.$$('input[type="file"]');
        for (const input of fileInputs) {
          await input.setInputFiles(actualResumePath);
          resumeAttached = true;
          fieldsFilled.push('Resume File Attached');
          logger.info(`[Playwright Live Bot] Attached resume from ${actualResumePath}`);
          break;
        }
      } catch (fileErr) {
        logger.warn('[Playwright Live Bot] File upload notice:', { error: fileErr.message });
      }
    }

    // --- PASS 8: LOCATE & GLOW SUBMIT BUTTON ---

    const submitBtnSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit Application")',
      'button:has-text("Submit application")',
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      '#submit_app',
      'button[data-qa="submit-application"]',
    ];

    let submitButton = null;
    for (const sel of submitBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          submitButton = btn;
          await btn.scrollIntoViewIfNeeded();
          await btn.evaluate((node) => {
            node.style.outline = '4px solid #10b981';
            node.style.boxShadow = '0 0 30px rgba(16, 185, 129, 0.9)';
            node.style.transform = 'scale(1.03)';
            node.style.transition = 'all 0.3s ease';
          });
          break;
        }
      } catch {
        // next selector
      }
    }

    // --- PASS 9: INJECT FLOATING CAREERRIZZ STATUS BANNER ---

    await page.evaluate(({ fields, hasResume, autoSubmitted }) => {
      const banner = document.createElement('div');
      banner.id = 'careerrizz-live-banner';
      banner.style.position = 'fixed';
      banner.style.bottom = '24px';
      banner.style.right = '24px';
      banner.style.zIndex = '99999999';
      banner.style.background = '#0f172a';
      banner.style.color = '#ffffff';
      banner.style.padding = '18px 22px';
      banner.style.borderRadius = '14px';
      banner.style.border = '2px solid #10b981';
      banner.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.5)';
      banner.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      banner.style.fontSize = '13px';
      banner.style.lineHeight = '1.5';
      banner.style.maxWidth = '360px';

      banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="display:inline-block; width:10px; height:10px; background:#10b981; border-radius:50%; box-shadow:0 0 10px #10b981;"></span>
          <strong style="color:#10b981; font-size:15px;">CareerRizz Live Bot</strong>
        </div>
        <div style="color:#e2e8f0; margin-bottom:8px; font-weight:500;">
          ${autoSubmitted 
            ? 'Application auto-submitted successfully!' 
            : 'All available fields have been auto-filled! Please review any company-specific questions and click the glowing <strong style="color:#10b981;">Submit</strong> button.'}
        </div>
        <div style="font-size:11px; color:#94a3b8; background:rgba(255,255,255,0.06); padding:8px 10px; border-radius:8px;">
          <strong style="color:#f8fafc;">Completed:</strong> ${fields.length > 0 ? fields.join(', ') : 'Ready'}<br>
          <strong style="color:#f8fafc;">Resume:</strong> ${hasResume ? 'Attached' : 'Please drag & drop your resume'}
        </div>
      `;
      document.body.appendChild(banner);
    }, { fields: [...new Set(fieldsFilled)], hasResume: resumeAttached, autoSubmitted: autoSubmit });

    // Optional auto-submit
    if (autoSubmit && submitButton) {
      logger.info('[Playwright Live Bot] autoSubmit enabled — submitting form now...');
      await page.waitForTimeout(2000);
      await submitButton.click();
    }

    logger.info(`[Playwright Live Bot] Auto-filled ${fieldsFilled.length} fields on ${jobUrl}. Browser remaining active.`);

    return {
      success: true,
      fieldsFilled: [...new Set(fieldsFilled)],
      resumeAttached,
      message: `Auto-filled ${fieldsFilled.length} fields live on your desktop!`,
    };
  } catch (err) {
    logger.error('[Playwright Live Bot] Execution error:', { error: err.message });
    throw err;
  }
}
