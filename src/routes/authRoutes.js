/**
 * KoKive Auth Routes
 * 인증 관련 API 엔드포인트 (FR-009)
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const translationController = require('../controllers/translationController');
const { authenticate } = require('../middlewares/auth');
const { validateSignup, validateLogin } = require('../middlewares/validator');

/**
 * POST /api/v1/auth/signup
 * 회원가입
 */
router.post('/signup', validateSignup, authController.signup);

/**
 * POST /api/v1/auth/register
 * 회원가입 (별칭)
 */
router.post('/register', validateSignup, authController.signup);

/**
 * POST /api/v1/auth/login
 * 로그인
 */
router.post('/login', validateLogin, authController.login);

/**
 * POST /api/v1/auth/logout
 * 로그아웃
 */
router.post('/logout', authenticate, authController.logout);

/**
 * POST /api/v1/auth/refresh
 * 토큰 갱신
 */
router.post('/refresh', authController.refreshToken);

/**
 * GET /api/v1/auth/me
 * 현재 사용자 정보 조회
 */
router.get('/me', authenticate, authController.getMe);

/**
 * PUT /api/v1/auth/me
 * 사용자 정보 수정
 */
router.put('/me', authenticate, authController.updateMe);

/**
 * POST /api/v1/auth/me/update
 * 사용자 정보 수정 (IIS WebDAV PUT 우회용)
 */
router.post('/me/update', authenticate, authController.updateMe);

/**
 * PUT /api/v1/auth/password
 * 비밀번호 변경
 */
router.put('/password', authenticate, authController.changePassword);

/**
 * POST /api/v1/auth/forgot-password
 * 비밀번호 찾기 (이메일 발송)
 */
router.post('/forgot-password', authController.forgotPassword);

/**
 * POST /api/v1/auth/reset-password
 * 비밀번호 재설정
 */
router.post('/reset-password', authController.resetPassword);

/**
 * GET /api/v1/auth/verify-email
 * 이메일 인증 (링크 클릭)
 */
router.get('/verify-email', authController.verifyEmail);

/**
 * POST /api/v1/auth/verify-email
 * 이메일 인증 (토큰 전송)
 */
router.post('/verify-email', authController.verifyEmail);

/**
 * POST /api/v1/auth/resend-verification
 * 인증 이메일 재발송
 */
router.post('/resend-verification', authController.resendVerificationEmail);

/**
 * GET /api/v1/auth/oauth/:provider
 * OAuth 로그인 (Google, GitHub, Kakao)
 */
router.get('/oauth/:provider', authController.oauthLogin);

/**
 * GET /api/v1/auth/oauth/:provider/callback
 * OAuth 콜백
 */
router.get('/oauth/:provider/callback', authController.oauthCallback);

// ===========================================
// 번역 사용량 및 읽기 기록 API
// ===========================================

/**
 * GET /api/v1/auth/translation-usage
 * 사용자 번역 사용량 조회
 */
router.get('/translation-usage', authenticate, translationController.getUsage);

/**
 * GET /api/v1/auth/reading-history
 * 사용자 읽기 기록 조회
 */
router.get('/reading-history', authenticate, translationController.getReadingHistory);

module.exports = router;
