const express = require('express');
const router = express.Router();
const tradeController = require('../controllers/tradeController');
const healthRoutes = require('./health');

// Trade routes
router.get('/trades', tradeController.getTrades);
router.post('/trades', tradeController.createTrade);
router.get('/trades/generate', tradeController.generateFakeTrades);
router.get('/trades/ohlc', tradeController.getOHLC);
router.get('/symbols', tradeController.getSymbols);

// Health and monitoring routes
router.use('/', healthRoutes);

module.exports = router;
