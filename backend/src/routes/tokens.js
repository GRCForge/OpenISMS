'use strict';

const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const crypto = require('crypto');
const { ApiToken } = require('../models');
const { hashToken } = require('../services/cryptoService');
const { authenticate } = require('../middleware/auth');

// Fields safe to expose to the client — never includes the secret or its hash.
const PUBLIC_ATTRS = ['id', 'user_id', 'name', 'token_prefix', 'expires_at', 'created_at', 'updated_at'];

router.use(authenticate);

// GET all active API tokens for the logged-in user (never returns the secret)
router.get('/', authenticate, async (req, res) => {
  try {
    const tokens = await ApiToken.findAll({
      where: { user_id: req.user.id },
      attributes: PUBLIC_ATTRS,
      order: [['created_at', 'DESC']]
    });
    res.json(tokens);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST generate a new API token
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, expires_at } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    // Generate a secure token — only the hash is persisted; the cleartext is
    // returned once in this response and can never be retrieved again.
    const tokenStr = 'isms_api_' + crypto.randomBytes(32).toString('hex');

    const newToken = await ApiToken.create({
      user_id: req.user.id,
      name: name.trim(),
      token: null,
      token_hash: hashToken(tokenStr),
      token_prefix: tokenStr.slice(0, 17), // "isms_api_" + first 8 hex chars
      expires_at: expires_at ? new Date(expires_at) : null
    });

    // Return the plaintext token exactly once, alongside the public fields.
    res.status(201).json({
      id: newToken.id,
      user_id: newToken.user_id,
      name: newToken.name,
      token_prefix: newToken.token_prefix,
      expires_at: newToken.expires_at,
      created_at: newToken.created_at,
      updated_at: newToken.updated_at,
      token: tokenStr
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE an API token
router.delete('/:id', authenticate, async (req, res) => {
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
