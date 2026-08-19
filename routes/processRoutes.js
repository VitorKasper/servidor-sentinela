const express = require('express');
const router = express.Router();
const processController = require('../controllers/processController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { requireOperatorOrAdmin } = require('../middleware/roleMiddleware');

// Terminal e monitoramento (Admin e Operador)
router.get('/:id/terminal', isAuthenticated, requireOperatorOrAdmin, processController.showTerminal);

// Ações de controle de execução e ciclo de vida (Admin e Operador)
router.post('/:id/start', isAuthenticated, requireOperatorOrAdmin, processController.start);
router.post('/:id/stop', isAuthenticated, requireOperatorOrAdmin, processController.stop);
router.post('/:id/restart', isAuthenticated, requireOperatorOrAdmin, processController.restart);
router.post('/:id/redeploy', isAuthenticated, requireOperatorOrAdmin, processController.redeploy);

// Gerenciamento de logs
router.get('/:id/logs', isAuthenticated, requireOperatorOrAdmin, processController.getLogs);
router.post('/:id/clear-logs', isAuthenticated, requireOperatorOrAdmin, processController.clearLogs);

module.exports = router;
