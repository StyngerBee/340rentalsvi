// admin.js — Admin dashboard logic (CRUD)
// Requires: window.auth (from your script.js) and API_BASE set globally.

(() => {
  const cardsEl = document.getElementById('cards');
  const countLabel = document.getElementById('countLabel');
  const availableOnlyEl = document.getElementById('availableOnly');
  const filterBedsEl = document.getElementById('filterBeds');
  const filterBathsEl = document.getElementById('filterBaths');
  const refreshBtn = document.getElementById('refreshBtn');
  const guard = document.getElementById('guard');

  // form elements
  const form = document.getElementById('propForm');
  const formTitle = document.getElementById('formTitle');
  const idEl = document.getElementById('propId');
  const titleEl = document.getElementById('title');
  const priceEl = document.getElementById('price');
  const bedsEl = document.getElementById('bedrooms');
  const bathsEl = document.getElementById('bathrooms');
  const availEl = document.getElementById('available');
  const tagsEl = document.getElementById('tags');
  const descEl = document.getElementById('description');
  const photosEl = document.getElementById('photos');
  const resetBtn = document.getElementById('resetBtn');

  let allProps = [];

  // --- Auth guard: require logged-in owner/editor ---
  function isOwnerOrEditor() {
    try {
      const idt = window.auth?.getIdToken?.();
      if (!idt) return false;
      const claims = JSON.parse(atob(idt.split('.')[1]));
      const groups = claims['cognito:groups'];
      if (Array.isArray(groups)) return groups.includes('owners') || groups.includes('editors');
      if (typeof groups === 'string') return groups.split(',').includes('owners') || groups.split(',').includes('editors');
      return false;
    } catch { return false; }
  }

  function requireAuth() {
    const authed = isOwnerOrEditor();
    document.getElementById('userInfo')?.classList.toggle('hidden', !authed);
    document.getElementById('logoutBtn')?.classList.toggle('hidden', !authed);
    document.getElementById('loginBtn')?.classList.toggle('hidden', authed);
    guard.classList.toggle('hidden', authed);
    return authed;
  }

  // --- API helpers (use ID token for writes) ---
  async function apiGet() {
    const r = await fetch(`${API_BASE}/properties`);
    if (!r.ok) throw new Error('GET failed');
    return r.json();
  }
  async function apiCreate(payload) {
    const idt = window.auth.getIdToken();
    const r = await fetch(`${API_BASE}/properties`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`Create failed ${r.status}`);
    return r.json();
  }
  async function apiUpdate(id, payload) {
    const idt = window.auth.getIdToken();
    const r = await fetch(`${API_BASE}/properties/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${idt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`Update failed ${r.status}`);
    return r.json();
  }
  async function apiDelete(id) {
    const idt = window.auth.getIdToken();
    const r = await fetch(`${API_BASE}/properties/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${idt}` }
    });
    if (!r.ok) throw new Error(`Delete failed ${r.status}`);
  }

  // --- Rendering ---
  function toTags(arr) {
    if (!Array.isArray(arr)) return '';
    return arr.map(t => `<span class="tag">${escapeHtml(String(t))}</span>`).join('');
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }
  function applyFilters(list) {
    const availOnly = availableOnlyEl.checked;
    const minBeds = Number(filterBedsEl.value || 0);
    const minBaths = Number(filterBathsEl.value || 0);
    return list.filter(p =>
      (!availOnly || p.available) &&
      (isNaN(minBeds) || (p.bedrooms ?? 0) >= minBeds) &&
      (isNaN(minBaths) || (p.bathrooms ?? 0) >= minBaths)
    );
  }
  function render(list) {
    const filtered = applyFilters(list);
    countLabel.textContent = `${filtered.length} shown / ${list.length} total`;
    cardsEl.innerHTML = filtered.map(p => {
      const photos = Array.isArray(p.photos) ? p.photos : [];
      const img = photos[0] ? `<img src="${escapeHtml(photos[0])}" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:10px;margin-bottom:.5rem">` : '';
      return `
        <div class="card">
          ${img}
          <div class="row">
            <h4 class="rightless">${escapeHtml(p.title || 'Untitled')}</h4>
            <span class="pill ${p.available ? 'ok' : 'danger'}">${p.available ? 'Available' : 'Unavailable'}</span>
          </div>
          <div class="muted">$${Number(p.price||0).toLocaleString()} · ${p.bedrooms||0} bd · ${p.bathrooms||0} ba</div>
          <p class="muted" style="margin:.5rem 0 0">${escapeHtml(p.description || '')}</p>
          <div style="margin:.5rem 0 0">${toTags(p.tags)}</div>
          <div class="row" style="margin-top:.75rem">
            <button class="btn small" data-edit="${p.id}">Edit</button>
            <button class="btn small danger" data-del="${p.id}">Delete</button>
            <span class="muted right">#${escapeHtml(p.id)}</span>
          </div>
        </div>
      `;
    }).join('');
    // wire edit/delete
    cardsEl.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => startEdit(btn.dataset.edit)));
    cardsEl.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => doDelete(btn.dataset.del)));
  }

  // --- Form handlers ---
  function clearForm() {
    idEl.value = '';
    formTitle.textContent = 'Add New Property';
    form.reset();
  }
  function startEdit(id) {
    const p = allProps.find(x => x.id === id);
    if (!p) return;
    idEl.value = p.id;
    formTitle.textContent = 'Edit Property';
    titleEl.value = p.title || '';
    priceEl.value = p.price ?? 0;
    bedsEl.value = p.bedrooms ?? 0;
    bathsEl.value = p.bathrooms ?? 0;
    availEl.checked = !!p.available;
    tagsEl.value = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    descEl.value = p.description || '';
    photosEl.value = Array.isArray(p.photos) ? p.photos.join(', ') : '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function doDelete(id) {
    if (!confirm('Delete this property?')) return;
    await apiDelete(id);
    await load();
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: titleEl.value.trim(),
      description: descEl.value.trim(),
      price: Number(priceEl.value || 0),
      bedrooms: Number(bedsEl.value || 0),
      bathrooms: Number(bathsEl.value || 0),
      available: !!availEl.checked,
      tags: tagsEl.value.split(',').map(s => s.trim()).filter(Boolean),
      photos: photosEl.value.split(',').map(s => s.trim()).filter(Boolean),
    };
    if (idEl.value) {
      await apiUpdate(idEl.value, payload);
    } else {
      await apiCreate(payload);
    }
    clearForm();
    await load();
  });
  resetBtn.addEventListener('click', (e) => { e.preventDefault(); clearForm(); });

  // --- Load & events ---
  async function load() {
    const list = await apiGet();
    // sort newest first
    allProps = list.sort((a,b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    render(allProps);
  }

  [availableOnlyEl, filterBedsEl, filterBathsEl].forEach(el => el.addEventListener('input', () => render(allProps)));
  refreshBtn.addEventListener('click', load);

  // init
  document.addEventListener('DOMContentLoaded', async () => {
    const ok = requireAuth();
    if (!ok) return;
    await load();
  });
})();
