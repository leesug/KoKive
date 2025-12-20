/**
 * KoKive Library Routes
 * 개인 라이브러리 관련 API 엔드포인트 (FR-007)
 */

const express = require('express');
const router = express.Router();
const libraryController = require('../controllers/libraryController');
const { authenticate } = require('../middlewares/auth');
const { validateCollection, validateNote, validatePagination } = require('../middlewares/validator');

// 모든 라이브러리 API는 인증 필요
router.use(authenticate);

// ===========================================
// 컬렉션 관련
// ===========================================

/**
 * GET /api/v1/library/collections
 * 내 컬렉션 목록 조회
 */
router.get('/collections', libraryController.getCollections);

/**
 * POST /api/v1/library/collections
 * 컬렉션 생성
 */
router.post('/collections', validateCollection, libraryController.createCollection);

/**
 * GET /api/v1/library/collections/:id
 * 컬렉션 상세 조회
 */
router.get('/collections/:id', libraryController.getCollectionById);

/**
 * PUT /api/v1/library/collections/:id
 * 컬렉션 수정
 */
router.put('/collections/:id', validateCollection, libraryController.updateCollection);

/**
 * DELETE /api/v1/library/collections/:id
 * 컬렉션 삭제
 */
router.delete('/collections/:id', libraryController.deleteCollection);

/**
 * GET /api/v1/library/collections/:id/papers
 * 컬렉션 내 논문 목록
 */
router.get('/collections/:id/papers', validatePagination, libraryController.getCollectionPapers);

/**
 * POST /api/v1/library/collections/:id/papers
 * 컬렉션에 논문 추가
 */
router.post('/collections/:id/papers', libraryController.addPaperToCollection);

/**
 * DELETE /api/v1/library/collections/:collectionId/papers/:paperId
 * 컬렉션에서 논문 제거
 */
router.delete('/collections/:collectionId/papers/:paperId', libraryController.removePaperFromCollection);

// ===========================================
// 저장한 논문 (기본 컬렉션)
// ===========================================

/**
 * GET /api/v1/library/saved
 * 저장한 논문 목록
 */
router.get('/saved', validatePagination, libraryController.getSavedPapers);

/**
 * POST /api/v1/library/saved/:paperId
 * 논문 저장
 */
router.post('/saved/:paperId', libraryController.savePaper);

/**
 * DELETE /api/v1/library/saved/:paperId
 * 논문 저장 취소
 */
router.delete('/saved/:paperId', libraryController.unsavePaper);

/**
 * GET /api/v1/library/saved/:paperId/status
 * 논문 저장 상태 확인
 */
router.get('/saved/:paperId/status', libraryController.checkSaveStatus);

// ===========================================
// 노트 관련
// ===========================================

/**
 * GET /api/v1/library/notes
 * 내 노트 목록
 */
router.get('/notes', validatePagination, libraryController.getNotes);

/**
 * GET /api/v1/library/papers/:paperId/notes
 * 특정 논문의 내 노트 목록
 */
router.get('/papers/:paperId/notes', libraryController.getPaperNotes);

/**
 * POST /api/v1/library/papers/:paperId/notes
 * 노트 작성
 */
router.post('/papers/:paperId/notes', validateNote, libraryController.createNote);

/**
 * PUT /api/v1/library/notes/:id
 * 노트 수정
 */
router.put('/notes/:id', validateNote, libraryController.updateNote);

/**
 * DELETE /api/v1/library/notes/:id
 * 노트 삭제
 */
router.delete('/notes/:id', libraryController.deleteNote);

// ===========================================
// 최근 본 논문
// ===========================================

/**
 * GET /api/v1/library/history
 * 최근 본 논문 목록
 */
router.get('/history', validatePagination, libraryController.getHistory);

// ===========================================
// 즐겨찾기 카테고리
// ===========================================

/**
 * GET /api/v1/library/favorite-categories
 * 즐겨찾기 카테고리 목록 조회
 */
router.get('/favorite-categories', libraryController.getFavoriteCategories);

/**
 * POST /api/v1/library/favorite-categories
 * 즐겨찾기 카테고리 추가
 */
router.post('/favorite-categories', libraryController.addFavoriteCategory);

/**
 * PUT /api/v1/library/favorite-categories
 * 즐겨찾기 카테고리 일괄 설정
 */
router.put('/favorite-categories', libraryController.setFavoriteCategories);

/**
 * GET /api/v1/library/favorite-categories/:category/status
 * 즐겨찾기 카테고리 상태 확인
 */
router.get('/favorite-categories/:category/status', libraryController.checkFavoriteCategoryStatus);

/**
 * DELETE /api/v1/library/favorite-categories/:category
 * 즐겨찾기 카테고리 삭제
 */
router.delete('/favorite-categories/:category', libraryController.removeFavoriteCategory);

module.exports = router;
