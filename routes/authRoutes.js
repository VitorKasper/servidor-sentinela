const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isGuest } = require('../middleware/authMiddleware');

router.get('/login', isGuest, authController.showLogin);
router.post('/login', isGuest, authController.postLogin);
router.get('/logout', authController.logout);
router.post('/logout', authController.logout);

module.exports = router;
