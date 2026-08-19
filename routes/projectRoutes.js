const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { requireAdmin, requireOperatorOrAdmin } = require('../middleware/roleMiddleware');

// Listagem de projetos (Admin e Operador)
router.get('/', isAuthenticated, requireOperatorOrAdmin, projectController.index);

// Criação de projetos (Apenas Admin)
router.get('/create', isAuthenticated, requireAdmin, projectController.showCreate);
router.post('/create', isAuthenticated, requireAdmin, projectController.postCreate);

// Edição de projetos (Apenas Admin)
router.get('/:id/edit', isAuthenticated, requireAdmin, projectController.showEdit);
router.post('/:id/edit', isAuthenticated, requireAdmin, projectController.postEdit);

// Exclusão de projetos (Apenas Admin)
router.post('/:id/delete', isAuthenticated, requireAdmin, projectController.deleteProject);

module.exports = router;
