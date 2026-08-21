const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { requireAdmin, requireOperatorOrAdmin } = require('../middleware/roleMiddleware');

// Listagem e visualização de Workspaces (Admin e Operador)
router.get('/', isAuthenticated, requireOperatorOrAdmin, workspaceController.index);
router.get('/create', isAuthenticated, requireAdmin, workspaceController.showCreate);
router.post('/create', isAuthenticated, requireAdmin, workspaceController.postCreate);
router.get('/:id', isAuthenticated, requireOperatorOrAdmin, workspaceController.show);

// Ações no Workspace (Apenas Admin)
router.post('/:workspaceId/add-project', isAuthenticated, requireAdmin, workspaceController.postAddProject);
router.post('/:id/start-all', isAuthenticated, requireAdmin, workspaceController.startAll);
router.post('/:id/stop-all', isAuthenticated, requireAdmin, workspaceController.stopAll);
router.post('/:id/deploy-all', isAuthenticated, requireAdmin, workspaceController.deployAll);
router.post('/:id/delete', isAuthenticated, requireAdmin, workspaceController.deleteWorkspace);

module.exports = router;
