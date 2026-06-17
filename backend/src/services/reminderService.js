const cron = require('node-cron');
const { Op } = require('sequelize');
const { Reminder, Asset, User, Assessment, Notification, UserTraining } = require('../models');
const { sendEmail } = require('./emailService');

const checkOverdueReminders = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Find reminders that are about to become overdue, with asset owner included
    const pendingOverdue = await Reminder.findAll({
      where: { status: 'pending', due_date: { [Op.lt]: today } },
      include: [
        {
          model: Asset,
          foreignKey: 'asset_id',
          include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
        },
      ],
    });

    if (pendingOverdue.length > 0) {
      // Mark all as overdue in bulk
      await Reminder.update(
        { status: 'overdue' },
        { where: { status: 'pending', due_date: { [Op.lt]: today } } }
      );

      console.log(`[Reminders] Marked ${pendingOverdue.length} reminders as overdue`);

      // Send notification emails to asset owners
      for (const reminder of pendingOverdue) {
        try {
          const ownerEmail = reminder.Asset?.owner?.email;
          if (!ownerEmail) continue;

          const assetName = reminder.Asset?.name || 'Unbekanntes Asset';
          const ownerName = reminder.Asset?.owner?.name || 'Asset-Verantwortliche(r)';

          await sendEmail({
            to: ownerEmail,
            subject: `[OpenISMS] Überfälliger Reminder: ${reminder.title || assetName}`,
            text: `Hallo ${ownerName},\n\nder folgende Reminder ist überfällig:\n\nAsset: ${assetName}\nFälligkeit: ${reminder.due_date}\n\nBitte überprüfen Sie den Status in OpenISMS.\n\nMit freundlichen Grüßen\nIhr OpenISMS-System`,
            html: `<p>Hallo ${ownerName},</p><p>der folgende Reminder ist <strong>überfällig</strong>:</p><ul><li><strong>Asset:</strong> ${assetName}</li><li><strong>Fälligkeit:</strong> ${reminder.due_date}</li></ul><p>Bitte überprüfen Sie den Status in OpenISMS.</p><p>Mit freundlichen Grüßen<br>Ihr OpenISMS-System</p>`,
          });
        } catch (mailErr) {
          // Email is optional – log but do not break the cron job
          console.warn(`[Reminders] Could not send overdue email for reminder ${reminder.id}:`, mailErr.message);
        }
      }
    }
  } catch (e) {
    console.error('[Reminders] Error checking overdue:', e.message);
  }
};

// Send 30-day advance warning for expiring risk acceptances
const checkExpiringAcceptances = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const warn30 = in30.toISOString().split('T')[0];

    // Current assessments whose acceptance expires within 30 days
    const expiring = await Assessment.findAll({
      where: {
        is_current: true,
        risk_treatment: 'accept',
        accepted_until: { [Op.between]: [today, warn30] },
      },
      include: [
        {
          model: Asset,
          where: { status: { [Op.ne]: 'decommissioned' } },
          include: [
            { model: User, as: 'owner',    attributes: ['id', 'name', 'email'] },
            { model: User, as: 'assessor', attributes: ['id', 'name', 'email'] },
          ],
        },
      ],
    });

    for (const assessment of expiring) {
      const asset = assessment.Asset;
      if (!asset) continue;
      const recipients = [asset.owner, asset.assessor].filter(Boolean).filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i);

      for (const u of recipients) {
        // Avoid duplicate in-app notifications: skip if one was already sent today
        const existing = await Notification.findOne({
          where: {
            user_id: u.id,
            type: 'system',
            title: 'Risikoakzeptanz läuft ab',
            link: `/assets/${asset.id}`,
            created_at: { [Op.gte]: new Date(today) },
          },
        });
        if (existing) continue;

        await Notification.create({
          user_id: u.id,
          actor_id: null,
          type: 'system',
          title: 'Risikoakzeptanz läuft ab',
          content: `Die Risikoakzeptanz für Asset „${asset.name}" läuft am ${assessment.accepted_until} ab. Bitte überprüfen.`,
          link: `/assets/${asset.id}`,
          read: false,
        });

        try {
          if (u.email) {
            await sendEmail({
              to: u.email,
              subject: `[OpenISMS] Risikoakzeptanz läuft ab: ${asset.name}`,
              text: `Hallo ${u.name},\n\ndie Risikoakzeptanz für das Asset „${asset.name}" läuft am ${assessment.accepted_until} ab.\n\nBitte überprüfen Sie in OpenISMS, ob die Akzeptanz erneuert oder das Risiko anders behandelt werden soll.\n\nMit freundlichen Grüßen\nIhr OpenISMS-System`,
              html: `<p>Hallo ${u.name},</p><p>die Risikoakzeptanz für das Asset <strong>${asset.name}</strong> läuft am <strong>${assessment.accepted_until}</strong> ab.</p><p>Bitte überprüfen Sie in OpenISMS, ob die Akzeptanz erneuert oder das Risiko anders behandelt werden soll.</p><p>Mit freundlichen Grüßen<br>Ihr OpenISMS-System</p>`,
            });
          }
        } catch (mailErr) {
          console.warn(`[Reminders] Could not send acceptance expiry email to ${u.email}:`, mailErr.message);
        }
      }
    }

    if (expiring.length > 0) {
      console.log(`[Reminders] Notified about ${expiring.length} expiring risk acceptance(s)`);
    }
  } catch (e) {
    console.error('[Reminders] Error checking acceptance expiry:', e.message);
  }
};

