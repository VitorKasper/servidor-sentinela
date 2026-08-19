const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');
const { uploadLogo } = require('../middleware/uploadMiddleware');

// Rota para atualização da marca e upload da logo (Apenas Admin)
router.post('/api/settings/company', isAuthenticated, requireAdmin, uploadLogo, settingController.updateCompany);

module.exports = router;
