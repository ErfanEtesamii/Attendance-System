const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use(require('./users'));
router.use(require('./attendance'));

module.exports = router;
