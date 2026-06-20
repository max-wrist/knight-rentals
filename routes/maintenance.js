const express = require('express');
const { db, FieldValue } = require('../firebase');

const router = express.Router();

async function createMaintenanceTicket(tenant, description) {
  const cleanDescription = String(description || '').trim();
  if (!tenant?.id || !cleanDescription) {
    throw Object.assign(new Error('A tenant and issue description are required'), { status: 400 });
  }

  const ref = db.collection('maintenance').doc();
  const ticketNumber = `MT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${ref.id.slice(-5).toUpperCase()}`;
  const ticket = {
    ticketNumber,
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantPhone: tenant.phone,
    propertyId: tenant.propertyId,
    propertyName: tenant.propertyName,
    unitId: tenant.unitId,
    unitName: tenant.unitName,
    description: cleanDescription,
    priority: 'normal',
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(ticket);
  return { id: ref.id, ...ticket };
}

router.get('/', async (req, res, next) => {
  try {
    let query = db.collection('maintenance');
    if (req.query.status) query = query.where('status', '==', req.query.status);
    const snapshot = await query.get();
    res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { tenantId, description } = req.body;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) return res.status(404).json({ error: 'Tenant not found' });
    const ticket = await createMaintenanceTicket({ id: tenantDoc.id, ...tenantDoc.data() }, description);
    return res.status(201).json({ ...ticket, message: 'Maintenance ticket created' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const allowedStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    const update = {};
    if (req.body.status) {
      if (!allowedStatuses.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(', ')}` });
      }
      update.status = req.body.status;
    }
    if (req.body.priority) update.priority = String(req.body.priority);
    if (req.body.adminNotes !== undefined) update.adminNotes = String(req.body.adminNotes);
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No supported fields supplied' });

    const ref = db.collection('maintenance').doc(req.params.id);
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'Ticket not found' });
    update.updatedAt = FieldValue.serverTimestamp();
    if (update.status === 'resolved' || update.status === 'closed') update.resolvedAt = FieldValue.serverTimestamp();
    await ref.update(update);
    return res.json({ id: ref.id, message: 'Maintenance ticket updated' });
  } catch (error) {
    return next(error);
  }
});

module.exports = { router, createMaintenanceTicket };
