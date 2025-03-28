const express = require('express');
const router = express.Router();
const tradeController = require('../controllers/tradeController');

// Trade routes
router.get('/trades', tradeController.getTrades);
router.post('/trades', tradeController.createTrade);
router.get('/trades/generate', tradeController.generateFakeTrades);
router.get('/trades/ohlc', tradeController.getOHLC);
router.get('/symbols', tradeController.getSymbols);

module.exports = router;
