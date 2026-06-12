'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { ApiToken } = require('../models');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET all active API tokens for the logged-in user
router.get('/', async (req, res) => {
  try {
    const tokens = await ApiToken.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']]
    });
    res.json(tokens);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST generate a new API token
router.post('/', async (req, res) => {
  try {
    const { name, expires_at } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    // Generate a secure token
    const tokenStr = 'isms_api_' + crypto.randomBytes(32).toString('hex');

    const newToken = await ApiToken.create({
      user_id: req.user.id,
      name: name.trim(),
      token: tokenStr,
      expires_at: expires_at ? new Date(expires_at) : null
    });

    res.status(201).json(newToken);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE an API token
router.delete('/:id', async (req, res) => {
  try {
    const token = await ApiToken.findOne({
      where: { id: req.params.id, user_id: req.user.id }
    });

    if (!token) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }

    await token.destroy();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
