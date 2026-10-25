/**
 * CareerRizz Chrome Extension - ATS Application Auto-Filler
 * Runs directly inside your browser on Greenhouse, Lever, Ashby, and Workday tabs.
 * Injects a floating auto-fill button that instantly populates candidate details into the form.
 */

(function initCareerRizzAutoFiller() {
  if (document.getElementById('careerrizz-autofill-btn')) return;

  console.log('[CareerRizz Extension] ATS Job Portal detected. Initializing Auto-Filler.');

  const candidateProfile = {
    firstName: 'Shahid',
    lastName: 'Khan',
    fullName: 'Shahid Khan',
    email: 'shahidkhan07191@gmail.com',
    phone: '+91-9876543210',
    location: 'India',
    company: 'Freelance / Open Source',
    linkedin: 'https://www.linkedin.com/in/shahid',
    github: 'https://github.com/shahid',
    portfolio: 'https://github.com/shahid',
    summary: 'Full-stack & AI engineer with hands-on experience in Node.js, TypeScript, Python, distributed systems, and modern web architectures.',
  };

  // 1. Create Floating Action Widget
  const widget = document.createElement('div');
  widget.id = 'careerrizz-autofill-widget';
  widget.style.position = 'fixed';
  widget.style.bottom = '20px';
  widget.style.right = '20px';
  widget.style.zIndex = '99999999';
  widget.style.display = 'flex';
  widget.style.flexDirection = 'column';
  widget.style.alignItems = 'flex-end';
  widget.style.gap = '8px';
  widget.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

  const btn = document.createElement('button');
  btn.id = 'careerrizz-autofill-btn';
  btn.innerHTML = `
    <span style="font-size:16px;">⚡</span>
    <span style="font-weight:700;">CareerRizz Auto-Fill</span>
  `;
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.gap = '8px';
  btn.style.backgroundColor = '#0f172a';
  btn.style.color = '#10b981';
  btn.style.border = '2px solid #10b981';
  btn.style.padding = '12px 18px';
  btn.style.borderRadius = '9999px';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '13px';
  btn.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.4)';
  btn.style.transition = 'all 0.2s ease';

  btn.onmouseenter = () => {
    btn.style.transform = 'translateY(-2px)';
    btn.style.boxShadow = '0 15px 30px rgba(16, 185, 129, 0.3)';
  };
  btn.onmouseleave = () => {
    btn.style.transform = 'none';
    btn.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.4)';
  };

  btn.onclick = () => {
    executeFormFill();
  };

  widget.appendChild(btn);
  document.body.appendChild(widget);

  // 2. Comprehensive Multi-Pass Form Autofill Logic
  function executeFormFill() {
    let filledCount = 0;

    function fillInput(selectors, value) {
      if (!value) return false;
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el && el.offsetParent !== null) { // visible check
            if (!el.value) {
              el.focus();
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.style.outline = '2px solid #10b981';
              el.style.backgroundColor = '#ecfdf5';
              filledCount++;
              return true;
            }
          }
        }
      }
      return false;
    }

    // Name
    const hasFn = fillInput([
      'input[name*="first_name" i]',
      'input[name*="firstName" i]',
      'input#first_name',
      'input[aria-label*="First Name" i]',
      'input[placeholder*="First Name" i]',
    ], candidateProfile.firstName);

    if (hasFn) {
      fillInput([
        'input[name*="last_name" i]',
        'input[name*="lastName" i]',
        'input#last_name',
        'input[aria-label*="Last Name" i]',
        'input[placeholder*="Last Name" i]',
      ], candidateProfile.lastName);
    } else {
      fillInput(['input[name="name"]', 'input[name="fullName"]', 'input#name', 'input[placeholder*="Full Name" i]'], candidateProfile.fullName);
    }

    // Email
    fillInput([
      'input[type="email"]',
      'input[name*="email" i]',
      'input#email',
      'input[aria-label*="Email" i]',
      'input[placeholder*="Email" i]',
    ], candidateProfile.email);

    // Phone
    fillInput([
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input#phone',
      'input[aria-label*="Phone" i]',
      'input[placeholder*="Phone" i]',
    ], candidateProfile.phone);

    // Location / City
    fillInput([
      'input[name*="location" i]',
      'input[id*="location" i]',
      'input[placeholder*="Location" i]',
      'input[placeholder*="City" i]',
    ], candidateProfile.location);

    // Current Company
    fillInput([
      'input[name*="company" i]',
      'input[id*="company" i]',
      'input[placeholder*="Company" i]',
    ], candidateProfile.company);

    // URLs
    fillInput(['input[name*="linkedin" i]', 'input[name*="urls[LinkedIn]" i]', 'input[placeholder*="LinkedIn" i]'], candidateProfile.linkedin);
    fillInput(['input[name*="github" i]', 'input[name*="urls[GitHub]" i]', 'input[placeholder*="GitHub" i]'], candidateProfile.github);
    fillInput(['input[name*="portfolio" i]', 'input[name*="website" i]', 'input[placeholder*="Website" i]'], candidateProfile.portfolio);

    // Textareas (Summary / Cover Letter)
    fillInput([
      'textarea[name*="cover_letter" i]',
      'textarea[name*="summary" i]',
      'textarea[name*="comments" i]',
      'textarea[placeholder*="Cover Letter" i]',
    ], candidateProfile.summary);

    // Auto-select common radio buttons (Visa Sponsorship: No, Authorized: Yes, Privacy: Checked)
    const radios = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    radios.forEach((radio) => {
      const parentText = (radio.parentElement?.innerText || '').toLowerCase();
      if ((parentText.includes('authorized to work') || parentText.includes('legally authorized')) && parentText.includes('yes')) {
        radio.click();
        filledCount++;
      }
      if ((parentText.includes('sponsorship') || parentText.includes('require visa')) && parentText.includes('no')) {
        radio.click();
        filledCount++;
      }
      if (parentText.includes('privacy') || parentText.includes('agree') || parentText.includes('consent') || parentText.includes('terms')) {
        if (!radio.checked) {
          radio.click();
          filledCount++;
        }
      }
    });

    // Auto-select dropdowns (<select>)
    const selects = document.querySelectorAll('select');
    selects.forEach((sel) => {
      const label = (sel.closest('label')?.innerText || sel.name || '').toLowerCase();
      if (label.includes('authorized') || label.includes('work authorization')) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.toLowerCase().includes('yes')) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
            break;
          }
        }
      } else if (label.includes('sponsorship') || label.includes('require visa')) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.toLowerCase().includes('no')) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
            break;
          }
        }
      }
    });

    // Highlight Submit Button
    const submitBtns = document.querySelectorAll(
      'button[type="submit"], input[type="submit"], button:has-text("Submit Application"), #submit_app'
    );
    submitBtns.forEach((b) => {
      b.style.outline = '4px solid #10b981';
      b.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.8)';
    });

    // Success state on floating button
    btn.innerHTML = `
      <span style="font-size:16px;">✓</span>
      <span style="font-weight:700;">Auto-Filled (${filledCount} fields)!</span>
    `;
    btn.style.backgroundColor = '#10b981';
    btn.style.color = '#ffffff';

    setTimeout(() => {
      btn.innerHTML = `
        <span style="font-size:16px;">⚡</span>
        <span style="font-weight:700;">CareerRizz Auto-Fill</span>
      `;
      btn.style.backgroundColor = '#0f172a';
      btn.style.color = '#10b981';
    }, 4000);
  }

  // Auto-run if clearly on an application form
  if (window.location.href.includes('jobs') || window.location.href.includes('apply')) {
    setTimeout(executeFormFill, 1800);
  }
})();
