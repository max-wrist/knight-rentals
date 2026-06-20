const express = require('express');
const { db, FieldValue } = require('../firebase');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const snapshot = await db.collection('properties').orderBy('name').get();
    res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, address, landlordName, paymentInstructions = '' } = req.body;
    if (!name || !address) {
      return res.status(400).json({ error: 'name and address are required' });
    }

    const ref = await db.collection('properties').add({
      name: String(name).trim(),
      address: String(address).trim(),
      landlordName: String(landlordName || '').trim(),
      paymentInstructions: String(paymentInstructions).trim(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ id: ref.id, message: 'Property added' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
