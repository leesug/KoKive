/**
 * KoKive Admin Routes
 * 관리자 API 엔드포인트 (FR-013, FR-014, FR-015)
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminShortsController = require('../controllers/adminShortsController');
const translationController = require('../controllers/translationController');
const { authenticate, requireAdmin } = require('../middlewares/auth');
const {
    validateShorts,
    validateShortsScript,
    validateShortsPlatform,
    validateShortsStats,
    validatePagination
} = require('../middlewares/validator');

// 내부 스케줄러 키 (Windows Task Scheduler에서 호출시 사용)
const SCHEDULER_KEY = process.env.SCHEDULER_KEY || 'kokive-internal-scheduler-2024';

// 스케줄러 또는 관리자 인증 미들웨어
const authenticateSchedulerOrAdmin = (req, res, next) => {
    // 내부 스케줄러 키 확인
    const schedulerKey = req.headers['x-scheduler-key'];
    if (schedulerKey === SCHEDULER_KEY) {
        req.isScheduler = true;
        return next();
    }
    // 일반 관리자 인증
    authenticate(req, res, (err) => {
        if (err) return next(err);
        requireAdmin(req, res, next);
    });
};

// 논문 수집 (스케줄러 또는 관리자)
router.post("/jobs/paper-collect", authenticateSchedulerOrAdmin, adminController.startPaperCollect);

// 모든 관리자 API는 인증 + 관리자 권한 필요
router.use(authenticate, requireAdmin);

// ===========================================
// 메인 대시보드 (FR-015)
// ===========================================

/**
 * GET /api/admin/dashboard
 * 대시보드 메인 지표
 */
router.get('/dashboard', adminController.getDashboardStats);

/**
 * GET /api/admin/stats
 * 대시보드 통계 카드용 간단 통계
 */
router.get('/stats', adminController.getSimpleStats);

// ===========================================
// 논문 관리
// ===========================================

/**
 * GET /api/admin/papers/categories
 * 논문 카테고리 목록 (DB에서 동적 조회)
 */
router.get('/papers/categories', adminController.getPaperCategories);

/**
 * GET /api/admin/papers/stats-summary
 * 논문 통계 요약
 */
router.get('/papers/stats-summary', adminController.getPaperStatsSummary);

/**
 * GET /api/admin/papers
 * 논문 관리 목록
 */
router.get('/papers', validatePagination, adminController.getPapers);

/**
 * PUT /api/admin/papers/:id/status
 * 논문 처리 상태 변경
 */
router.put('/papers/:id/status', adminController.updatePaperStatus);

/**
 * POST /api/admin/papers/:id/reprocess
 * 논문 재처리 요청
 */
router.post('/papers/:id/reprocess', adminController.reprocessPaper);

/**
 * DELETE /api/admin/papers/:id
 * 논문 삭제
 */
router.delete('/papers/:id', adminController.deletePaper);

// ===========================================
// 사용자 관리
// ===========================================

/**
 * GET /api/admin/users/stats
 * 사용자 통계
 */
router.get('/users/stats', adminController.getUserStats);

/**
 * GET /api/admin/users
 * 사용자 목록
 */
router.get('/users', validatePagination, adminController.getUsers);

/**
 * GET /api/admin/users/:id
 * 사용자 상세 조회
 */
router.get('/users/:id', adminController.getUserById);

/**
 * POST /api/admin/users
 * 사용자 추가
 */
router.post('/users', adminController.createUser);

/**
 * PUT /api/admin/users/:id
 * 사용자 수정
 */
router.put('/users/:id', adminController.updateUser);

/**
 * DELETE /api/admin/users/:id
 * 사용자 삭제
 */
router.delete('/users/:id', adminController.deleteUser);

/**
 * PUT /api/admin/users/:id/role
 * 사용자 권한 변경
 */
router.put('/users/:id/role', adminController.updateUserRole);

/**
 * PUT /api/admin/users/:id/status
 * 사용자 활성화/비활성화
 */
router.put('/users/:id/status', adminController.toggleUserStatus);

