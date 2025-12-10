// admin.js — Admin dashboard logic (CRUD) with address + Google Maps link + S3 photo upload
// Requires: window.auth (from script.js) and API_BASE set globally.

(() => {
  // DOM references
  const cardsEl = document.getElementById('cards');
  const countLabel = document.getElementById('countLabel');
  const availableOnlyEl = document.getElementById('availableOnly');
  const filterBedsEl = document.getElementById('filterBeds');
  const filterBathsEl = document.getElementById('filterBaths');
  const refreshBtn = document.getElementById('refreshBtn');
  const guard = document.getElementById('guard');

  // Form elements
  const form = document.getElementById('propForm');
  const formTitle = document.getElementById('formTitle');
  const idEl = document.getElementById('propId');
  const titleEl = document.getElementById('title');
  const priceEl = document.getElementById('price');
  const bedsEl = document.getElementById('bedrooms');
  const bathsEl = document.getElementById('bathrooms');
  const availableEl = document.getElementById('available');
  const tagsEl = document.getElementById('tags');
  const descEl = document.getElementById('description');
  const photosEl = document.getElementById('photos');
  const photoFilesEl = document.getElementById('photoFiles');
  const addressEl = document.getElementById('address');
  const cityEl = document.getElementById('city');
  const resetBtn = document.getElementById('resetBtn');

  let allProps = [];

  // ---------- Helpers ----------

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseCSV(s) {
    return (s || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
  }

  function requireAuth() {
    const authed = window.auth?.isOwnerOrEditor?.() || false;

    if (!authed) {
      guard?.classList.remove("hidden");
    } else {
      guard?.classList.add("hidden");
    }

    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const userInfo = document.getElementById("userInfo");
    if (authed) {
      loginBtn && (loginBtn.style.display = "none");
      logoutBtn && (logoutBtn.style.display = "");
      userInfo && (userInfo.style.display = "");
    }

    return authed;
  }

  // ---------- API helpers ----------

  async function apiGet() {
    const r = await fetch(`${API_BASE}/properties`);
    const text = await r.text();
    console.log("GET /properties RAW:", r.status, text);
    if (!r.ok) throw new Error(`GET failed: ${r.status}`);
    return JSON.parse(text || "[]");
  }

  async function apiCreate(payload) {
    const idt = window.auth.getIdToken();
    if (!idt) throw new Error("Not authenticated (no ID token)");
    console.log("CREATE PAYLOAD:", payload);
    const r = await fetch(`${API_BASE}/properties`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    console.log("CREATE RAW RESPONSE:", r.status, text);
    if (!r.ok) {
      throw new Error(`Create failed ${r.status}: ${text}`);
    }
    return JSON.parse(text || "{}");
  }

  async function apiUpdate(id, payload) {
    const idt = window.auth.getIdToken();
    if (!idt) throw new Error("Not authenticated (no ID token)");
    console.log("UPDATE PAYLOAD:", id, payload);
    const r = await fetch(`${API_BASE}/properties/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${idt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    console.log("UPDATE RAW RESPONSE:", r.status, text);
    if (!r.ok) {
      throw new Error(`Update failed ${r.status}: ${text}`);
    }
    return JSON.parse(text || "{}");
  }

  async function apiDelete(id) {
    const idt = window.auth.getIdToken();
    if (!idt) throw new Error("Not authenticated (no ID token)");
    const r = await fetch(`${API_BASE}/properties/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${idt}` }
    });
    const text = await r.text();
    console.log("DELETE RAW RESPONSE:", r.status, text);
    if (!r.ok) throw new Error(`Delete failed ${r.status}: ${text}`);
    return true;
  }

  // ---------- S3 upload helpers ----------

  async function getUploadUrls(files) {
    if (!files.length) return [];

    const idt = window.auth.getIdToken();
    if (!idt) throw new Error("Not authenticated (no ID token for upload-urls)");

    const payload = {
      files: files.map(f => ({
        name: f.name,
        type: f.type || "application/octet-stream",
      })),
    };

    console.log("REQUESTING UPLOAD URLS:", payload);

    const r = await fetch(`${API_BASE}/upload-urls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    console.log("UPLOAD-URLS RAW RESPONSE:", r.status, text);

    if (!r.ok) {
      throw new Error(`upload-urls failed ${r.status}: ${text}`);
    }

    const data = JSON.parse(text || "{}");
    return data.uploads || [];
  }

  async function uploadFilesToS3(files, uploads) {
    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const info = uploads[i];
      if (!info) continue;

      console.log("S3 PUT START:", file.name, "->", info.uploadUrl);

      const res = await fetch(info.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      const bodyText = await res.text().catch(() => "");
      console.log("S3 PUT RESPONSE:", res.status, bodyText);

      if (!res.ok) {
        throw new Error(`S3 upload failed for ${file.name}: ${res.status} ${bodyText}`);
      }

      results.push(info.publicUrl);
    }

    return results;
  }

  // ---------- Form helpers ----------

  function clearForm() {
    idEl.value = "";
    formTitle.textContent = "Add New Property";
    titleEl.value = "";
    priceEl.value = "";
    bedsEl.value = "";
    bathsEl.value = "";
    availableEl.checked = true;
    tagsEl.value = "";
    descEl.value = "";
    photosEl.value = "";
    addressEl.value = "";
    cityEl.value = "";
    if (photoFilesEl) photoFilesEl.value = "";
  }

  function fillForm(p) {
    idEl.value = p?.id || "";
    formTitle.textContent = p?.id ? "Edit Property" : "Add New Property";
    titleEl.value = p?.title || "";
    priceEl.value = p?.price ?? "";
    bedsEl.value = p?.bedrooms ?? "";
    bathsEl.value = p?.bathrooms ?? "";
    availableEl.checked = p?.available ?? false;
    tagsEl.value = (p?.tags || []).join(", ");
    descEl.value = p?.description || "";
    photosEl.value = (p?.photos || []).join(", ");
    addressEl.value = p?.address || "";
    cityEl.value = p?.city || "";
    if (photoFilesEl) photoFilesEl.value = "";
  }

  function payloadFromForm() {
    const payload = {
      title: titleEl.value.trim(),
      description: descEl.value.trim(),
      price: Number(priceEl.value || 0),
      bedrooms: Number(bedsEl.value || 0),
      bathrooms: Number(bathsEl.value || 0),
      available: !!availableEl.checked,
      tags: parseCSV(tagsEl.value),
      // photos will be filled in submit handler
      address: addressEl.value.trim(),
      city: cityEl.value.trim(),
    };
    console.log("payloadFromForm ->", payload);
    return payload;
  }

  // ---------- Render cards ----------

  function render(listRaw) {
    const minBeds = Number(filterBedsEl.value || 0);
    const minBaths = Number(filterBathsEl.value || 0);
    const onlyAvail = !!availableOnlyEl.checked;

    const filtered = (listRaw || []).filter(p =>
      (p.bedrooms || 0) >= minBeds &&
      (p.bathrooms || 0) >= minBaths &&
      (!onlyAvail || p.available)
    );

    countLabel.textContent = `${filtered.length} of ${listRaw.length} properties`;

    cardsEl.innerHTML = filtered.map(p => {
      const img = (p.photos && p.photos[0]) || "";
      const address = p.address || "";
      const city = p.city || "";
      const mapQuery = (address || city).trim();
      const hasMap = mapQuery.length > 0;

      const mapLink = hasMap
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
        : "";

      return `
        <article class="card">
          <div class="row" style="justify-content:space-between;align-items:flex-start;">
            <h4>${escapeHtml(p.title || "")}</h4>
            <div class="muted right">$${Number(p.price || 0).toLocaleString()}</div>
          </div>
          <div class="row">
            <div>${p.bedrooms || 0} bd • ${p.bathrooms || 0} ba</div>
            ${p.city ? `<div class="muted">• ${escapeHtml(p.city)}</div>` : ""}
          </div>
          ${address
            ? `<div class="muted" style="margin-top:2px;">${escapeHtml(address)}</div>`
            : city
              ? `<div class="muted" style="margin-top:2px;">${escapeHtml(city)}</div>`
              : ""
          }
          <div class="row" style="margin-top:.25rem">
            <span class="pill ${p.available ? 'ok' : 'danger'}">
              ${p.available ? "Available" : "Unavailable"}
            </span>
            ${p.tags && p.tags.length
              ? `<span class="muted">Tags: ${p.tags.map(escapeHtml).join(", ")}</span>`
              : ""
            }
          </div>
          <p class="muted" style="margin-top:.5rem;">${escapeHtml(p.description || "")}</p>
          ${img ? `<div style="margin-top:.5rem;"><img src="${img}" alt="" style="max-width:100%;border-radius:8px;"/></div>` : ""}
          <div class="row" style="margin-top:.75rem; justify-content:flex-end; gap:.5rem;">
            ${mapLink
              ? `<a href="${mapLink}" target="_blank" rel="noopener" class="btn small">View on Map</a>`
              : ""
            }
            <button class="btn small" data-edit="${escapeHtml(p.id)}">Edit</button>
            <button class="btn small" data-del="${escapeHtml(p.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join("");

    // Wire edit/delete
    cardsEl.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        const p = allProps.find(x => x.id === id);
        if (p) fillForm(p);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    cardsEl.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        if (!confirm("Delete this property?")) return;
        try {
          await apiDelete(id);
          await load();
        } catch (err) {
          console.error(err);
          alert("Delete failed: " + err.message);
        }
      });
    });
  }

  // ---------- Load data ----------

  async function load() {
    const list = await apiGet();
    console.log("PROPERTIES FROM API:", list);
    allProps = list.sort((a, b) =>
      (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "")
    );
    render(allProps);
  }

  // ---------- Event wiring ----------

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = payloadFromForm();

    if (!payload.title) {
      alert("Title is required");
      return;
    }

    try {
      const manualPhotos = parseCSV(photosEl.value);
      const fileList = photoFilesEl?.files ? Array.from(photoFilesEl.files) : [];

      let uploadedUrls = [];
      if (fileList.length) {
        // 1) ask backend for presigned URLs
        const uploads = await getUploadUrls(fileList);
        if (!uploads.length) {
          throw new Error("No upload URLs returned");
        }

        // 2) upload files directly to S3
        uploadedUrls = await uploadFilesToS3(fileList, uploads);
      }

      // 3) merge manual URLs + S3 URLs
      payload.photos = [...manualPhotos, ...uploadedUrls];

      const id = idEl.value.trim();
      if (id) {
        await apiUpdate(id, payload);
      } else {
        await apiCreate(payload);
      }

      clearForm();
      await load();
    } catch (err) {
      console.error(err);
      alert("Save failed: " + err.message);
    }
  });

  resetBtn.addEventListener("click", () => clearForm());

  [availableOnlyEl, filterBedsEl, filterBathsEl].forEach(el =>
    el.addEventListener("input", () => render(allProps))
  );
  refreshBtn.addEventListener("click", () => load());

  // ---------- Init ----------

  const ok = requireAuth();
  if (!ok) return;
  load();
})();
