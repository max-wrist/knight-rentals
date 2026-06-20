const express = require('express');
const { db, FieldValue, Timestamp } = require('../firebase');
const { formatReceipt } = require('../whatsapp');

const router = express.Router();

function receiptNumber(id) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `KR-${date}-${id.slice(-6).toUpperCase()}`;
}

async function getLastPayment(tenantId) {
  const snapshot = await db.collection('payments').where('tenantId', '==', tenantId).get();
  if (snapshot.empty) return null;
  const payments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  payments.sort((a, b) => {
    const aTime = a.paymentDate?.toMillis?.() || 0;
    const bTime = b.paymentDate?.toMillis?.() || 0;
    return bTime - aTime;
  });
  return payments[0];
}

async function recordPayment(input) {
  const { tenantId, method = 'Other', reference = '', notes = '', paymentDate } = input;
  const amount = Number(input.amount);
  if (!tenantId || !Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error('tenantId and an amount greater than zero are required'), { status: 400 });
  }

  const tenantRef = db.collection('tenants').doc(tenantId);
  const paymentRef = db.collection('payments').doc();
  let paymentRecord;

  await db.runTransaction(async (transaction) => {
    const tenantDoc = await transaction.get(tenantRef);
    if (!tenantDoc.exists) throw Object.assign(new Error('Tenant not found'), { status: 404 });

    const tenant = tenantDoc.data();
    const balanceBefore = Number(tenant.balance || 0);
    const balanceAfter = balanceBefore - amount;
    paymentRecord = {
      tenantId,
      tenantName: tenant.name,
      propertyId: tenant.propertyId,
      propertyName: tenant.propertyName,
      unitId: tenant.unitId,
      unitName: tenant.unitName,
      receiptNumber: receiptNumber(paymentRef.id),
      amount,
      currency: tenant.currency || 'KES',
      method: String(method).trim(),
      reference: String(reference).trim(),
      notes: String(notes).trim(),
      balanceBefore,
      balanceAfter,
      paymentDate: paymentDate ? Timestamp.fromDate(new Date(paymentDate)) : Timestamp.now(),
      createdAt: FieldValue.serverTimestamp(),
    };

    transaction.set(paymentRef, paymentRecord);
    transaction.update(tenantRef, { balance: balanceAfter, updatedAt: FieldValue.serverTimestamp() });
  });

  return { id: paymentRef.id, ...paymentRecord };
}

router.get('/arrears', async (_req, res, next) => {
  try {
    const snapshot = await db.collection('tenants').where('status', '==', 'active').get();
    const arrears = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((tenant) => Number(tenant.balance || 0) > 0)
      .sort((a, b) => Number(b.balance) - Number(a.balance));
    res.json(arrears);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    let query = db.collection('payments');
    if (req.query.tenantId) query = query.where('tenantId', '==', req.query.tenantId);
    const snapshot = await query.get();
    const payments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    payments.sort((a, b) => (b.paymentDate?.toMillis?.() || 0) - (a.paymentDate?.toMillis?.() || 0));
    res.json(payments);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const payment = await recordPayment(req.body);
    const tenant = (await db.collection('tenants').doc(payment.tenantId).get()).data();
    res.status(201).json({
      ...payment,
      receiptText: formatReceipt(payment, tenant),
      message: 'Payment recorded',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = { router, recordPayment, getLastPayment };
