/**
 * KoKive Term Routes
 * 전문 용어 관련 API 엔드포인트 (FR-004)
 */

const express = require('express');
const router = express.Router();
const termController = require('../controllers/termController');
const { validatePagination } = require('../middlewares/validator');

/**
 * GET /api/v1/terms
 * 용어 목록 조회
 */
router.get('/', validatePagination, termController.getTerms);

/**
 * GET /api/v1/terms/search
 * 용어 검색
 */
router.get('/search', termController.searchTerms);

/**
 * GET /api/v1/terms/categories
 * 용어 카테고리 목록
 */
router.get('/categories', termController.getCategories);

/**
 * GET /api/v1/terms/lookup/:term
 * 용어 조회 (영어/한국어 용어로 검색)
 */
router.get('/lookup/:term', termController.lookupTerm);

/**
 * GET /api/v1/terms/:id
 * 용어 상세 조회 (맨 마지막에 위치해야 함 - 와일드카드 라우트)
 */
router.get('/:id', termController.getTermById);

module.exports = router;
