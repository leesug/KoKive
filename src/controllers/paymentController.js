/**
 * KoKive Payment Controller
 * 결제 및 구독 관리 API
 */

const paymentService = require('../services/paymentService');
const { HTTP_STATUS } = require('../config/constants');

/**
 * 요금제 목록 조회
 */
exports.getPlans = async (req, res) => {
    try {
        const plans = paymentService.getPlans();
        res.json({
            success: true,
            data: plans
        });
    } catch (error) {
        console.error('요금제 조회 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '요금제 정보를 불러오는데 실패했습니다.' }
        });
    }
};

/**
 * 스토어 정보 조회 (프론트엔드 SDK 초기화용)
 */
exports.getStoreInfo = async (req, res) => {
    try {
        const storeInfo = paymentService.getStoreInfo();
        res.json({
            success: true,
            data: storeInfo
        });
    } catch (error) {
        console.error('스토어 정보 조회 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '스토어 정보를 불러오는데 실패했습니다.' }
        });
    }
};

/**
 * 현재 구독 정보 조회
 */
exports.getSubscription = async (req, res) => {
    try {
        const subscription = await paymentService.getSubscription(req.user.id);
        res.json({
            success: true,
            data: subscription
        });
    } catch (error) {
        console.error('구독 조회 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '구독 정보를 불러오는데 실패했습니다.' }
        });
    }
};

/**
 * 빌링키 등록 (클라이언트에서 빌링키 발급 후 호출)
 */
exports.saveBillingKey = async (req, res) => {
    try {
        const { customerUid, cardName, cardNumber, pgProvider } = req.body;

        if (!customerUid) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { message: 'customerUid가 필요합니다.' }
            });
        }

        await paymentService.saveBillingKey(req.user.id, {
            customerUid,
            cardName,
            cardNumber,
            pgProvider
        });

        res.json({
            success: true,
            message: '결제 수단이 등록되었습니다.'
        });
    } catch (error) {
        console.error('빌링키 등록 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '결제 수단 등록에 실패했습니다.' }
        });
    }
};

/**
 * 등록된 결제 수단 조회
 */
exports.getBillingKey = async (req, res) => {
    try {
        const billingKey = await paymentService.getBillingKey(req.user.id);
        res.json({
            success: true,
            data: billingKey ? {
                cardName: billingKey.card_name,
                cardNumber: billingKey.card_number_masked,
                pgProvider: billingKey.pg_provider,
                createdAt: billingKey.created_at
            } : null
        });
    } catch (error) {
        console.error('결제 수단 조회 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '결제 수단 정보를 불러오는데 실패했습니다.' }
        });
    }
};

/**
 * 결제 수단 삭제
 */
exports.deleteBillingKey = async (req, res) => {
    try {
        await paymentService.deleteBillingKey(req.user.id);
        res.json({
            success: true,
            message: '결제 수단이 삭제되었습니다.'
        });
    } catch (error) {
        console.error('결제 수단 삭제 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '결제 수단 삭제에 실패했습니다.' }
        });
    }
};

/**
 * 구독 시작/변경
 */
exports.subscribe = async (req, res) => {
    try {
        const { planId, impUid, merchantUid } = req.body;

        if (!planId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { message: '요금제를 선택해주세요.' }
            });
        }

        // 무료 요금제는 바로 처리
        if (planId === 'free') {
            const subscription = await paymentService.createSubscription(req.user.id, 'free');
            return res.json({
                success: true,
                data: subscription,
                message: '무료 요금제로 변경되었습니다.'
            });
        }

        // 유료 요금제는 결제 검증 필요
        if (impUid && merchantUid) {
            const plans = paymentService.getPlans();
            const plan = plans[planId];

            if (!plan) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: { message: '유효하지 않은 요금제입니다.' }
                });
            }

            // 결제 검증
            const verification = await paymentService.verifyPayment(impUid, merchantUid, plan.price);

            if (verification.success) {
                // 구독 생성
                const subscription = await paymentService.createSubscription(req.user.id, planId);

                // 구독 활성화
                const { query } = require('../config/database');
                await query(
                    'UPDATE subscriptions SET status = "active", last_payment_date = NOW() WHERE user_id = ?',
                    [req.user.id]
                );

                // 사용자 역할 업데이트
                await query('UPDATE users SET role = ? WHERE id = ?', [planId, req.user.id]);

                return res.json({
                    success: true,
                    data: subscription,
                    message: `${plan.name} 요금제 구독이 시작되었습니다.`
                });
            }
        }

        // 빌링키로 정기결제 시작
        const billingKey = await paymentService.getBillingKey(req.user.id);
        if (!billingKey) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { message: '먼저 결제 수단을 등록해주세요.' }
            });
        }

        // 구독 생성 및 첫 결제
        await paymentService.createSubscription(req.user.id, planId);
        const paymentResult = await paymentService.processSubscriptionPayment(req.user.id);

        if (paymentResult.success) {
            const subscription = await paymentService.getSubscription(req.user.id);
            res.json({
                success: true,
                data: subscription,
                message: '구독이 시작되었습니다.'
            });
        } else {
            res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { message: paymentResult.message || '결제에 실패했습니다.' }
            });
        }
    } catch (error) {
        console.error('구독 처리 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: error.message || '구독 처리에 실패했습니다.' }
        });
    }
};

