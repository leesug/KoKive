/**
 * KoKive Newsletter Controller
 * 뉴스레터 및 알림 관리 (FR-010)
 */

const newsletterService = require('../services/newsletterService');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// ==========================================
// 뉴스레터 구독 관리
// ==========================================

/**
 * 뉴스레터 구독
 */
exports.subscribe = async (req, res, next) => {
    try {
        const { email, subscriptionType, categories } = req.body;
        const userId = req.user?.id || null;

        const result = await newsletterService.subscribe(email, {
            userId,
            subscriptionType,
            categories
        });

        if (!result.success) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.message }
            });
        }

        // TODO: 인증 이메일 발송 로직 추가

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 이메일 인증
 */
exports.verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.params;

        const result = await newsletterService.verifyEmail(token);

        if (!result.success) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.message }
            });
        }

        res.json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 구독 해지
 */
exports.unsubscribe = async (req, res, next) => {
    try {
        const { email, token } = req.body;

        const result = await newsletterService.unsubscribe(email, token);

        if (!result.success) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: result.message }
            });
        }

        res.json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 구독 설정 변경
 */
exports.updateSettings = async (req, res, next) => {
    try {
        const { email, subscriptionType, categories } = req.body;

        const result = await newsletterService.updateSettings(email, {
            subscriptionType,
            categories
        });

        res.json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 구독 정보 조회
 */
exports.getSubscription = async (req, res, next) => {
    try {
        const { email } = req.query;

        const subscription = await newsletterService.getSubscription(email);

        if (!subscription) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '구독 정보를 찾을 수 없습니다.' }
            });
        }

        res.json({
            success: true,
            data: subscription
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// 사용자 알림 설정
// ==========================================

/**
 * 알림 설정 조회
 */
exports.getNotificationSettings = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: { code: ERROR_CODES.UNAUTHORIZED, message: '로그인이 필요합니다.' }
            });
        }

        const settings = await newsletterService.getNotificationSettings(req.user.id);

        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 알림 설정 변경
 */
exports.updateNotificationSettings = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: { code: ERROR_CODES.UNAUTHORIZED, message: '로그인이 필요합니다.' }
            });
        }

        const result = await newsletterService.updateNotificationSettings(req.user.id, req.body);

        res.json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// 인앱 알림
// ==========================================

/**
 * 알림 목록 조회
 */
exports.getNotifications = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: { code: ERROR_CODES.UNAUTHORIZED, message: '로그인이 필요합니다.' }
            });
        }

        const { page = 1, limit = 20, unreadOnly = false } = req.query;

        const result = await newsletterService.getNotifications(req.user.id, {
            page: parseInt(page),
            limit: parseInt(limit),
            unreadOnly: unreadOnly === 'true'
        });

        res.json({
            success: true,
            data: result.items,
            pagination: result.pagination,
            unreadCount: result.unreadCount
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 알림 읽음 처리
 */
exports.markAsRead = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: { code: ERROR_CODES.UNAUTHORIZED, message: '로그인이 필요합니다.' }
            });
        }

        const { id } = req.params;

        await newsletterService.markAsRead(req.user.id, parseInt(id));

        res.json({
            success: true,
            message: '알림을 읽음 처리했습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 모든 알림 읽음 처리
 */
exports.markAllAsRead = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: { code: ERROR_CODES.UNAUTHORIZED, message: '로그인이 필요합니다.' }
            });
        }

        await newsletterService.markAllAsRead(req.user.id);

        res.json({
            success: true,
            message: '모든 알림을 읽음 처리했습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 알림 삭제
 */
exports.deleteNotification = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: { code: ERROR_CODES.UNAUTHORIZED, message: '로그인이 필요합니다.' }
            });
        }

        const { id } = req.params;

        await newsletterService.deleteNotification(req.user.id, parseInt(id));

        res.json({
            success: true,
            message: '알림이 삭제되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// 관리자 기능
// ==========================================

/**
 * 뉴스레터 통계 조회 (관리자)
 */
exports.getStats = async (req, res, next) => {
    try {
        const stats = await newsletterService.getNewsletterStats();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        next(error);
    }
};
