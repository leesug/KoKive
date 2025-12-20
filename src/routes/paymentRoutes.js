/**
 * KoKive Payment Routes
 * 결제 및 구독 관련 API 라우트
 */

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate, optionalAuth } = require('../middlewares/auth');

// 공개 API
router.get('/plans', paymentController.getPlans);
router.get('/store-info', paymentController.getStoreInfo);

// 웹훅 (인증 불필요)
router.post('/webhook', paymentController.handleWebhook);

// 인증 필요 API
router.use(authenticate);

// 구독 관리
router.get('/subscription', paymentController.getSubscription);
router.post('/subscribe', paymentController.subscribe);
router.post('/cancel', paymentController.cancelSubscription);

// 결제 수단 관리
router.get('/billing-key', paymentController.getBillingKey);
router.post('/billing-key', paymentController.saveBillingKey);
router.delete('/billing-key', paymentController.deleteBillingKey);

// 결제 내역
router.get('/history', paymentController.getPaymentHistory);

// 결제 완료 처리
router.post('/complete', paymentController.completePayment);

module.exports = router;
