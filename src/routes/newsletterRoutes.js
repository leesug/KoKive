/**
 * KoKive Newsletter Routes
 * 뉴스레터 및 알림 API 엔드포인트 (FR-010)
 */

const express = require('express');
const router = express.Router();
const newsletterController = require('../controllers/newsletterController');
const { authenticate, optionalAuth } = require('../middlewares/auth');
const { validatePagination } = require('../middlewares/validator');

// ==========================================
// 뉴스레터 구독 (공개)
// ==========================================

/**
 * POST /api/v1/newsletter/subscribe
 * 뉴스레터 구독
 */
router.post('/subscribe', optionalAuth, newsletterController.subscribe);

/**
 * GET /api/v1/newsletter/verify/:token
 * 이메일 인증
 */
router.get('/verify/:token', newsletterController.verifyEmail);

/**
 * POST /api/v1/newsletter/unsubscribe
 * 구독 해지
 */
router.post('/unsubscribe', newsletterController.unsubscribe);

/**
 * PUT /api/v1/newsletter/settings
 * 구독 설정 변경
 */
router.put('/settings', newsletterController.updateSettings);

/**
 * GET /api/v1/newsletter/subscription
 * 구독 정보 조회
 */
router.get('/subscription', newsletterController.getSubscription);

// ==========================================
// 사용자 알림 설정 (인증 필요)
// ==========================================

/**
 * GET /api/v1/newsletter/notification-settings
 * 알림 설정 조회
 */
router.get('/notification-settings', authenticate, newsletterController.getNotificationSettings);

/**
 * PUT /api/v1/newsletter/notification-settings
 * 알림 설정 변경
 */
router.put('/notification-settings', authenticate, newsletterController.updateNotificationSettings);

// ==========================================
// 인앱 알림 (인증 필요)
// ==========================================

/**
 * GET /api/v1/newsletter/notifications
 * 알림 목록 조회
 */
router.get('/notifications', authenticate, validatePagination, newsletterController.getNotifications);

/**
 * PUT /api/v1/newsletter/notifications/:id/read
 * 알림 읽음 처리
 */
router.put('/notifications/:id/read', authenticate, newsletterController.markAsRead);

/**
 * PUT /api/v1/newsletter/notifications/read-all
 * 모든 알림 읽음 처리
 */
router.put('/notifications/read-all', authenticate, newsletterController.markAllAsRead);

/**
 * DELETE /api/v1/newsletter/notifications/:id
 * 알림 삭제
 */
router.delete('/notifications/:id', authenticate, newsletterController.deleteNotification);

module.exports = router;
