const state = { properties: [], vacant: [], tenants: [], arrears: [], maintenance: [] };
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function money(value) {
  return `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = 'toast'; }, 3500);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const key = localStorage.getItem('knight-admin-key');
  if (key) headers['x-admin-api-key'] = key;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function fillSelect(selector, items, label) {
  const select = $(selector);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(label)}</option>` + items.map((item) =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`,
  ).join('');
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function render() {
  $('#property-count').textContent = state.properties.length;
  $('#vacant-count').textContent = state.vacant.length;
  $('#open-tickets').textContent = state.maintenance.filter((item) => !['resolved', 'closed'].includes(item.status)).length;
  $('#arrears-total').textContent = money(state.arrears.reduce((sum, tenant) => sum + Number(tenant.balance || 0), 0));

  fillSelect('#unit-property', state.properties.map((item) => ({ id: item.id, label: item.name })), 'Choose property');
  fillSelect('#tenant-unit', state.vacant.map((item) => ({ id: item.id, label: `${item.propertyName} · ${item.name}` })), 'Choose vacant unit');
  fillSelect('#payment-tenant', state.tenants.filter((item) => item.status === 'active').map((item) => ({
    id: item.id, label: `${item.name} · ${item.propertyName || ''} ${item.unitName || ''}`,
  })), 'Choose tenant');

  $('#arrears-list').innerHTML = state.arrears.length ? state.arrears.map((tenant) => `
    <div class="data-row"><div><strong>${escapeHtml(tenant.name)}</strong><small>${escapeHtml(tenant.propertyName)} · Unit ${escapeHtml(tenant.unitName)}</small></div><span class="danger">${money(tenant.balance)}</span></div>
  `).join('') : '<p class="muted">No tenants in arrears.</p>';

  $('#vacant-list').innerHTML = state.vacant.length ? state.vacant.map((unit) => `
    <div class="data-row"><div><strong>${escapeHtml(unit.propertyName)} · ${escapeHtml(unit.name)}</strong><small>${escapeHtml(unit.description || 'Ready to let')}</small></div><span>${money(unit.monthlyRent)}</span></div>
  `).join('') : '<p class="muted">No vacant units.</p>';

  const sortedTickets = [...state.maintenance].sort((a, b) => ['closed', 'resolved'].includes(a.status) - ['closed', 'resolved'].includes(b.status));
  $('#maintenance-list').innerHTML = sortedTickets.length ? sortedTickets.map((ticket) => `
    <div class="data-row"><div><strong>${escapeHtml(ticket.ticketNumber)} · ${escapeHtml(ticket.unitName)}</strong><span>${escapeHtml(ticket.description)}</span><small>${escapeHtml(ticket.tenantName)} · ${escapeHtml(ticket.propertyName)}</small></div>${['resolved', 'closed'].includes(ticket.status) ? `<span class="status">${escapeHtml(ticket.status)}</span>` : `<button class="status-button" data-resolve="${escapeHtml(ticket.id)}">Mark resolved</button>`}</div>
  `).join('') : '<p class="muted">No maintenance tickets.</p>';
}

async function refresh() {
  try {
    const [properties, vacant, tenants, arrears, maintenance] = await Promise.all([
      api('/api/properties'), api('/api/units/vacant'), api('/api/tenants'), api('/api/payments/arrears'), api('/api/maintenance'),
    ]);
    Object.assign(state, { properties, vacant, tenants, arrears, maintenance });
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForm(selector, endpoint, successMessage) {
  $(selector).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(formData(form)) });
      form.reset();
      if (result.receiptText) {
        $('#receipt-preview').textContent = result.receiptText;
        $('#receipt-preview').hidden = false;
      }
      toast(successMessage);
      await refresh();
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

bindForm('#property-form', '/api/properties', 'Property saved');
bindForm('#unit-form', '/api/units', 'Unit saved');
bindForm('#tenant-form', '/api/tenants', 'Tenant saved');
bindForm('#payment-form', '/api/payments', 'Payment recorded and receipt generated');

$('#maintenance-list').addEventListener('click', async (event) => {
  const id = event.target.dataset.resolve;
  if (!id) return;
  try {
    await api(`/api/maintenance/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
    toast('Maintenance ticket resolved');
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});

$('#api-key-button').addEventListener('click', () => {
  const current = localStorage.getItem('knight-admin-key') || '';
  const value = window.prompt('Admin API key (leave blank if protection is disabled):', current);
  if (value === null) return;
  if (value) localStorage.setItem('knight-admin-key', value);
  else localStorage.removeItem('knight-admin-key');
  refresh();
});

refresh();
