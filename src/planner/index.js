import { createPlannerService } from './service.js';
import { createWorkspaceStorage } from './storage.js';
import { createExtensionConnections } from '../integrations/client.js';
import { requestAnalysis, requestPlan, requestChat } from '../analysis-client.js';

export { createPlannerService } from './service.js';
export { buildPlanningContext, generateWorkspacePlan, validateStudyPlan } from './planning.js';
export { createWorkspaceStorage } from './storage.js';
export function createBrowserPlanner(options = {}) {
  return createPlannerService({ storage: createWorkspaceStorage(), connections: createExtensionConnections(), ai: { analyse: requestAnalysis, plan: requestPlan, chat: requestChat }, ...options });
}
