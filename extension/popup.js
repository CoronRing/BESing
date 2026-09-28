document.addEventListener('DOMContentLoaded', async () => {
  const domainEl = document.getElementById('domain-val');
  const statusEl = document.getElementById('status-val');
  const countEl = document.getElementById('blocked-count');
  const btn = document.getElementById('open-page-manager');

  // Query active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      try {
        const url = new URL(tabs[0].url);
        const host = url.hostname;
        domainEl.textContent = host;

        chrome.storage.local.get(['blocked_sites'], (res) => {
          const list = res.blocked_sites || [];
          countEl.textContent = String(list.length);
          const isBlocked = list.some(item => item.host.toLowerCase() === host.toLowerCase());
          if (isBlocked) {
            statusEl.textContent = 'Disabled on this site';
            statusEl.className = 'status-val blocked';
          } else {
            statusEl.textContent = 'Active';
            statusEl.className = 'status-val';
          }
        });
      } catch (e) {
        domainEl.textContent = 'Browser Internal';
        statusEl.textContent = 'Inactive';
      }
    }
  });

  btn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]?.id) {
        // Send keyboard event or inject trigger
        chrome.scripting?.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', altKey: true, shiftKey: true }));
          }
        });
        window.close();
      }
    });
  });
});
