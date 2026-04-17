// Shared utilities for changelog + download pages

// ── Accessibility toggle ──
export function initA11y() {
  const btn = document.getElementById('dyslexiaToggle');
  const KEY = 'kiyoshi-dyslexia';
  const apply = (on) => {
    document.body.classList.toggle('dyslexia', on);
    btn.classList.toggle('active', on);
  };
  apply(localStorage.getItem(KEY) === '1');
  btn.addEventListener('click', () => {
    const on = !document.body.classList.contains('dyslexia');
    localStorage.setItem(KEY, on ? '1' : '0');
    apply(on);
  });
}

// ── Date ──
export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Asset filtering & platform detection ──
const IGNORE = ['.sig', 'latest.json'];

export function isRelevantAsset(name) {
  return !IGNORE.some(x => name.toLowerCase().endsWith(x) || name === x);
}

export function getPlatform(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.exe'))        return 'windows';
  if (n.endsWith('.appimage'))   return 'linux';
  if (n.endsWith('.deb'))        return 'linux';
  if (n.endsWith('.dmg'))        return 'macos';
  return 'other';
}

const PLATFORM_META = {
  windows: { icon: 'fa-brands fa-windows', label: 'Windows' },
  linux:   { icon: 'fa-brands fa-linux',   label: 'Linux' },
  macos:   { icon: 'fa-brands fa-apple',   label: 'macOS' },
  other:   { icon: 'fa-solid fa-download', label: 'Other' },
};

export function assetLabel(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.exe'))        return 'Windows Installer (.exe)';
  if (n.endsWith('.appimage'))   return 'AppImage';
  if (n.endsWith('.deb'))        return 'Debian Package (.deb)';
  if (n.endsWith('.dmg'))        return 'macOS Disk Image (.dmg)';
  return name;
}

export function platformIcon(name) {
  return PLATFORM_META[getPlatform(name)]?.icon ?? 'fa-solid fa-download';
}

// Group assets by platform, sorted Windows → Linux → macOS → Other
export function groupAssets(assets) {
  const order = ['windows', 'linux', 'macos', 'other'];
  const filtered = assets.filter(a => isRelevantAsset(a.name));
  const groups = {};
  for (const a of filtered) {
    const p = getPlatform(a.name);
    if (!groups[p]) groups[p] = [];
    groups[p].push(a);
  }
  return order.filter(p => groups[p]).map(p => ({ platform: p, meta: PLATFORM_META[p], assets: groups[p] }));
}

// ── Markdown parser (handles **bold**, `code`, basic lists) ──
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="font-family:monospace;font-size:0.9em;background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:4px">$1</code>');
}

export function parseNotes(body) {
  if (!body) return '<p style="color:var(--text-muted);font-size:13px">No release notes provided.</p>';

  const sections = {};
  let current = null;

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      current = heading[1].trim();
      if (!sections[current]) sections[current] = [];
    } else if ((line.startsWith('- ') || line.startsWith('* ')) && current !== null) {
      sections[current].push(line.replace(/^[-*]\s+/, ''));
    }
  }

  return Object.entries(sections).map(([heading, items]) => {
    if (!items.length) return '';
    return `
      <div class="notes-section">
        <h3>${escapeHtml(heading)}</h3>
        <ul>${items.map(i => `<li>${inlineMarkdown(i)}</li>`).join('')}</ul>
      </div>`;
  }).join('');
}

// ── Fetch releases ──
export async function fetchReleases() {
  const res = await fetch('https://api.github.com/repos/KiyoshiTheDevil/kiyoshi-music/releases');
  if (!res.ok) throw new Error('API error');
  return res.json();
}
