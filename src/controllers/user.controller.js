import * as userService from '../services/user.service.js';

export async function listUsers(req, res) {
  const result = await userService.listMembers({
    status: req.query.status,
    roleKey: req.query.roleKey,
    quotaCategory: req.query.quotaCategory,
    search: req.query.search,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function getUser(req, res) {
  const profile = await userService.getMemberProfile(req.params.discordId);
  if (profile) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'User not found.' },
    });
  }
  res.json({ success: true, data: profile });
}

export async function getUserHistory(req, res) {
  const history = await userService.getMemberHistory(req.params.discordId, {
    limit: req.query.limit,
  });
  if (history) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'User not found.' },
    });
  }
  res.json({ success: true, data: history });
}
