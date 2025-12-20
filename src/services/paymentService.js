/**
 * KoKive Payment Service (PortOne V2)
 * 포트원 결제 및 구독 관리 서비스
 */

const axios = require('axios');
const { query, queryOne, insert, update, transaction } = require('../config/database');

// 포트원 API 설정
const PORTONE_API_BASE = 'https://api.portone.io';
const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;
const PORTONE_STORE_ID = process.env.PORTONE_STORE_ID;
const PORTONE_CHANNEL_KEY = process.env.PORTONE_CHANNEL_KEY;

// 요금제 정의
const PLANS = {
    free: {
        id: 'free',
        name: '무료',
        price: 0,
        features: {
            aiTranslation: true,
            basicSummary: true,
            unlimitedSearch: true,
            termDictionary: true,
            monthlySaveLimit: 10
        }
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        price: 9900,
        features: {
            premiumAiTranslation: true,
            allSummaryTypes: true,
            unlimitedSave: true,
            customNewsletter: true,
            apiAccess: true
        }
    }
};

class PaymentService {
    constructor() {
        this.axiosInstance = axios.create({
            baseURL: PORTONE_API_BASE,
            timeout: 30000,
            headers: {
                'Authorization': `PortOne ${PORTONE_API_SECRET}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * 빌링키 발급 (서버에서 직접 호출하는 방식이 아닌 클라이언트 SDK 콜백 후 처리)
     * 클라이언트에서 빌링키 발급 후 customer_uid를 DB에 저장
     */
    async saveBillingKey(userId, billingKeyData) {
        const { customerUid, cardName, cardNumber, pgProvider } = billingKeyData;

        // 기존 빌링키가 있으면 업데이트, 없으면 삽입
        const existing = await queryOne(
            'SELECT id FROM billing_keys WHERE user_id = ?',
            [userId]
        );

        const data = {
            user_id: userId,
            customer_uid: customerUid,
            card_name: cardName || null,
            card_number_masked: cardNumber ? `****-****-****-${cardNumber.slice(-4)}` : null,
            pg_provider: pgProvider || 'tosspayments',
            status: 'active',
            updated_at: new Date()
        };

        if (existing) {
            await update('billing_keys', data, { id: existing.id });
            return existing.id;
        } else {
            data.created_at = new Date();
            return await insert('billing_keys', data);
        }
    }

    /**
     * 빌링키 조회
     */
    async getBillingKey(userId) {
        return await queryOne(
            'SELECT * FROM billing_keys WHERE user_id = ? AND status = "active"',
            [userId]
        );
    }

    /**
     * 빌링키 삭제 (비활성화)
     */
    async deleteBillingKey(userId) {
        return await update(
            'billing_keys',
            { status: 'inactive', updated_at: new Date() },
            { user_id: userId }
        );
    }

    /**
     * 구독 생성/업데이트
     */
    async createSubscription(userId, planId) {
        const plan = PLANS[planId];
        if (!plan) {
            throw new Error('유효하지 않은 요금제입니다.');
        }

        // 현재 날짜와 다음 결제일 계산
        const now = new Date();
        const nextBillingDate = new Date(now);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

        // 기존 구독 확인
        const existing = await queryOne(
            'SELECT * FROM subscriptions WHERE user_id = ?',
            [userId]
        );

        const subscriptionData = {
            user_id: userId,
            plan_id: planId,
            status: planId === 'free' ? 'active' : 'pending',
            current_period_start: now,
            current_period_end: nextBillingDate,
            next_billing_date: planId === 'free' ? null : nextBillingDate,
            price: plan.price,
            updated_at: now
        };

        if (existing) {
            await update('subscriptions', subscriptionData, { id: existing.id });
            return { ...existing, ...subscriptionData };
        } else {
            subscriptionData.created_at = now;
            const id = await insert('subscriptions', subscriptionData);
            return { id, ...subscriptionData };
        }
    }

    /**
     * 구독 조회
     */
    async getSubscription(userId) {
        const subscription = await queryOne(
            `SELECT s.*, u.email, u.nickname
             FROM subscriptions s
             JOIN users u ON s.user_id = u.id
             WHERE s.user_id = ?`,
            [userId]
        );

        if (!subscription) {
            // 기본 무료 구독 반환
            return {
                plan_id: 'free',
                status: 'active',
                plan: PLANS.free
            };
        }

        return {
            ...subscription,
            plan: PLANS[subscription.plan_id] || PLANS.free
        };
    }

    /**
     * 결제 요청 (빌링키 사용)
     */
    async requestPayment(userId, amount, orderName) {
        const billingKey = await this.getBillingKey(userId);
        if (!billingKey) {
            throw new Error('등록된 결제 수단이 없습니다.');
        }

        const merchantUid = `kokive_${userId}_${Date.now()}`;

        try {
            // 포트원 V1 API (subscribe/payments/again) 사용
            const response = await axios.post(
                'https://api.iamport.kr/subscribe/payments/again',
                {
                    customer_uid: billingKey.customer_uid,
                    merchant_uid: merchantUid,
                    amount: amount,
                    name: orderName
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            // 결제 기록 저장
            const paymentRecord = {
                user_id: userId,
                merchant_uid: merchantUid,
                imp_uid: response.data.response?.imp_uid || null,
                amount: amount,
                status: response.data.code === 0 ? 'paid' : 'failed',
                pg_response: JSON.stringify(response.data),
                created_at: new Date()
            };

            await insert('payments', paymentRecord);

            return {
                success: response.data.code === 0,
                merchantUid,
                impUid: response.data.response?.imp_uid,
                message: response.data.message
            };
        } catch (error) {
            // 실패 기록
            await insert('payments', {
                user_id: userId,
                merchant_uid: merchantUid,
                amount: amount,
                status: 'failed',
                pg_response: JSON.stringify({ error: error.message }),
                created_at: new Date()
            });

            throw error;
        }
    }

    /**
     * 결제 검증 (클라이언트에서 결제 완료 후 호출)
     */
    async verifyPayment(impUid, merchantUid, expectedAmount) {
        try {
            // 포트원 액세스 토큰 발급
            const tokenResponse = await axios.post('https://api.iamport.kr/users/getToken', {
                imp_key: process.env.PORTONE_IMP_KEY,
                imp_secret: process.env.PORTONE_IMP_SECRET
            });

            const accessToken = tokenResponse.data.response.access_token;

            // 결제 정보 조회
            const paymentResponse = await axios.get(
                `https://api.iamport.kr/payments/${impUid}`,
                {
                    headers: { 'Authorization': accessToken }
                }
            );

            const paymentData = paymentResponse.data.response;

            // 금액 검증
            if (paymentData.amount !== expectedAmount) {
                throw new Error('결제 금액이 일치하지 않습니다.');
            }

            // 결제 상태 확인
            if (paymentData.status !== 'paid') {
                throw new Error('결제가 완료되지 않았습니다.');
            }

            return {
                success: true,
                payment: paymentData
            };
        } catch (error) {
            console.error('결제 검증 실패:', error.message);
            throw error;
        }
    }

    /**
     * 구독 결제 처리 (빌링키로 정기결제)
     */
    async processSubscriptionPayment(userId) {
        const subscription = await this.getSubscription(userId);

        if (!subscription || subscription.plan_id === 'free') {
            return { success: true, message: '무료 요금제입니다.' };
        }

        const plan = PLANS[subscription.plan_id];
        const result = await this.requestPayment(userId, plan.price, `KoKive ${plan.name} 구독`);

        if (result.success) {
            // 구독 기간 갱신
            const now = new Date();
            const nextBillingDate = new Date(now);
            nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

            await update('subscriptions', {
                status: 'active',
                current_period_start: now,
                current_period_end: nextBillingDate,
                next_billing_date: nextBillingDate,
                last_payment_date: now,
                updated_at: now
            }, { user_id: userId });

            // 사용자 역할 업데이트
            await update('users', { role: 'pro' }, { id: userId });
        }

        return result;
    }

    /**
     * 구독 취소
     */
    async cancelSubscription(userId) {
        const subscription = await this.getSubscription(userId);

        if (!subscription || subscription.plan_id === 'free') {
            throw new Error('취소할 구독이 없습니다.');
        }

        await update('subscriptions', {
            status: 'cancelled',
            cancelled_at: new Date(),
            updated_at: new Date()
        }, { user_id: userId });

        // 현재 구독 기간이 끝나면 무료로 전환 (즉시 전환하지 않음)
        // 실제로는 current_period_end까지 Pro 기능 사용 가능

        return { success: true, message: '구독이 취소되었습니다. 현재 결제 기간까지는 Pro 기능을 사용할 수 있습니다.' };
    }

    /**
     * 결제 내역 조회
     */
    async getPaymentHistory(userId, page = 1, limit = 10) {
        const offset = (page - 1) * limit;

        const payments = await query(
            `SELECT * FROM payments
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, limit, offset]
        );

        const [countResult] = await query(
            'SELECT COUNT(*) as total FROM payments WHERE user_id = ?',
            [userId]
        );

        return {
            payments,
            pagination: {
                page,
                limit,
                total: countResult.total,
                totalPages: Math.ceil(countResult.total / limit)
            }
        };
    }

    /**
     * 구독 만료 처리 (스케줄러에서 호출)
     */
    async processExpiredSubscriptions() {
        const now = new Date();

        // 만료된 취소 구독 찾기
        const expiredSubscriptions = await query(
            `SELECT s.*, u.email
             FROM subscriptions s
             JOIN users u ON s.user_id = u.id
             WHERE s.status = 'cancelled'
             AND s.current_period_end < ?`,
            [now]
        );

        for (const sub of expiredSubscriptions) {
            // 무료 요금제로 변경
            await update('subscriptions', {
                plan_id: 'free',
                status: 'active',
                price: 0,
                next_billing_date: null,
                updated_at: now
            }, { id: sub.id });

            // 사용자 역할 변경
            await update('users', { role: 'free' }, { id: sub.user_id });

            console.log(`구독 만료 처리: user_id=${sub.user_id}`);
        }

        return expiredSubscriptions.length;
    }

    /**
     * 정기결제 처리 (스케줄러에서 호출)
     */
    async processRecurringPayments() {
        const now = new Date();

        // 결제일이 지난 활성 구독 찾기
        const dueSubscriptions = await query(
            `SELECT s.*, u.email
             FROM subscriptions s
             JOIN users u ON s.user_id = u.id
             WHERE s.status = 'active'
             AND s.plan_id != 'free'
             AND s.next_billing_date <= ?`,
            [now]
        );

        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        for (const sub of dueSubscriptions) {
            try {
                await this.processSubscriptionPayment(sub.user_id);
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    userId: sub.user_id,
                    error: error.message
                });

                // 결제 실패 시 구독 상태 업데이트
                await update('subscriptions', {
                    status: 'payment_failed',
                    updated_at: now
                }, { id: sub.id });
            }
        }

        return results;
    }

    /**
     * 요금제 정보 반환
     */
    getPlans() {
        return PLANS;
    }

    /**
     * 스토어 정보 반환 (프론트엔드용)
     */
    getStoreInfo() {
        return {
            storeId: PORTONE_STORE_ID,
            channelKey: PORTONE_CHANNEL_KEY
        };
    }
}

module.exports = new PaymentService();
