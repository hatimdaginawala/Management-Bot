// src/bot/commands/event/handlers.js
import { handleView } from './view.js';
import { handleList } from './list.js';
import { handleApprove } from './approve.js';
import { handleReject } from './reject.js';
import { handleCancel } from './cancel.js';
import { handleTypes } from './types.js';
import { handleStats } from './stats.js';

export const HANDLERS = {
  view: handleView,
  list: handleList,
  approve: handleApprove,
  reject: handleReject,
  cancel: handleCancel,
  types: handleTypes,
  stats: handleStats,
};