const express = require('express');
const router = express.Router();
const terminalController = require('../controllers/terminalController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');

// Terminal administrativo do host: exclusivo para ADMIN
router.use(isAuthenticated, requireAdmin);

router.get('/', terminalController.showTerminal);
router.get('/stream', terminalController.streamOutput);
router.post('/exec', terminalController.execCommand);
router.post('/kill', terminalController.killSession);

module.exports = router;
