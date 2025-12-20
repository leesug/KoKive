/**
 * KoKive Search Routes
 * 검색 관련 API 엔드포인트 (FR-003)
 */

const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { optionalAuth } = require('../middlewares/auth');
const { validateSearch } = require('../middlewares/validator');

/**
 * GET /api/v1/search
 * 논문 검색 (하이브리드: LIKE + FULLTEXT)
 * 우선순위: 제목 > 저자 > 초록
 */
router.get('/', validateSearch, optionalAuth, searchController.search);

/**
 * GET /api/v1/search/unified
 * 통합 검색 (논문 + 용어 + Q&A)
 */
router.get('/unified', validateSearch, optionalAuth, searchController.unifiedSearch);

/**
 * GET /api/v1/search/semantic
 * 시맨틱 검색 (벡터 유사도 기반)
 */
router.get('/semantic', validateSearch, optionalAuth, searchController.semanticSearch);

/**
 * GET /api/v1/search/suggestions
 * 검색어 자동완성
 */
router.get('/suggestions', searchController.getSuggestions);

/**
 * GET /api/v1/search/popular
 * 인기 검색어
 */
router.get('/popular', searchController.getPopularSearches);

/**
 * GET /api/v1/search/recent
 * 최근 검색어 (로그인 사용자)
 */
router.get('/recent', optionalAuth, searchController.getRecentSearches);

/**
 * GET /api/v1/search/similar/:paperId
 * 유사 논문 검색 (시맨틱 기반)
 */
router.get('/similar/:paperId', searchController.findSimilar);

/**
 * GET /api/v1/search/embedding/status
 * 임베딩 상태 조회 (관리자용)
 */
router.get('/embedding/status', searchController.getEmbeddingStatus);

/**
 * POST /api/v1/search/embedding/generate
 * 임베딩 배치 생성 트리거 (관리자용)
 */
router.post('/embedding/generate', searchController.triggerEmbeddingBatch);

module.exports = router;