/**
 * 구독 취소
 */
exports.cancelSubscription = async (req, res) => {
    try {
        const result = await paymentService.cancelSubscription(req.user.id);
        res.json({
            success: true,
            message: result.message
        });
    } catch (error) {
        console.error('구독 취소 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: error.message || '구독 취소에 실패했습니다.' }
        });
    }
};

/**
 * 결제 내역 조회
 */
exports.getPaymentHistory = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const result = await paymentService.getPaymentHistory(
            req.user.id,
            parseInt(page),
            parseInt(limit)
        );

        res.json({
            success: true,
            data: result.payments,
            pagination: result.pagination
        });
    } catch (error) {
        console.error('결제 내역 조회 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '결제 내역을 불러오는데 실패했습니다.' }
        });
    }
};

/**
 * 포트원 웹훅 처리
 */
exports.handleWebhook = async (req, res) => {
    try {
        const { imp_uid, merchant_uid, status } = req.body;

        console.log('포트원 웹훅 수신:', { imp_uid, merchant_uid, status });

        // 웹훅 시크릿 검증 (옵션)
        const webhookSecret = process.env.PORTONE_WEBHOOK_SECRET;
        if (webhookSecret) {
            // 웹훅 서명 검증 로직 추가 가능
        }

        // 결제 상태에 따른 처리
        if (status === 'paid') {
            // 결제 완료 처리
            // merchant_uid에서 user_id 추출 (kokive_{userId}_{timestamp} 형식)
            const parts = merchant_uid.split('_');
            if (parts.length >= 2 && parts[0] === 'kokive') {
                const userId = parseInt(parts[1]);
                if (!isNaN(userId)) {
                    // 결제 정보 업데이트
                    const { query } = require('../config/database');
                    await query(
                        'UPDATE payments SET imp_uid = ?, status = "paid" WHERE merchant_uid = ?',
                        [imp_uid, merchant_uid]
                    );
                }
            }
        } else if (status === 'cancelled' || status === 'failed') {
            // 결제 취소/실패 처리
            const { query } = require('../config/database');
            await query(
                'UPDATE payments SET status = ? WHERE merchant_uid = ?',
                [status, merchant_uid]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('웹훅 처리 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '웹훅 처리에 실패했습니다.' }
        });
    }
};

/**
 * 일회성 결제 완료 처리 (클라이언트에서 결제 후 호출)
 */
exports.completePayment = async (req, res) => {
    try {
        const { paymentId, impUid } = req.body;

        if (!paymentId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { message: 'paymentId가 필요합니다.' }
            });
        }

        // 결제 정보 조회 및 검증 (포트원 V2 API)
        const response = await fetch(`https://api.portone.io/payments/${paymentId}`, {
            headers: {
                'Authorization': `PortOne ${process.env.PORTONE_API_SECRET}`
            }
        });

        const paymentData = await response.json();

        if (paymentData.status === 'PAID') {
            // 결제 성공 - DB 업데이트
            const { query, insert } = require('../config/database');

            // 결제 기록 저장
            await insert('payments', {
                user_id: req.user.id,
                merchant_uid: paymentId,
                imp_uid: impUid || paymentId,
                amount: paymentData.amount.total,
                status: 'paid',
                pg_response: JSON.stringify(paymentData),
                created_at: new Date()
            });

            // customData에서 planId 추출
            const planId = paymentData.customData?.planId || 'pro';

            // 구독 생성/업데이트
            await paymentService.createSubscription(req.user.id, planId);
            await query(
                'UPDATE subscriptions SET status = "active", last_payment_date = NOW() WHERE user_id = ?',
                [req.user.id]
            );

            // 사용자 역할 업데이트
            await query('UPDATE users SET role = ? WHERE id = ?', [planId, req.user.id]);

            return res.json({
                success: true,
                status: 'PAID',
                message: '결제가 완료되었습니다.'
            });
        } else {
            return res.json({
                success: false,
                status: paymentData.status,
                message: '결제가 완료되지 않았습니다.'
            });
        }
    } catch (error) {
        console.error('결제 완료 처리 오류:', error);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: { message: '결제 완료 처리에 실패했습니다.' }
        });
    }
};