const checkExpiringTrainings = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const warn30 = in30.toISOString().split('T')[0];

    // Find all trainings that have an expiration date
    const trainings = await UserTraining.findAll({
      where: {
        expires_at: { [Op.ne]: null }
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] }
      ]
    });

    for (const training of trainings) {
      let newStatus = 'valid';
      if (training.expires_at < today) {
        newStatus = 'expired';
      } else if (training.expires_at <= warn30) {
        newStatus = 'warning';
      }

      if (training.status !== newStatus) {
        await training.update({ status: newStatus });
        console.log(`[Reminders] Updated training #${training.id} status to ${newStatus}`);

        // Notify user if warning or expired
        if (newStatus !== 'valid' && training.user) {
          const user = training.user;
          const statusText = newStatus === 'expired' ? 'ist abgelaufen' : 'läuft bald ab';
          const titleText = `Schulung ${newStatus === 'expired' ? 'abgelaufen' : 'läuft ab'}: ${training.training_title}`;

          // Avoid duplicate notifications on the same day for this training
          const existing = await Notification.findOne({
            where: {
              user_id: user.id,
              type: 'reminder',
              title: titleText,
              created_at: { [Op.gte]: new Date(today) },
            }
          });

          if (!existing) {
            await Notification.create({
              user_id: user.id,
              actor_id: null,
              type: 'reminder',
              title: titleText,
              content: `Ihre Schulung „${training.training_title}“ ${statusText} (Ablaufdatum: ${training.expires_at}). Bitte erneuern Sie diese zeitnah.`,
              link: '/compliance',
              read: false,
            });

            try {
              if (user.email) {
                await sendEmail({
                  to: user.email,
                  subject: `[OpenISMS] Sicherheitsschulung ${newStatus === 'expired' ? 'abgelaufen' : 'läuft bald ab'}: ${training.training_title}`,
                  text: `Hallo ${user.name},\n\nihre Schulung „${training.training_title}“ ${statusText} (Ablaufdatum: ${training.expires_at}).\n\nBitte melden Sie sich in OpenISMS an, um die Schulung zu erneuern.\n\nMit freundlichen Grüßen\nIhr OpenISMS-System`,
                  html: `<p>Hallo ${user.name},</p><p>ihre Sicherheitsschulung <strong>${training.training_title}</strong> ${statusText} (Ablaufdatum: <strong>${training.expires_at}</strong>).</p><p>Bitte melden Sie sich in OpenISMS an, um die Schulung zu erneuern.</p><p>Mit freundlichen Grüßen<br>Ihr OpenISMS-System</p>`,
                });
              }
            } catch (mailErr) {
              console.warn(`[Reminders] Could not send training notification email to ${user.email}:`, mailErr.message);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[Reminders] Error checking training expiry:', e.message);
  }
};

const startReminderService = () => {
  // Run daily at midnight
  cron.schedule('0 0 * * *', checkOverdueReminders);
  // Run daily at 08:00 — check for acceptance expirations within 30 days
  cron.schedule('0 8 * * *', checkExpiringAcceptances);
  // Run daily at 08:00 — check for training expirations
  cron.schedule('0 8 * * *', checkExpiringTrainings);
  
  // Run once on startup
  checkOverdueReminders();
  checkExpiringAcceptances();
  checkExpiringTrainings();
  console.log('[Reminders] Service started');
};

module.exports = { startReminderService };
