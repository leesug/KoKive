/**
 * KoKive Community Routes
 * Q&A 커뮤니티 관련 API 엔드포인트 (FR-006)
 */

const express = require('express');
const router = express.Router();
const communityController = require('../controllers/communityController');
const { authenticate, optionalAuth } = require('../middlewares/auth');
const { validateQuestion, validateAnswer, validatePagination } = require('../middlewares/validator');

// ===========================================
// 질문 관련
// ===========================================

/**
 * GET /api/v1/community/questions
 * 질문 목록 조회
 */
router.get('/questions', validatePagination, optionalAuth, communityController.getQuestions);

/**
 * GET /api/v1/community/questions/:id
 * 질문 상세 조회
 */
router.get('/questions/:id', optionalAuth, communityController.getQuestionById);

/**
 * POST /api/v1/community/questions
 * 질문 등록
 */
router.post('/questions', authenticate, validateQuestion, communityController.createQuestion);

/**
 * PUT /api/v1/community/questions/:id
 * 질문 수정
 */
router.put('/questions/:id', authenticate, communityController.updateQuestion);

/**
 * DELETE /api/v1/community/questions/:id
 * 질문 삭제
 */
router.delete('/questions/:id', authenticate, communityController.deleteQuestion);

/**
 * POST /api/v1/community/questions/:id/vote
 * 질문 투표
 */
router.post('/questions/:id/vote', authenticate, communityController.voteQuestion);

// ===========================================
// 답변 관련
// ===========================================

/**
 * GET /api/v1/community/questions/:questionId/answers
 * 답변 목록 조회
 */
router.get('/questions/:questionId/answers', optionalAuth, communityController.getAnswers);

/**
 * POST /api/v1/community/questions/:questionId/answers
 * 답변 등록
 */
router.post('/questions/:questionId/answers', authenticate, validateAnswer, communityController.createAnswer);

/**
 * PUT /api/v1/community/answers/:id
 * 답변 수정
 */
router.put('/answers/:id', authenticate, communityController.updateAnswer);

/**
 * DELETE /api/v1/community/answers/:id
 * 답변 삭제
 */
router.delete('/answers/:id', authenticate, communityController.deleteAnswer);

/**
 * POST /api/v1/community/answers/:id/accept
 * 답변 채택
 */
router.post('/answers/:id/accept', authenticate, communityController.acceptAnswer);

/**
 * POST /api/v1/community/answers/:id/vote
 * 답변 투표
 */
router.post('/answers/:id/vote', authenticate, communityController.voteAnswer);

// ===========================================
// 논문별 Q&A
// ===========================================

/**
 * GET /api/v1/community/papers/:paperId/questions
 * 특정 논문의 Q&A 목록
 */
router.get('/papers/:paperId/questions', optionalAuth, communityController.getPaperQuestions);

// ===========================================
// AI Q&A 관련
// ===========================================

/**
 * GET /api/v1/community/ai-qna/settings
 * AI Q&A 설정 조회
 */
router.get('/ai-qna/settings', communityController.getAiQnaSettings);

/**
 * PUT /api/v1/community/ai-qna/settings
 * AI Q&A 설정 업데이트 (관리자용)
 */
router.put('/ai-qna/settings', authenticate, communityController.updateAiQnaSettings);

/**
 * GET /api/v1/community/ai-qna/estimate/:paperId
 * AI 답변 비용 예상
 */
router.get('/ai-qna/estimate/:paperId', authenticate, communityController.estimateAiAnswerCost);

/**
 * POST /api/v1/community/questions/:questionId/ai-answer
 * AI 답변 요청
 */
router.post('/questions/:questionId/ai-answer', authenticate, communityController.requestAiAnswer);

module.exports = router;
