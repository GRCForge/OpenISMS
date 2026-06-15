const jwt = require('jsonwebtoken');
const { User, ApiToken } = require('../models');
const { notify } = require('../services/notifyService');

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const token = header.split(' ')[1];

    if (token.startsWith('isms_api_')) {
      // Validate format before DB lookup: prefix + 64 lowercase hex chars
      if (!/^isms_api_[0-9a-f]{64}$/.test(token)) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      const dbToken = await ApiToken.findOne({ where: { token } });
      if (!dbToken) return res.status(401).json({ error: 'Invalid token' });

      // Check for expiration
      if (dbToken.expires_at && new Date(dbToken.expires_at) < new Date()) {
        const userId = dbToken.user_id;
        const tokenName = dbToken.name;
        await dbToken.destroy();
        await notify({
          userId: userId,
          title: 'API-Token abgelaufen',
          content: `Ihr API-Token "${tokenName}" für den Discovery-Agenten ist abgelaufen und wurde gelöscht.`,
          type: 'system'
        });
        return res.status(401).json({ error: 'API Token expired' });
      }

      const user = await User.findByPk(dbToken.user_id, { attributes: { exclude: ['password_hash'] } });
      if (!user || !user.active) return res.status(401).json({ error: 'Unauthorized' });

      req.user = user;
      return next();
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: 'Server misconfigured' });
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    // Block temp TOTP-pending tokens from being used as full session tokens
    if (decoded.totp_pending) return res.status(401).json({ error: 'MFA erforderlich' });
    const user = await User.findByPk(decoded.id, { attributes: { exclude: ['password_hash'] } });
    if (!user || !user.active) return res.status(401).json({ error: 'Unauthorized' });
    
    // Update last seen (async, don't wait)
    user.last_seen_at = new Date();
    user.save().catch(e => console.error('Error updating last_seen_at:', e.message));

    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const requireWriteAccess = () => (req, res, next) => {
  if (req.user.role === 'viewer' || req.user.role === 'management' || req.user.role === 'employee') {
    return res.status(403).json({ error: 'Diese Rolle hat keine Berechtigung für schreibende Zugriffe.' });
  }
  next();
};

const isAdmin = (req) => req.user.role === 'admin';
const isAssessor = (req) => req.user.role === 'admin' || req.user.role === 'assessor';
const isDpo = (req) => req.user.role === 'admin' || req.user.role === 'dpo';
const isItStaff = (req) => req.user.role === 'admin' || req.user.role === 'assessor' || req.user.role === 'it-staff';

module.exports = { authenticate, requireRole, requireWriteAccess, isAdmin, isAssessor, isDpo, isItStaff };
