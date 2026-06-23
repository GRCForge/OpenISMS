const express = require('express');
const { Comment, User, Notification, Asset, Group, Task } = require('../models');
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
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

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

    // ── Mentions ────────────────────────────────────────────────────────────
    const mentionRegex = /@([^@\s,.;:!]+(?:\s+[^@\s,.;:!]+)?)/g;
    let match;
    const mentions = new Set();
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.add(match[1].trim());
    }

    if (mentions.size > 0) {
      const mentionArr = Array.from(mentions);

      const mentionedUsers = await User.findAll({ where: { name: mentionArr, active: true } });

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
              title: `Group mention: @${g.name}`,
              content: `${req.user.name} mentioned group "${g.name}" on asset "${asset?.name || '?'}"`,
              link: `/assets/${assetId}#comment-${comment.id}`, read: false,
            });
          }
        }
      }
      if (groupNotices.length > 0) await Notification.bulkCreate(groupNotices);

      for (const u of mentionedUsers) {
        if (u.id === req.user.id || groupMemberIds.has(u.id)) continue;
        await Notification.create({
          user_id: u.id, actor_id: req.user.id, type: 'mention',
          title: 'Mentioned in comment',
          content: `${req.user.name} mentioned you on asset "${asset?.name || '?'}"`,
          link: `/assets/${assetId}#comment-${comment.id}`,
        });
      }
    }

    // ── Auto-task creation from "- [ ] @mention Task title" lines ───────────
    const createdTasks = [];
    if (!parent_id) {
      const taskLineRegex = /^- \[ \] (.+)$/gm;
      let tMatch;
      while ((tMatch = taskLineRegex.exec(content)) !== null) {
        const lineContent = tMatch[1];
        // Collect all @mentions on this line
        const lineMentionRegex = /@([^@\s,.;:!]+(?:\s+[^@\s,.;:!]+)?)/g;
        const lineMentions = [];
        let lm;
        while ((lm = lineMentionRegex.exec(lineContent)) !== null) {
          lineMentions.push(lm[1].trim());
        }
        // Task title = line content stripped of @mentions
        const taskTitle = lineContent.replace(/@([^@\s,.;:!]+(?:\s+[^@\s,.;:!]+)?)/g, '').replace(/\s+/g, ' ').trim();
        if (!taskTitle) continue;

        let assigned_to_id = null;
        let assigned_to_group_id = null;

        if (lineMentions.length > 0) {
          const mentionName = lineMentions[0];
          const assignedUser = await User.findOne({ where: { name: mentionName, active: true } });
          if (assignedUser) {
            assigned_to_id = assignedUser.id;
          } else {
            const assignedGroup = await Group.findOne({ where: { name: mentionName } });
            if (assignedGroup) assigned_to_group_id = assignedGroup.id;
          }
        }

        const newTask = await Task.create({
          title: taskTitle,
          status: 'open',
          priority: 'medium',
          assigned_to_id,
          assigned_to_group_id,
          related_type: 'asset',
          related_id: parseInt(assetId),
          created_by_id: req.user.id,
          description: `Auto-created from comment on asset "${asset?.name || assetId}"`,
        });
        createdTasks.push(newTask.id);
      }
    }

    const withAuthor = await Comment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role'] }],
    });
    res.status(201).json({ ...withAuthor.toJSON(), _createdTaskCount: createdTasks.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:commentId', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const comment = await Comment.findByPk(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Not found' });
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const asset = await Asset.findByPk(comment.asset_id);
    await comment.destroy();
    if (asset) {
      await auditFromReq(req, 'delete', 'asset', comment.asset_id, asset.name, { action: 'delete_comment', comment_id: comment.id });
    }
    res.json({ message: 'Comment deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
