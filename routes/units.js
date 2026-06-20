const express = require('express');
const { db, FieldValue } = require('../firebase');

const router = express.Router();

function unitFromDoc(doc) {
  return { id: doc.id, ...doc.data() };
}

router.get('/vacant', async (_req, res, next) => {
  try {
    const snapshot = await db.collection('units').where('status', '==', 'vacant').get();
    res.json(snapshot.docs.map(unitFromDoc));
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    let query = db.collection('units');
    if (req.query.propertyId) query = query.where('propertyId', '==', req.query.propertyId);
    const snapshot = await query.get();
    res.json(snapshot.docs.map(unitFromDoc));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { propertyId, name, monthlyRent, description = '' } = req.body;
    const rent = Number(monthlyRent);
    if (!propertyId || !name || !Number.isFinite(rent) || rent < 0) {
      return res.status(400).json({ error: 'propertyId, name, and a valid monthlyRent are required' });
    }

    const property = await db.collection('properties').doc(propertyId).get();
    if (!property.exists) return res.status(404).json({ error: 'Property not found' });

    const duplicate = await db.collection('units')
      .where('propertyId', '==', propertyId)
      .where('name', '==', String(name).trim())
      .limit(1)
      .get();
    if (!duplicate.empty) return res.status(409).json({ error: 'This unit already exists at the property' });

    const ref = await db.collection('units').add({
      propertyId,
      propertyName: property.data().name,
      name: String(name).trim(),
      monthlyRent: rent,
      description: String(description).trim(),
      status: 'vacant',
      tenantId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ id: ref.id, message: 'Unit added' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