// ===========================================
// 용어 사전 관리 (FR-004)
// ===========================================

/**
 * GET /api/admin/terms/categories
 * 용어 카테고리 목록 (논문 카테고리 포함)
 */
router.get('/terms/categories', adminController.getTermCategories);

/**
 * GET /api/admin/terms
 * 용어 목록
 */
router.get('/terms', validatePagination, adminController.getTerms);

/**
 * GET /api/admin/terms/:id
 * 용어 상세 조회
 */
router.get('/terms/:id', adminController.getTermById);

/**
 * POST /api/admin/terms
 * 용어 추가
 */
router.post('/terms', adminController.createTerm);

/**
 * PUT /api/admin/terms/:id
 * 용어 수정
 */
router.put('/terms/:id', adminController.updateTerm);

/**
 * DELETE /api/admin/terms/:id
 * 용어 삭제
 */
router.delete('/terms/:id', adminController.deleteTerm);

// ===========================================
// 쇼츠폼 제작 센터 (FR-013)
// ===========================================

/**
 * GET /api/admin/shorts/candidates
 * 오늘의 쇼츠폼 후보 논문 목록
 */

/**
 * GET /api/admin/shorts/youtube-settings
 * youtube-settings 조회
 */
router.get('/shorts/youtube-settings', adminController.getPlatformSettings);

/**
 * PUT /api/admin/shorts/youtube-settings
 * youtube-settings 저장
 */
router.put('/shorts/youtube-settings', adminController.updatePlatformSettings);
router.post('/shorts/youtube-settings', adminController.updatePlatformSettings);


/**
 * GET /api/admin/shorts/tiktok-settings
 * tiktok-settings 조회
 */
router.get('/shorts/tiktok-settings', adminController.getPlatformSettings);

/**
 * PUT /api/admin/shorts/tiktok-settings
 * tiktok-settings 저장
 */
router.put('/shorts/tiktok-settings', adminController.updatePlatformSettings);
router.post('/shorts/tiktok-settings', adminController.updatePlatformSettings);


/**
 * GET /api/admin/shorts/instagram-settings
 * instagram-settings 조회
 */
router.get('/shorts/instagram-settings', adminController.getPlatformSettings);

/**
 * PUT /api/admin/shorts/instagram-settings
 * instagram-settings 저장
 */
router.put('/shorts/instagram-settings', adminController.updatePlatformSettings);
router.post('/shorts/instagram-settings', adminController.updatePlatformSettings);


/**
 * GET /api/admin/shorts/facebook-settings
 * facebook-settings 조회
 */
router.get('/shorts/facebook-settings', adminController.getPlatformSettings);

/**
 * PUT /api/admin/shorts/facebook-settings
 * facebook-settings 저장
 */
router.put('/shorts/facebook-settings', adminController.updatePlatformSettings);
router.post('/shorts/facebook-settings', adminController.updatePlatformSettings);


/**
 * GET /api/admin/shorts/deploy-settings
 * deploy-settings 조회
 */
router.get('/shorts/deploy-settings', adminController.getPlatformSettings);

/**
 * PUT /api/admin/shorts/deploy-settings
 * deploy-settings 저장
 */
router.put('/shorts/deploy-settings', adminController.updatePlatformSettings);
router.post('/shorts/deploy-settings', adminController.updatePlatformSettings);

router.get('/shorts/candidates', adminShortsController.getRecommendedPapers);

/**
 * POST /api/admin/shorts
 * 쇼츠폼 생성 (논문 선정 + AI 스크립트 생성)
 */
router.post('/shorts', validateShorts, adminShortsController.createShorts);

/**
 * POST /api/admin/shorts/generate
 * 쇼츠폼 생성 (프론트엔드 호환용 - createShorts와 동일)
 */
router.post('/shorts/generate', validateShorts, adminShortsController.createShorts);

/**
 * GET /api/admin/shorts/engine-settings
 * 쇼츠 생성 엔진 설정 조회 (프론트엔드 호환용)
 */
router.get('/shorts/engine-settings', adminController.getPlatformSettings);

