/**
 * QuickClip - Local-First Clipboard Vault & Snippet Manager
 * Vanilla JavaScript Implementation
 * Zero external dependencies. Zero emojis.
 */

(function () {
  'use strict';

  // Storage key
  const STORAGE_KEY = 'quickclip_vault_data';

  // DOM Elements
  const captureInput = document.getElementById('capture-input');
  const addClipBtn = document.getElementById('add-clip-btn');
  const syncClipboardBtn = document.getElementById('sync-clipboard-btn');
  const clearUnpinnedBtn = document.getElementById('clear-unpinned-btn');
  const autoDetectBadge = document.getElementById('auto-detect-badge');
  const charCounter = document.getElementById('char-counter');

  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const filterPills = document.querySelectorAll('.filter-pills-bar .filter-pill');

  const pinnedSection = document.getElementById('pinned-section');
  const pinnedList = document.getElementById('pinned-list');
  const pinnedCountTag = document.getElementById('pinned-count-tag');

  const recentSection = document.getElementById('recent-section');
  const recentList = document.getElementById('recent-list');
  const recentCountTag = document.getElementById('recent-count-tag');

  const emptyState = document.getElementById('empty-state');
  const toastContainer = document.getElementById('toast-container');

  const countAll = document.getElementById('count-all');
  const countCode = document.getElementById('count-code');
  const countLink = document.getElementById('count-link');
  const countColor = document.getElementById('count-color');
  const countText = document.getElementById('count-text');

  // Modal Elements
  const confirmModal = document.getElementById('confirm-modal');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');

  // State
  let clips = [];
  let activeFilter = 'all';
  let searchQuery = '';
  let recentlyAddedId = null;

  // Initial Seed Data (if vault is empty)
  const SEED_DATA = [
    {
      id: 'seed-1',
      text: '#E07A5F',
      category: 'Color',
      isPinned: true,
      createdAt: Date.now() - 1000 * 60 * 12
    },
    {
      id: 'seed-2',
      text: 'const saveVault = (items) => {\n  localStorage.setItem("quickclip_vault_data", JSON.stringify(items));\n};',
      category: 'Code',
      isPinned: true,
      createdAt: Date.now() - 1000 * 60 * 45
    },
    {
      id: 'seed-3',
      text: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API',
      category: 'Link',
      isPinned: false,
      createdAt: Date.now() - 1000 * 60 * 120
    },
    {
      id: 'seed-4',
      text: 'Welcome to QuickClip. Press "Sync Clipboard" or press Ctrl+V anywhere to capture snippets automatically.',
      category: 'Text',
      isPinned: false,
      createdAt: Date.now() - 1000 * 60 * 360
    }
  ];

  /* ==========================================================================
     Auto-Categorization Skill (Regex Engine)
     ========================================================================== */
  const RegexPatterns = {
    // Hex Color (#FFF, #E07A5F, #12345678)
    colorHex: /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/,
    // RGB / RGBA / HSL / HSLA
    colorRgbHsl: /^(rgb|hsl)a?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(\s*,\s*[\d.]+%?)?\s*\)$/i,
    // URL Link
    link: /^(https?:\/\/[^\s]+)$/i,
    // Code Syntax Indicators
    codeKeywords: /\b(function|const|let|var|import|export|from|return|async|await|class|interface|type|extends|implements|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|GROUP BY|ORDER BY|def|elif|lambda|echo|public|private|protected|struct|fn|val)\b/,
    codeStructures: /(<\/[a-z0-9]+>|<[a-z0-9]+(\s+[^>]*)?>|=>|\{[^]*\}|\[[^]*\]|console\.(log|error|warn)|;\s*$)/m
  };

  /**
   * Classify text into Color, Link, Code, or Text.
   * @param {string} rawText
   * @returns {'Color' | 'Link' | 'Code' | 'Text'}
   */
  function categorizeText(rawText) {
    if (!rawText) return 'Text';
    const trimmed = rawText.trim();

    // 1. Color Check
    if (RegexPatterns.colorHex.test(trimmed) || RegexPatterns.colorRgbHsl.test(trimmed)) {
      return 'Color';
    }

    // 2. Link Check
    if (RegexPatterns.link.test(trimmed)) {
      return 'Link';
    }

    // 3. Code Check
    const hasKeywords = RegexPatterns.codeKeywords.test(trimmed);
    const hasStructures = RegexPatterns.codeStructures.test(trimmed);
    const hasMultipleLines = trimmed.includes('\n');
    const hasCodePunctuation = /[{};()=>]/.test(trimmed);

    if ((hasKeywords && hasCodePunctuation) || (hasStructures && (hasKeywords || hasMultipleLines))) {
      return 'Code';
    }

    // 4. Default Text
    return 'Text';
  }

  /**
   * Check if a color string is valid CSS color
   * @param {string} str
   * @returns {boolean}
   */
  function isValidColor(str) {
    const trimmed = str.trim();
    return RegexPatterns.colorHex.test(trimmed) || RegexPatterns.colorRgbHsl.test(trimmed);
  }

  /* ==========================================================================
     Local Storage Connector
     ========================================================================== */
  function loadVault() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        clips = JSON.parse(data);
      } else {
        // Seed initial data
        clips = [...SEED_DATA];
        saveVault();
      }
    } catch (err) {
      console.error('Failed to parse QuickClip vault data:', err);
      clips = [...SEED_DATA];
    }
  }

  function saveVault() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clips));
    } catch (err) {
      console.error('Failed to save QuickClip vault data:', err);
      showToast('Vault storage limit reached or disabled.');
    }
    updateCounts();
  }

  /* ==========================================================================
     Clipboard Connector
     ========================================================================== */
  /**
   * Add a clip to the vault
   * @param {string} text
   * @param {boolean} [animate=true]
   * @returns {object|null}
   */
  function addClip(text, animate = true) {
    if (!text || !text.trim()) {
      showToast('Cannot save an empty clip.');
      return null;
    }

    const trimmed = text.trim();

    // If identical snippet already exists, move to top or notify
    const existingIndex = clips.findIndex(c => c.text.trim() === trimmed);
    if (existingIndex !== -1) {
      const existing = clips[existingIndex];
      // Bump existing clip timestamp
      existing.createdAt = Date.now();
      // Move to top of clips array
      clips.splice(existingIndex, 1);
      clips.unshift(existing);
      saveVault();
      renderFeed();
      highlightClip(existing.id);
      showToast('Existing clip updated to top.');
      return existing;
    }

    const newClip = {
      id: 'clip-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      text: trimmed,
      category: categorizeText(trimmed),
      isPinned: false,
      createdAt: Date.now()
    };

    if (animate) {
      recentlyAddedId = newClip.id;
    }

    clips.unshift(newClip);
    saveVault();
    renderFeed();
    showToast('Clip saved to vault.');
    return newClip;
  }

  /**
   * Sync clipboard using navigator.clipboard.readText()
   */
  async function syncClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      showToast('Clipboard reading is not supported by your browser.');
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showToast('System clipboard is currently empty.');
        return;
      }
      addClip(text, true);
    } catch (err) {
      console.warn('Clipboard read failed:', err);
      showToast('Clipboard access was blocked or denied by browser.');
    }
  }

  /**
   * Copy clip content to clipboard with feedback
   * @param {string} text
   * @param {HTMLElement} [btnElement]
   * @param {HTMLElement} [cardElement]
   */
  async function copyClip(text, btnElement, cardElement) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');

      if (btnElement) {
        btnElement.classList.add('copied');
        const originalContent = btnElement.innerHTML;
        btnElement.innerHTML = `
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Copied
        `;
        setTimeout(() => {
          btnElement.classList.remove('copied');
          btnElement.innerHTML = originalContent;
        }, 1500);
      }

      if (cardElement) {
        cardElement.classList.add('flash-copied');
        setTimeout(() => {
          cardElement.classList.remove('flash-copied');
        }, 800);
      }
    } catch (err) {
      console.error('Failed to copy clip:', err);
      showToast('Failed to copy to clipboard.');
    }
  }

  /**
   * Toggle Pin state of a clip
   * @param {string} id
   */
  function togglePin(id) {
    const clip = clips.find(c => c.id === id);
    if (!clip) return;

    clip.isPinned = !clip.isPinned;
    saveVault();
    renderFeed();
    showToast(clip.isPinned ? 'Snippet pinned to top.' : 'Snippet unpinned.');
  }

  /**
   * Delete a single clip
   * @param {string} id
   */
  function deleteClip(id) {
    const clipIndex = clips.findIndex(c => c.id === id);
    if (clipIndex === -1) return;

    clips.splice(clipIndex, 1);
    saveVault();
    renderFeed();
    showToast('Clip deleted.');
  }

  /**
   * Clear all unpinned history
   */
  function clearUnpinned() {
    const pinnedClips = clips.filter(c => c.isPinned);
    const removedCount = clips.length - pinnedClips.length;

    if (removedCount === 0) {
      showToast('No unpinned clips to clear.');
      return;
    }

    clips = pinnedClips;
    saveVault();
    renderFeed();
    showToast(`Cleared ${removedCount} unpinned ${removedCount === 1 ? 'clip' : 'clips'}.`);
  }

  /* ==========================================================================
     UI Rendering & Feed Management
     ========================================================================== */
  function formatRelativeTime(timestamp) {
    const elapsedSeconds = Math.floor((Date.now() - timestamp) / 1000);

    if (elapsedSeconds < 15) return 'Just now';
    if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours}h ago`;

    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays === 1) return 'Yesterday';
    if (elapsedDays < 30) return `${elapsedDays}d ago`;

    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function getCategoryBadgeClass(category) {
    switch (category) {
      case 'Code': return 'badge-code';
      case 'Link': return 'badge-link';
      case 'Color': return 'badge-color';
      default: return 'badge-text';
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str
   * @returns {string}
   */
  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Create SVG Icons
   */
  const Icons = {
    pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
          </svg>`,
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
             <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
           </svg>`,
    delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <polyline points="3 6 5 6 21 6"></polyline>
               <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
             </svg>`,
    externalLink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                     <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                     <polyline points="15 3 21 3 21 9"></polyline>
                     <line x1="10" y1="14" x2="21" y2="3"></line>
                   </svg>`
  };

  /**
   * Render single clip card element
   * @param {object} clip
   * @returns {HTMLElement}
   */
  function createClipCardElement(clip) {
    const card = document.createElement('article');
    card.className = 'clip-card';
    card.id = clip.id;
    card.setAttribute('role', 'listitem');

    if (clip.id === recentlyAddedId) {
      card.classList.add('animate-entrance');
      // Reset flag after entrance
      setTimeout(() => {
        card.classList.remove('animate-entrance');
        if (recentlyAddedId === clip.id) recentlyAddedId = null;
      }, 400);
    }

    const badgeClass = getCategoryBadgeClass(clip.category);
    const isColor = clip.category === 'Color' && isValidColor(clip.text);

    // Dynamic Swatch Orb with glowing shadow matching that exact color
    let colorOrbHtml = '';
    let colorDetailsHtml = '';
    if (isColor) {
      const colorVal = clip.text.trim();
      colorOrbHtml = `
        <span class="color-swatch-orb" 
              style="background-color: ${escapeHTML(colorVal)}; box-shadow: 0 4px 14px ${escapeHTML(colorVal)}66;"
              title="Click to copy color code"
              data-color="${escapeHTML(colorVal)}">
        </span>
      `;
      colorDetailsHtml = `
        <div class="card-color-details">
          <span class="color-hex-label">${escapeHTML(colorVal)}</span>
        </div>
      `;
    }

    // Snippet preview element
    let contentHtml = '';
    const escapedText = escapeHTML(clip.text);

    if (clip.category === 'Code') {
      contentHtml = `<pre class="card-text-preview card-code-preview" title="Click to copy">${escapedText}</pre>`;
    } else if (clip.category === 'Link') {
      contentHtml = `
        <div class="card-text-preview">
          <a href="${escapedText}" target="_blank" rel="noopener noreferrer" class="card-link-preview" title="Open URL in new tab">
            ${escapedText}
            ${Icons.externalLink}
          </a>
        </div>
      `;
    } else if (isColor) {
      contentHtml = colorDetailsHtml;
    } else {
      contentHtml = `<div class="card-text-preview" title="Click to copy">${escapedText}</div>`;
    }

    const isLongSnippet = clip.text.length > 180 || clip.text.split('\n').length > 3;

    card.innerHTML = `
      <div class="card-top">
        <div class="card-category-area">
          ${colorOrbHtml}
          <span class="type-badge ${badgeClass}">${clip.category}</span>
        </div>
        <div class="card-actions">
          <button class="action-btn pin-btn ${clip.isPinned ? 'is-pinned' : ''}" title="${clip.isPinned ? 'Unpin snippet' : 'Pin snippet to top'}" data-action="pin">
            ${Icons.pin}
            <span>${clip.isPinned ? 'Pinned' : 'Pin'}</span>
          </button>
          <button class="action-btn copy-btn" title="Copy snippet to clipboard" data-action="copy">
            ${Icons.copy}
            <span>Copy</span>
          </button>
          <button class="action-btn delete-btn" title="Delete snippet" data-action="delete">
            ${Icons.delete}
          </button>
        </div>
      </div>
      
      <div class="card-content-area">
        ${contentHtml}
      </div>

      <div class="card-bottom">
        <span class="card-timestamp" title="${new Date(clip.createdAt).toLocaleString()}">
          ${formatRelativeTime(clip.createdAt)}
        </span>
        ${isLongSnippet ? '<button class="card-expand-toggle" data-action="toggle-expand">Show More</button>' : ''}
      </div>
    `;

    // Event listeners on card
    card.addEventListener('click', (e) => {
      const target = e.target.closest('button, .color-swatch-orb, .card-text-preview, a');
      if (!target) return;

      // Handle Pin Action
      if (target.dataset.action === 'pin') {
        e.stopPropagation();
        togglePin(clip.id);
        return;
      }

      // Handle Copy Action
      if (target.dataset.action === 'copy') {
        e.stopPropagation();
        copyClip(clip.text, target, card);
        return;
      }

      // Handle Delete Action
      if (target.dataset.action === 'delete') {
        e.stopPropagation();
        deleteClip(clip.id);
        return;
      }

      // Handle Expand Toggle
      if (target.dataset.action === 'toggle-expand') {
        e.stopPropagation();
        const preview = card.querySelector('.card-text-preview');
        if (preview) {
          const isExpanded = preview.classList.toggle('expanded');
          target.textContent = isExpanded ? 'Show Less' : 'Show More';
        }
        return;
      }

      // Handle clicking the color orb
      if (target.classList.contains('color-swatch-orb')) {
        e.stopPropagation();
        copyClip(clip.text, card.querySelector('.copy-btn'), card);
        return;
      }

      // Handle clicking the text preview directly (easy copy)
      if (target.classList.contains('card-text-preview') && !e.target.closest('a')) {
        copyClip(clip.text, card.querySelector('.copy-btn'), card);
      }
    });

    return card;
  }

  /**
   * Filter and search clips
   */
  function getFilteredClips() {
    const query = searchQuery.trim().toLowerCase();

    return clips.filter(clip => {
      // Category filter
      if (activeFilter !== 'all' && clip.category.toLowerCase() !== activeFilter.toLowerCase()) {
        return false;
      }

      // Search query filter
      if (query) {
        const matchesText = clip.text.toLowerCase().includes(query);
        const matchesCategory = clip.category.toLowerCase().includes(query);
        return matchesText || matchesCategory;
      }

      return true;
    });
  }

  /**
   * Render feed contents
   */
  function renderFeed() {
    const filtered = getFilteredClips();

    const pinnedClips = filtered.filter(c => c.isPinned);
    const recentClips = filtered.filter(c => !c.isPinned);

    // Clear lists
    pinnedList.innerHTML = '';
    recentList.innerHTML = '';

    // Handle Pinned Section Visibility
    if (pinnedClips.length > 0) {
      pinnedSection.classList.remove('hidden');
      pinnedCountTag.textContent = `${pinnedClips.length} pinned`;
      pinnedClips.forEach(clip => {
        pinnedList.appendChild(createClipCardElement(clip));
      });
    } else {
      pinnedSection.classList.add('hidden');
    }

    // Handle Recent Section
    if (recentClips.length > 0) {
      recentSection.classList.remove('hidden');
      recentCountTag.textContent = `${recentClips.length} ${recentClips.length === 1 ? 'clip' : 'clips'}`;
      recentClips.forEach(clip => {
        recentList.appendChild(createClipCardElement(clip));
      });
    } else {
      recentSection.classList.add('hidden');
    }

    // Handle Empty State
    if (pinnedClips.length === 0 && recentClips.length === 0) {
      emptyState.classList.remove('hidden');
      if (searchQuery || activeFilter !== 'all') {
        emptyState.querySelector('.empty-title').textContent = 'No matching snippets found';
        emptyState.querySelector('.empty-description').textContent = 'Try adjusting your search terms or selecting another category filter.';
      } else {
        emptyState.querySelector('.empty-title').textContent = 'Vault is empty';
        emptyState.querySelector('.empty-description').textContent = 'Copy text from any app or paste directly here. You can also click "Sync Clipboard" to capture immediately.';
      }
    } else {
      emptyState.classList.add('hidden');
    }

    updateCounts();
  }

  /**
   * Update category pill counter badges
   */
  function updateCounts() {
    const counts = {
      all: clips.length,
      Code: 0,
      Link: 0,
      Color: 0,
      Text: 0
    };

    clips.forEach(clip => {
      if (counts[clip.category] !== undefined) {
        counts[clip.category]++;
      }
    });

    if (countAll) countAll.textContent = counts.all;
    if (countCode) countCode.textContent = counts.Code;
    if (countLink) countLink.textContent = counts.Link;
    if (countColor) countColor.textContent = counts.Color;
    if (countText) countText.textContent = counts.Text;
  }

  /**
   * Highlight a clip after updating or finding duplicate
   * @param {string} id
   */
  function highlightClip(id) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.classList.add('flash-copied');
      setTimeout(() => el.classList.remove('flash-copied'), 1000);
    }
  }

  /* ==========================================================================
     Toast Notification System
     ========================================================================== */
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span>${escapeHTML(message)}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 250);
    }, 2400);
  }

  /* ==========================================================================
     Event Listeners & Initialization
     ========================================================================== */

  // Capture input typing handler for live auto-detection
  captureInput.addEventListener('input', () => {
    const text = captureInput.value;
    charCounter.textContent = `${text.length} chars`;

    if (!text.trim()) {
      autoDetectBadge.textContent = 'Auto-Detect: Text';
      autoDetectBadge.className = 'type-badge badge-neutral';
      return;
    }

    const detected = categorizeText(text);
    autoDetectBadge.textContent = `Auto-Detect: ${detected}`;
    autoDetectBadge.className = `type-badge ${getCategoryBadgeClass(detected)}`;
  });

  // Add clip button
  addClipBtn.addEventListener('click', () => {
    const text = captureInput.value;
    if (!text.trim()) {
      showToast('Please type or paste text before adding.');
      captureInput.focus();
      return;
    }

    addClip(text, true);
    captureInput.value = '';
    charCounter.textContent = '0 chars';
    autoDetectBadge.textContent = 'Auto-Detect: Text';
    autoDetectBadge.className = 'type-badge badge-neutral';
  });

  // Ctrl+Enter in capture input to add clip immediately
  captureInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      addClipBtn.click();
    }
  });

  // Sync clipboard button
  syncClipboardBtn.addEventListener('click', () => {
    syncClipboard();
  });

  // Search input handler
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    if (searchQuery.trim()) {
      searchClearBtn.classList.remove('hidden');
    } else {
      searchClearBtn.classList.add('hidden');
    }
    renderFeed();
  });

  // Clear search button
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClearBtn.classList.add('hidden');
    searchInput.focus();
    renderFeed();
  });

  // Filter pills selection
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.getAttribute('data-category');
      renderFeed();
    });
  });

  // Global paste handler: capture clipboard text anywhere on the page
  document.addEventListener('paste', (e) => {
    // If the user is typing in the capture textarea or search input, let default paste proceed
    const activeEl = document.activeElement;
    if (activeEl === captureInput || activeEl === searchInput) {
      return;
    }

    const pastedText = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (pastedText && pastedText.trim()) {
      addClip(pastedText, true);
    }
  });

  // Global keydown handler: Escape clears search
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!confirmModal.classList.contains('hidden')) {
        confirmModal.classList.add('hidden');
        return;
      }
      if (searchInput.value) {
        searchInput.value = '';
        searchQuery = '';
        searchClearBtn.classList.add('hidden');
        renderFeed();
      }
    }
  });

  // Confirmation Modal Handling for Clear Unpinned
  clearUnpinnedBtn.addEventListener('click', () => {
    const unpinnedCount = clips.filter(c => !c.isPinned).length;
    if (unpinnedCount === 0) {
      showToast('No unpinned clips to clear.');
      return;
    }
    confirmModal.classList.remove('hidden');
  });

  modalCancelBtn.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
  });

  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
      confirmModal.classList.add('hidden');
    }
  });

  modalConfirmBtn.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
    clearUnpinned();
  });

  // Periodic relative timestamp refresher (every 30 seconds)
  setInterval(() => {
    const timestampElements = document.querySelectorAll('.card-timestamp');
    timestampElements.forEach(el => {
      const card = el.closest('.clip-card');
      if (card) {
        const clip = clips.find(c => c.id === card.id);
        if (clip) {
          el.textContent = formatRelativeTime(clip.createdAt);
        }
      }
    });
  }, 30000);

  // Initialize
  loadVault();
  renderFeed();

})();
