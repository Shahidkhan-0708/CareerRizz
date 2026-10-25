/// <reference types="chrome" />

/**
 * CareerRizz Chrome Extension - Background Service Worker (Manifest V3)
 * Polls the local/internal API for approved outreach tasks and injects them
 * into active, authenticated browser sessions.
 */

const API_POLL_URL = 'http://localhost:5000/api/outreach/pending-task';
const ALARM_NAME = 'POLL_OUTREACH_TASKS';
const POLL_INTERVAL_MINUTES = 1; // 60 seconds

interface OutreachTaskResponse {
  status: 'APPROVED' | 'NO_TASK';
  targetUrl?: string;
  messageText?: string;
  taskId?: string;
}

// 1. Initialize Alarm on Installation or Startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('[CareerRizz Bridge] Extension installed. Setting up task polling alarm.');
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: POLL_INTERVAL_MINUTES,
    delayInMinutes: 0.1, // Start shortly after install
  });
});

// 2. Listen to Alarm and Trigger Task Pull Loop
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollPendingOutreachTask();
  }
});

/**
 * Step A: Hits /api/outreach/pending-task every 60 seconds
 */
async function pollPendingOutreachTask(): Promise<void> {
  try {
    const res = await fetch(API_POLL_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-bypass-auth': 'true', // Local dev bridge header
      },
    });

    if (!res.ok) {
      if (res.status !== 404 && res.status !== 204) {
        console.warn(`[CareerRizz Bridge] Server responded with status ${res.status}`);
      }
      return;
    }

    const data: OutreachTaskResponse = await res.json();

    // Step B: Verify Data Contract
    if (data && data.status === 'APPROVED' && data.targetUrl && data.messageText) {
      console.log(`[CareerRizz Bridge] Approved task received for target: ${data.targetUrl}`);
      await executeOutreachTask(data.targetUrl, data.messageText);
    }
  } catch (err) {
    // Fails silently if backend is offline/sleeping
    console.debug('[CareerRizz Bridge] Polling heartbeat tick:', (err as Error).message);
  }
}

/**
 * Step C: Open Tab, Wait for Load, and Inject DOM Execution Sequence
 */
async function executeOutreachTask(targetUrl: string, messageText: string): Promise<void> {
  // 1. Create a new tab with the target URL
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });

  if (!tab.id) return;
  const tabId = tab.id;

  // 2. Wait until the tab completes loading
  const onTabUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(onTabUpdated);

      // 3. Inject Content Execution Script
      chrome.scripting.executeScript({
        target: { tabId },
        func: injectMessageModalSequence,
        args: [messageText],
      });
    }
  };

  chrome.tabs.onUpdated.addListener(onTabUpdated);
}

/**
 * Injected into the target page. Finds message modal, fills text, and halts for manual send.
 */
function injectMessageModalSequence(textToType: string): void {
  console.log('[CareerRizz DOM Script] Starting automated DOM injection sequence.');

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function runSequence() {
    // 1. Locate and Click Message button if not already open
    const messageBtnSelectors = [
      'button.message-anywhere-button',
      'button[aria-label*="Message" i]',
      'button:has-text("Message")',
      '.entry-point button',
    ];

    let messageButton: HTMLElement | null = null;
    for (const sel of messageBtnSelectors) {
      messageButton = document.querySelector(sel) as HTMLElement;
      if (messageButton) break;
    }

    if (messageButton) {
      console.log('[CareerRizz DOM Script] Found message trigger button. Clicking...');
      messageButton.click();
      await sleep(1500); // Allow modal to mount
    }

    // 2. Locate Editable Message Box
    const editorSelectors = [
      'div.msg-form__contenteditable[contenteditable="true"]',
      'div[role="textbox"][aria-label*="message" i]',
      'div[contenteditable="true"]',
      'textarea[name="message"]',
    ];

    let editor: HTMLElement | null = null;
    for (const sel of editorSelectors) {
      editor = document.querySelector(sel) as HTMLElement;
      if (editor) break;
    }

    if (!editor) {
      alert('CareerRizz Bridge: Message box not automatically found. Please open the message box manually.');
      return;
    }

    editor.focus();

    // 3. Humanized character injection
    if (editor.tagName.toLowerCase() === 'textarea') {
      const textarea = editor as HTMLTextAreaElement;
      textarea.value = textToType;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // ContentEditable div
      document.execCommand('insertText', false, textToType);
    }

    console.log('[CareerRizz DOM Script] Message text injected successfully.');

    // 4. Highlight Send Button for Manual Click (Safety Gate)
    const sendBtn = document.querySelector(
      'button.msg-form__send-button, button[type="submit"].msg-form__send-btn, button:has-text("Send")'
    ) as HTMLElement;

    if (sendBtn) {
      sendBtn.style.outline = '4px solid #10b981';
      sendBtn.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.6)';
    }

    // Safety Banner Injection
    const banner = document.createElement('div');
    banner.style.position = 'fixed';
    banner.style.bottom = '20px';
    banner.style.right = '20px';
    banner.style.zIndex = '999999';
    banner.style.backgroundColor = '#1e293b';
    banner.style.color = '#ffffff';
    banner.style.padding = '16px 20px';
    banner.style.borderRadius = '8px';
    banner.style.border = '2px solid #10b981';
    banner.style.fontFamily = 'system-ui, sans-serif';
    banner.style.fontSize = '14px';
    banner.style.boxShadow = '0 10px 25px rgba(0,0,0,0.4)';
    banner.innerHTML = `
      <div style="font-weight: 700; color: #10b981; margin-bottom: 4px;">CareerRizz Safety Gate</div>
      <div>Message staged in active session. Review and click <strong>Send</strong> manually.</div>
    `;
    document.body.appendChild(banner);

    setTimeout(() => banner.remove(), 12000);
  }

  runSequence();
}