/**
 * PUT /api/admin/shorts/engine-settings
 * 쇼츠 생성 엔진 설정 저장 (프론트엔드 호환용)
 */
router.put('/shorts/engine-settings', adminController.updatePlatformSettings);
router.post('/shorts/engine-settings', adminController.updatePlatformSettings);

/**
 * GET /api/admin/shorts/default-settings
 * 기본 설정 조회
 */
router.get('/shorts/default-settings', adminController.getPlatformSettings);

/**
 * PUT /api/admin/shorts/default-settings
 * 기본 설정 저장
 */
router.put('/shorts/default-settings', adminController.updatePlatformSettings);
router.post('/shorts/default-settings', adminController.updatePlatformSettings);

/**
 * GET /api/admin/shorts
 * 쇼츠폼 목록
 */
router.get('/shorts', validatePagination, adminShortsController.getShorts);

/**
 * GET /api/admin/shorts/:id
 * 쇼츠폼 상세
 */
router.get('/shorts/:id', adminShortsController.getShortsById);

/**
 * PUT /api/admin/shorts/:id
 * 쇼츠폼 수정 (스크립트, 썸네일 등)
 */
router.put('/shorts/:id', validateShortsScript, adminShortsController.updateShorts);

/**
 * POST /api/admin/shorts/generate-script
 * AI 스크립트 생성
 */
router.post('/shorts/generate-script', adminShortsController.generateScript);

/**
 * DELETE /api/admin/shorts/:id
 * 쇼츠폼 삭제
 */
router.delete('/shorts/:id', adminShortsController.deleteShorts);

// ===========================================
// 쇼츠폼 마케팅 (FR-014)
// ===========================================

/**
 * PUT /api/admin/shorts/:shortsId/platforms
 * 플랫폼 업로드 정보 등록/수정
 */
router.put('/shorts/:shortsId/platforms', validateShortsPlatform, adminShortsController.updatePlatform);

/**
 * DELETE /api/admin/shorts/:shortsId/platforms/:platform
 * 플랫폼 정보 삭제
 */
router.delete('/shorts/:shortsId/platforms/:platform', adminShortsController.deletePlatform);

/**
 * PUT /api/admin/shorts/:shortsId/stats
 * 성과 데이터 입력/수정
 */
router.put('/shorts/:shortsId/stats', validateShortsStats, adminShortsController.updateStats);

/**
 * PUT /api/admin/shorts/:id/status
 * 쇼츠폼 상태 변경 (발행/취소)
 */
router.put('/shorts/:id/status', adminShortsController.updateStatus);

/**
 * GET /api/admin/shorts/analytics
 * 마케팅 성과 대시보드
 */
router.get('/shorts/analytics', adminShortsController.getAnalytics);

// TTS 서비스 계정 관련 라우트
router.get('/shorts/tts-status', adminShortsController.getTTSStatus);
router.post('/shorts/tts-credentials', adminShortsController.uploadTTSCredentials);
router.post('/shorts/tts-test', adminShortsController.testTTS);

// 비디오 생성 관련 라우트
router.post('/shorts/:id/generate-video', adminShortsController.generateVideo);
router.get('/shorts/:id/video-status', adminShortsController.getVideoStatus);


// ===========================================
// Q&A 관리
// ===========================================

/**
 * GET /api/admin/qa/reports
 * 신고된 Q&A 목록
 */
router.get('/qa/reports', adminController.getReportedContent);

/**
 * DELETE /api/admin/qa/:type/:id
 * Q&A 콘텐츠 삭제
 */
router.delete('/qa/:type/:id', adminController.deleteContent);

// ===========================================
// 시스템 설정
// ===========================================

/**
 * GET /api/admin/settings
 * 시스템 설정 조회
 */

// ===========================================
// 쇼츠 API 설정
// ===========================================

/**
 * GET /api/admin/settings/shorts
 * 쇼츠 API 설정 조회
 */
router.get('/settings/shorts', adminController.getShortsSettings);

/**
 * PUT /api/admin/settings/shorts
 * 쇼츠 API 설정 저장
 */
