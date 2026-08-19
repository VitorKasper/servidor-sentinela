const express = require('express');
const router = express.Router();
const portController = require('../controllers/portController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { requireOperatorOrAdmin } = require('../middleware/roleMiddleware');

// Rotas de visualização e checagem de portas (Admin e Operador)
router.get('/ports', isAuthenticated, requireOperatorOrAdmin, portController.index);
router.get('/api/ports/status', isAuthenticated, requireOperatorOrAdmin, portController.apiStatus);
router.get('/api/ports/check/:port', isAuthenticated, requireOperatorOrAdmin, portController.apiCheck);
router.get('/api/ports/suggest', isAuthenticated, requireOperatorOrAdmin, portController.apiSuggest);

module.exports = router;
