/**
 * KoKive Paper Routes
 * 논문 관련 API 엔드포인트 (FR-001, FR-002, FR-005, FR-008, FR-012)
 */

const express = require('express');
const router = express.Router();
const paperController = require('../controllers/paperController');
const translationController = require('../controllers/translationController');
const { authenticate, optionalAuth } = require('../middlewares/auth');
const { validatePaperId, validatePaperList, validateRating } = require('../middlewares/validator');

// ===========================================
// 공개 API
// ===========================================

/**
 * GET /api/v1/papers
 * 논문 목록 조회 (페이지네이션, 필터링)
 */
router.get('/', validatePaperList, optionalAuth, paperController.getPapers);

/**
 * GET /api/v1/papers/today
 * 오늘의 논문 목록
 */
router.get('/today', optionalAuth, paperController.getTodayPapers);

/**
 * GET /api/v1/papers/trending
 * 트렌딩 논문 목록 (조회수, GitHub Stars 기반)
 */
router.get('/trending', optionalAuth, paperController.getTrendingPapers);

/**
 * GET /api/v1/papers/categories
 * 카테고리별 논문 통계
 */
router.get('/categories', paperController.getCategoryStats);

/**
 * GET /api/v1/papers/months
 * 월별 논문 통계 (arXiv 스타일 아카이브용)
 */
router.get('/months', paperController.getMonthlyStats);

/**
 * GET /api/v1/papers/:id
 * 논문 상세 조회
 */
router.get('/:id', validatePaperId, optionalAuth, paperController.getPaperById);

/**
 * GET /api/v1/papers/:id/summary
 * 논문 요약 조회 (TL;DR, 3줄 요약, 상세 해설)
 */
router.get('/:id/summary', validatePaperId, paperController.getPaperSummary);

/**
 * GET /api/v1/papers/:id/terms
 * 논문 관련 용어 조회
 */
router.get('/:id/terms', validatePaperId, paperController.getPaperTerms);

/**
 * GET /api/v1/papers/:id/related
 * 관련 논문 조회
 */
router.get('/:id/related', validatePaperId, paperController.getRelatedPapers);

/**
 * GET /api/v1/papers/:id/citations
 * 인용 형식 조회 (FR-008)
 */
router.get('/:id/citations', validatePaperId, paperController.getCitations);

// ===========================================
// 인증 필요 API
// ===========================================

/**
 * POST /api/v1/papers/:id/view
 * 논문 조회수 증가 기록
 */
router.post('/:id/view', validatePaperId, optionalAuth, paperController.recordView);

/**
 * GET /api/v1/papers/:id/ratings
 * 논문 평가 목록 조회 (FR-012)
 */
router.get('/:id/ratings', validatePaperId, paperController.getRatings);

/**
 * POST /api/v1/papers/:id/ratings
 * 논문 평가 등록 (FR-012)
 */
router.post('/:id/ratings', validatePaperId, authenticate, validateRating, paperController.createRating);

/**
 * PUT /api/v1/papers/:id/ratings
 * 논문 평가 수정
 */
router.put('/:id/ratings', validatePaperId, authenticate, validateRating, paperController.updateRating);

// ===========================================
// PDF 본문 번역 API (On-demand)
// ===========================================

/**
 * POST /api/v1/papers/:id/translation
 * 논문 본문 번역 요청 (Pro 이상 회원 전용)
 */
router.post('/:id/translation', validatePaperId, authenticate, translationController.requestTranslation);

/**
 * GET /api/v1/papers/:id/translation/status
 * 논문 번역 상태 조회
 */
router.get('/:id/translation/status', validatePaperId, optionalAuth, translationController.getTranslationStatus);

module.exports = router;