router.put('/settings/shorts', adminController.updateShortsSettings);

/**
 * POST /api/admin/settings/shorts/test-tts
 * TTS 테스트
 */
router.post('/settings/shorts/test-tts', adminController.testTTS);

router.get('/settings', adminController.getSettings);

/**
 * PUT /api/admin/settings
 * 시스템 설정 수정
 */
router.put('/settings', adminController.updateSettings);

/**
 * GET /api/admin/api-usage
 * API 사용량 조회
 */
router.get('/api-usage', adminController.getApiUsage);

/**
 * GET /api/admin/jobs
 * 작업 큐 상태
 */
router.get('/jobs', validatePagination, adminController.getJobQueue);

/**
 * POST /api/admin/jobs/:id/retry
 * 실패한 작업 재시도
 */
router.post('/jobs/:id/retry', adminController.retryJob);

/**
 * POST /api/admin/jobs/:id/cancel
 * 작업 취소
 */
router.post('/jobs/:id/cancel', adminController.cancelJob);

// 참고: POST /api/admin/jobs/paper-collect는 상단에서 스케줄러 인증과 함께 정의됨

/**
 * GET /api/admin/jobs/paper-collect/progress
 * 논문 수집 진행률 조회
 */
router.get("/jobs/paper-collect/progress", adminController.getPaperCollectProgress);

/**
 * GET /api/admin/jobs/paper-collect/schedule
 * 논문 수집 스케줄 조회
 */
router.get("/jobs/paper-collect/schedule", adminController.getPaperCollectSchedule);

/**
 * PUT /api/admin/jobs/paper-collect/schedule
 * 논문 수집 스케줄 설정
 */
router.put("/jobs/paper-collect/schedule", adminController.updatePaperCollectSchedule);

/**
 * GET /api/admin/schedule/config
 * 스케줄 설정 조회
 */
router.get('/schedule/config', adminController.getPlatformSettings);

/**
 * PUT /api/admin/schedule/config
 * 스케줄 설정 저장
 */
router.put('/schedule/config', adminController.updatePlatformSettings);
router.post('/schedule/config', adminController.updatePlatformSettings);

/**
 * POST /api/admin/jobs/ai-process
 * AI 처리 시작
 */
router.post("/jobs/ai-process", adminController.startAiProcess);

// ===========================================
// 배치 파이프라인 관리
// ===========================================

/**
 * GET /api/admin/pipeline/status
 * 파이프라인 상태 조회
 */
router.get('/pipeline/status', adminController.getPipelineStatus);

/**
 * GET /api/admin/pipeline/config
 * 파이프라인 설정 조회
 */
router.get('/pipeline/config', adminController.getPipelineConfig);

/**
 * PUT /api/admin/pipeline/config
 * 파이프라인 설정 저장
 */
router.put('/pipeline/config', adminController.updatePipelineConfig);

/**
 * POST /api/admin/pipeline/run/:stage
 * 파이프라인 특정 단계 수동 실행
 */
router.post('/pipeline/run/:stage', adminController.runPipelineStage);

/**
 * POST /api/admin/pipeline/reset
 * 파이프라인 상태 리셋
 */
router.post('/pipeline/reset', adminController.resetPipeline);

/**
 * GET /api/admin/pipeline/logs
 * 파이프라인 로그 조회
 */
router.get('/pipeline/logs', adminController.getPipelineLogs);

// ===========================================
// 불완전한 논문 검증 및 재처리
// ===========================================

/**
 * GET /api/admin/papers/incomplete/stats
 * 불완전한 논문 통계 조회
 */
router.get('/papers/incomplete/stats', adminController.getIncompletePapersStats);

/**
 * GET /api/admin/papers/incomplete
 * 불완전한 논문 목록 조회
 */
router.get('/papers/incomplete', adminController.getIncompletePapers);

/**
 * POST /api/admin/papers/incomplete/reprocess
 * 불완전한 논문 일괄 재처리
 */
router.post('/papers/incomplete/reprocess', adminController.reprocessIncompletePapers);

