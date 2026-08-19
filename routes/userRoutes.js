const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');

// Todas as rotas de usuários exigem autenticação e privilégio ADMIN
router.use(isAuthenticated, requireAdmin);

router.get('/', userController.index);
router.post('/create', userController.create);
router.post('/:id/update', userController.update);
router.post('/:id/delete', userController.delete);

module.exports = router;
