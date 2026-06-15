const express = require('express');
const { Comment, User, Notification, Asset, Group } = require('../models');
const { authenticate, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

const router = express.Router({ mergeParams: true });
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

router.get('/', authenticate, async (req, res) => {
  try {
    const comments = await Comment.findAll({
      where: { asset_id: req.params.assetId },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role'] }],
      order: [['created_at', 'ASC']],
    });
    res.json(comments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const { content, meeting_date, parent_id } = req.body;
    const assetId = req.params.assetId;
    if (!content?.trim()) return res.status(400).json({ error: 'Inhalt erforderlich' });

    const comment = await Comment.create({
      asset_id: assetId,
      user_id: req.user.id,
      parent_id: parent_id || null,
      content: content.trim(),
      meeting_date: meeting_date || null,
    });

    const asset = await Asset.findByPk(assetId);
    if (asset) {
      await auditFromReq(req, 'create', 'asset', asset.id, asset.name, { action: 'add_comment', comment_id: comment.id, meeting: !!comment.meeting_date });
    }

    // Mentions logic: find @Name in content
    // Regex for @ followed by characters until space or punctuation
    const mentionRegex = /@([^@\s,.;:!]+(?:\s+[^@\s,.;:!]+)?)/g;
    let match;
    const mentions = new Set();
    
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.add(match[1].trim());
    }

    if (mentions.size > 0) {
      const mentionArr = Array.from(mentions);

      // Find directly mentioned users
      const mentionedUsers = await User.findAll({ where: { name: mentionArr, active: true } });

      // Find mentioned groups (by name) and collect their members
      const mentionedGroups = await Group.findAll({
        where: { name: mentionArr },
        include: [{ model: User, as: 'members', attributes: ['id', 'name'], through: { attributes: [] } }],
      });
      const groupMemberIds = new Set();
      const groupNotices = [];
      for (const g of mentionedGroups) {
        for (const m of (g.members || [])) {
          if (m.id !== req.user.id && !groupMemberIds.has(m.id)) {
            groupMemberIds.add(m.id);
            groupNotices.push({
              user_id: m.id, actor_id: req.user.id, type: 'mention',
              title: `Gruppen-Erwähnung: @${g.name}`,
              content: `${req.user.name} hat die Gruppe "${g.name}" bei Asset "${asset?.name || '?'}" erwähnt.`,
              link: `/assets/${assetId}#comment-${comment.id}`, read: false,
            });
          }
        }
      }
      if (groupNotices.length > 0) await Notification.bulkCreate(groupNotices);

      // Individual user notifications (skip those already notified via group)
      for (const u of mentionedUsers) {
        if (u.id === req.user.id || groupMemberIds.has(u.id)) continue;
        await Notification.create({
          user_id: u.id, actor_id: req.user.id, type: 'mention',
          title: 'Erwähnung in Kommentar',
          content: `${req.user.name} hat Sie bei Asset "${asset?.name || '?'}" erwähnt.`,
          link: `/assets/${assetId}#comment-${comment.id}`,
        });
      }
    }

    const withAuthor = await Comment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role'] }],
    });
    res.status(201).json(withAuthor);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:commentId', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const comment = await Comment.findByPk(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Nicht gefunden' });
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    const asset = await Asset.findByPk(comment.asset_id);
    await comment.destroy();
    if (asset) {
      await auditFromReq(req, 'delete', 'asset', comment.asset_id, asset.name, { action: 'delete_comment', comment_id: comment.id });
    }
    res.json({ message: 'Kommentar gelöscht' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
