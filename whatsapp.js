const axios = require('axios');

const GRAPH_API_VERSION = 'v22.0';

function normalizePhone(phone = '') {
  return String(phone).replace(/\D/g, '');
}

async function sendWhatsAppMessage(to, body) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required');
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const response = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizePhone(to),
      type: 'text',
      text: { preview_url: false, body },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    },
  );

  return response.data;
}

function formatMoney(amount, currency = 'KES') {
  return `${currency} ${Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatReceipt(payment, tenant = {}) {
  const dateValue = payment.paymentDate?.toDate
    ? payment.paymentDate.toDate()
    : new Date(payment.paymentDate || Date.now());

  return [
    '🛡️ KNIGHT RENTALS',
    'PAYMENT RECEIPT',
    `Receipt: ${payment.receiptNumber}`,
    `Date: ${dateValue.toLocaleDateString('en-KE')}`,
    `Tenant: ${tenant.name || payment.tenantName || '-'}`,
    `Unit: ${tenant.unitName || payment.unitName || '-'}`,
    `Amount: ${formatMoney(payment.amount, payment.currency)}`,
    `Method: ${payment.method || '-'}`,
    `Reference: ${payment.reference || '-'}`,
    `Balance after payment: ${formatMoney(payment.balanceAfter, payment.currency)}`,
    '',
    'Thank you for your payment.',
  ].join('\n');
}

module.exports = { sendWhatsAppMessage, normalizePhone, formatMoney, formatReceipt };
