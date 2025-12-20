/**
 * KoKive Shorts Routes
 * 쇼츠폼 관련 사용자 API 엔드포인트 (FR-014 사용자 측)
 */

const express = require('express');
const router = express.Router();
const shortsController = require('../controllers/shortsController');
const { optionalAuth } = require('../middlewares/auth');
const { validatePagination } = require('../middlewares/validator');

/**
 * GET /api/v1/shorts
 * 쇼츠폼 목록 (공개된 것만)
 */
router.get('/', validatePagination, optionalAuth, shortsController.getPublishedShorts);

/**
 * GET /api/v1/shorts/:id
 * 쇼츠폼 상세 조회
 */
router.get('/:id', optionalAuth, shortsController.getShortsById);

/**
 * GET /api/v1/shorts/paper/:paperId
 * 특정 논문의 쇼츠폼 목록
 */
router.get('/paper/:paperId', optionalAuth, shortsController.getShortsByPaper);

/**
 * POST /api/v1/shorts/:id/track
 * 쇼츠폼 클릭 트래킹 (UTM 파라미터 기반)
 */
router.post('/:id/track', shortsController.trackClick);

module.exports = router;
