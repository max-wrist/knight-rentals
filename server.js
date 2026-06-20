require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { db, FieldValue } = require('./firebase');
const { sendWhatsAppMessage, normalizePhone, formatMoney, formatReceipt } = require('./whatsapp');
const { router: tenantsRouter, findTenantByPhone } = require('./routes/tenants');
const propertiesRouter = require('./routes/properties');
const unitsRouter = require('./routes/units');
const { router: paymentsRouter, getLastPayment } = require('./routes/payments');
const { router: maintenanceRouter, createMaintenanceTicket } = require('./routes/maintenance');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdminApiKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return next();
  const supplied = req.get('x-admin-api-key');
  if (supplied !== expected) return res.status(401).json({ error: 'Invalid or missing admin API key' });
  return next();
}

app.get('/health', (_req, res) => res.json({ service: 'Knight Rentals', status: 'ok' }));

// Meta calls this endpoint once when the webhook is configured.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

async function isLandlord(phone) {
  const snapshot = await db.collection('admins')
    .where('phone', '==', normalizePhone(phone))
    .limit(1)
    .get();
  return !snapshot.empty && snapshot.docs[0].data().active !== false;
}

async function markMessageProcessed(messageId) {
  if (!messageId) return true;
  try {
    await db.collection('processedMessages').doc(messageId).create({
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    if (error.code === 6 || error.code === 'already-exists') return false;
    throw error;
  }
}

async function arrearsMessage() {
  const snapshot = await db.collection('tenants').where('status', '==', 'active').get();
  const tenants = snapshot.docs
    .map((doc) => doc.data())
    .filter((tenant) => Number(tenant.balance || 0) > 0)
    .sort((a, b) => Number(b.balance) - Number(a.balance));

  if (!tenants.length) return '🛡️ Knight Rentals\nNo active tenants are currently in arrears.';
  const visible = tenants.slice(0, 30);
  const lines = visible.map((tenant, index) =>
    `${index + 1}. ${tenant.name} — ${tenant.propertyName || ''} ${tenant.unitName || ''}: ${formatMoney(tenant.balance, tenant.currency)}`,
  );
  if (tenants.length > visible.length) lines.push(`…and ${tenants.length - visible.length} more. View the dashboard for the full list.`);
  const total = tenants.reduce((sum, tenant) => sum + Number(tenant.balance || 0), 0);
  return ['🛡️ KNIGHT RENTALS ARREARS', ...lines, '', `Total: ${formatMoney(total)}`].join('\n');
}

async function handleWhatsAppText(from, text) {
  const input = String(text || '').trim();
  const command = input.toLowerCase();

  if (command === 'arrears') {
    if (!(await isLandlord(from))) {
      return sendWhatsAppMessage(from, 'This command is available to registered landlords only.');
    }
    return sendWhatsAppMessage(from, await arrearsMessage());
  }

  const tenant = await findTenantByPhone(from);
  if (!tenant) {
    return sendWhatsAppMessage(
      from,
      'Welcome to Knight Rentals. This number is not linked to an active tenancy. Please contact your landlord.',
    );
  }

  if (command === 'balance') {
    const position = Number(tenant.balance || 0);
    const label = position > 0 ? 'Amount due' : position < 0 ? 'Credit balance' : 'Balance';
    return sendWhatsAppMessage(
      from,
      `🛡️ Knight Rentals\n${tenant.name}\n${tenant.propertyName || ''} — Unit ${tenant.unitName || '-'}\n${label}: ${formatMoney(Math.abs(position), tenant.currency)}`,
    );
  }

  if (command === 'receipt') {
    const payment = await getLastPayment(tenant.id);
    const reply = payment
      ? formatReceipt(payment, tenant)
      : 'No payment receipt was found for your tenancy.';
    return sendWhatsAppMessage(from, reply);
  }

  if (command === 'pay') {
    const property = tenant.propertyId
      ? await db.collection('properties').doc(tenant.propertyId).get()
      : null;
    const instructions = property?.exists ? property.data().paymentInstructions : '';
    return sendWhatsAppMessage(
      from,
      instructions
        ? `🛡️ Knight Rentals payment instructions\n${instructions}\nUse your unit (${tenant.unitName}) as the payment reference.`
        : 'Payment instructions have not been configured. Please contact your landlord before paying.',
    );
  }

  if (command === 'report issue' || command.startsWith('report issue ')) {
    const description = input.slice('report issue'.length).trim();
    if (!description) {
      return sendWhatsAppMessage(from, 'Please describe the problem, for example: report issue leaking pipe');
    }
    const ticket = await createMaintenanceTicket(tenant, description);
    return sendWhatsAppMessage(
      from,
      `Maintenance ticket ${ticket.ticketNumber} has been opened for Unit ${tenant.unitName}. We will keep you updated.`,
    );
  }

  return sendWhatsAppMessage(
    from,
    '🛡️ Knight Rentals commands:\n• balance\n• receipt\n• pay\n• report issue <describe the problem>',
  );
}

async function processWebhook(body) {
  const changes = body.entry?.flatMap((entry) => entry.changes || []) || [];
  const messages = changes.flatMap((change) => change.value?.messages || []);

  for (const message of messages) {
    if (message.type !== 'text' || !(await markMessageProcessed(message.id))) continue;
    await handleWhatsAppText(message.from, message.text?.body || '');
  }
}

app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  processWebhook(req.body).catch((error) => console.error('Webhook processing failed:', error.response?.data || error));
});

app.use('/api', requireAdminApiKey);
app.use('/api/properties', propertiesRouter);
app.use('/api/units', unitsRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/maintenance', maintenanceRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error.status) || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message });
});

if (require.main === module) {
  app.listen(port, () => console.log(`Knight Rentals running on http://localhost:${port}`));
}

module.exports = { app, handleWhatsAppText, processWebhook };
