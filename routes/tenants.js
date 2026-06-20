const express = require('express');
const { db, FieldValue } = require('../firebase');
const { normalizePhone } = require('../whatsapp');

const router = express.Router();

async function findTenantByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  const snapshot = await db.collection('tenants')
    .where('phone', '==', normalizedPhone)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

router.get('/', async (_req, res, next) => {
  try {
    const snapshot = await db.collection('tenants').get();
    res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, phone, unitId, balance = 0, email = '' } = req.body;
    const normalizedPhone = normalizePhone(phone);
    const openingBalance = Number(balance);

    if (!name || !normalizedPhone || !unitId || !Number.isFinite(openingBalance) || openingBalance < 0) {
      return res.status(400).json({ error: 'name, phone, unitId, and a valid non-negative balance are required' });
    }

    const existing = await db.collection('tenants').where('phone', '==', normalizedPhone).limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: 'A tenant with this phone number already exists' });

    const tenantRef = db.collection('tenants').doc();
    const unitRef = db.collection('units').doc(unitId);

    await db.runTransaction(async (transaction) => {
      const unitDoc = await transaction.get(unitRef);
      if (!unitDoc.exists) throw Object.assign(new Error('Unit not found'), { status: 404 });
      const unit = unitDoc.data();
      if (unit.status !== 'vacant') throw Object.assign(new Error('Unit is already occupied'), { status: 409 });

      transaction.set(tenantRef, {
        name: String(name).trim(),
        phone: normalizedPhone,
        email: String(email).trim(),
        propertyId: unit.propertyId,
        propertyName: unit.propertyName,
        unitId,
        unitName: unit.name,
        monthlyRent: Number(unit.monthlyRent || 0),
        balance: openingBalance,
        currency: 'KES',
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(unitRef, {
        status: 'occupied',
        tenantId: tenantRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return res.status(201).json({ id: tenantRef.id, message: 'Tenant added and unit occupied' });
  } catch (error) {
    return next(error);
  }
});

module.exports = { router, findTenantByPhone };