/**
 * POST /api/admin/papers/validate-recent
 * 최근 수집 논문 검증 및 자동 재처리
 */
router.post('/papers/validate-recent', adminController.validateAndReprocessRecent);

/**
 * POST /api/admin/papers/:id/reprocess-now
 * 단일 논문 즉시 재처리 (동기)
 */
router.post('/papers/:id/reprocess-now', adminController.reprocessSinglePaper);

/**
 * GET /api/admin/papers/reprocess/stats
 * 재처리 통계 조회 (비용, 횟수, 실패율 모니터링)
 */
router.get('/papers/reprocess/stats', adminController.getReprocessStats);

/**
 * GET /api/admin/papers-extended
 * 논문 목록 조회 (불완전 상태 포함)
 */
router.get('/papers-extended', validatePagination, adminController.getPapersWithIncompleteStatus);

/**
 * GET /api/admin/papers/monitoring
 * 종합 논문 모니터링 API (요약, 번역, 읽기 횟수 등)
 */
router.get('/papers/monitoring', validatePagination, adminController.getComprehensivePaperMonitoring);

/**
 * GET /api/admin/api-usage/detailed
 * API 사용량 상세 조회 (비용 포함)
 */
router.get('/api-usage/detailed', validatePagination, adminController.getApiUsageDetailed);

// ===========================================
// 뉴스레터 관리
// ===========================================

/**
 * GET /api/admin/newsletter/stats
 * 뉴스레터 통계 조회
 */
router.get('/newsletter/stats', adminController.getNewsletterStats);

/**
 * GET /api/admin/newsletter/subscribers
 * 구독자 목록 조회
 */
router.get('/newsletter/subscribers', validatePagination, adminController.getNewsletterSubscribers);

/**
 * PUT /api/admin/newsletter/subscribers/:id
 * 구독자 수정 (인증 상태 변경 포함)
 */
router.put('/newsletter/subscribers/:id', adminController.updateNewsletterSubscriber);

/**
 * DELETE /api/admin/newsletter/subscribers/:id
 * 구독자 삭제
 */
router.delete('/newsletter/subscribers/:id', adminController.deleteNewsletterSubscriber);

/**
 * POST /api/admin/newsletter/send
 * 뉴스레터 발송
 */
router.post('/newsletter/send', adminController.sendNewsletter);

// ===========================================
// 번역 관리
// ===========================================

/**
 * GET /api/admin/translations/stats
 * 번역 통계 조회
 */
router.get('/translations/stats', translationController.getStats);

/**
 * GET /api/admin/translations
 * 번역 목록 조회
 */
router.get('/translations', validatePagination, translationController.getTranslations);

/**
 * GET /api/admin/translations/:id
 * 번역 상세 조회
 */
router.get('/translations/:id', translationController.getTranslationById);

/**
 * DELETE /api/admin/translations/:id
 * 번역 삭제
 */
router.delete('/translations/:id', translationController.deleteTranslation);

/**
 * POST /api/admin/translations/:id/retry
 * 실패한 번역 재시도
 */
router.post('/translations/:id/retry', translationController.retryTranslation);

// ===========================================
// 최소 비용 재처리 (Minimum Cost Reprocessing)
// ===========================================

/**
 * GET /api/admin/papers/reprocess-estimate
 * 재처리 비용 추정
 */
router.get('/papers/reprocess-estimate', adminController.getReprocessEstimate);

/**
 * POST /api/admin/papers/reprocess-minimal-batch
 * 다중 논문 최소 비용 일괄 재처리
 */
router.post('/papers/reprocess-minimal-batch', adminController.reprocessMinimalCostBatch);

/**
 * POST /api/admin/papers/:id/reprocess-minimal
 * 단일 논문 최소 비용 재처리
 */
router.post('/papers/:id/reprocess-minimal', adminController.reprocessMinimalCost);


// Newsletter test routes
router.post('/newsletter/test-send', adminController.testSendNewsletter);
router.get('/newsletter/preview', adminController.previewNewsletter);

module.exports = router;
